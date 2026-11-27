// Sending, generating / regenerating / editing / stopping answers, tool approval, compaction, balance monitoring.
// Feature-specific behavior (tools, system prompt notes, built-in search, image requests) comes from tool-registry.ts.

import type { Attachment, Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { runAssistant } from '../lib/chat/runner';
import { childrenOf, deepestLatestLeaf, pathToLeaf } from '../lib/chat/tree';
import { estimateTokens } from '../lib/chat/context';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings, saveSettings } from './settings';
import { authFor, keyReady } from './keys';
import { modelOf, providerById } from './models';
import { conversations, currentConv, currentId, liveMessages, messages, persistDraft, putMessage, touchConversation, updateConversation } from './conversations';
import { openSettings, showToast } from './ui';
import { accountById } from '../lib/keys/accounts';
import { contributedBuiltinWebSearch, contributedDynamicTools, contributedTools, requestHandlerFor, systemPromptFor, type ToolProviderContext } from './tool-registry';
import { controllers, setStreaming, streamingConv } from './runs';
import { fetchBalance, observeProviderBalance, recordProviderSpend } from './balance';
import { recordingTransport } from './sent-requests';
import { providerOptionsFor, recordUsage } from './request-helpers';
import { waitForApproval } from './approvals';
import { cancelSuggestions, suggestReplies } from './suggestions';
import { compactConversation, contextUsage } from './compaction';
import { t } from './messages';
import { saveReplyImage } from './media';

let pendingFlush = 0;
const pendingUpdates = new Map<string, MessageRecord>();
function scheduleMessageUpdate(m: MessageRecord) {
  pendingUpdates.set(m.id, { ...m, parts: m.parts.map((p) => ({ ...p })) });
  if (!pendingFlush) pendingFlush = requestAnimationFrame(flushUpdates);
}
function flushUpdates() {
  pendingFlush = 0;
  if (!pendingUpdates.size) return;
  const ups = new Map(pendingUpdates);
  pendingUpdates.clear();
  messages.value = messages.value.map((m) => ups.get(m.id) ?? m);
}

// ---- Sending and generation ----
/** If no key is usable, open settings and return false */
function ensureKey(providerId: string): boolean {
  if (keyReady(providerId) || accountById(providerId)?.keyOptional) return true;
  openSettings('connections');
  showToast(t('gen.setKeyFirst', { name: providerById(providerId)?.name ?? providerId }), 'error');
  return false;
}

/** Extra content features add to the user message (attached files, picked skills, ...) */
export type SendExtras = Partial<Pick<MessageRecord, 'attachments' | 'skills'>>;

export async function sendMessage(text: string, extras: SendExtras = {}) {
  cancelSuggestions();
  const skills = extras.skills ?? [];
  const files: Attachment[] = extras.attachments ?? [];
  if (!text.trim() && !skills.length && !files.length) return;
  const cur = currentConv.value;
  if (!ensureKey(cur.providerId)) return;
  if (!cur.modelId) {
    showToast(t('gen.chooseModel'), 'error');
    return;
  }
  // Auto-compaction: if the input about to be sent is likely to exceed the context-length threshold, summarize the older part first
  if (currentId.value && settings.value.autoCompact) {
    const u = contextUsage.value;
    if (u.limit && (u.total + estimateTokens(text)) / u.limit >= settings.value.compactThreshold) await compactConversation(true);
  }
  const conv = await persistDraft(text.trim() ? text : [...skills.map((s) => s.name), ...files.map((f) => f.name)].join(', '));
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: currentConv.value.currentLeafId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    status: 'done',
    ...(skills.length ? { skills } : {}),
    ...(files.length ? { attachments: files } : {})
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await generateReply(conv.id, user.id);
}

/** Generate an assistant answer as a child of parentUserId (also used for regeneration) */
async function generateReply(convId: string, parentUserId: string) {
  cancelSuggestions();
  const conv = conversations.value.find((c) => c.id === convId);
  const cfg = conv ? providerById(conv.providerId) : undefined;
  if (!conv || !cfg || streamingConv.value.has(convId)) return;
  const draft: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: parentUserId,
    role: 'assistant',
    parts: [],
    createdAt: Date.now(),
    status: 'streaming',
    meta: { providerId: cfg.id, model: conv.modelId }
  };
  const history = pathToLeaf(new Map(messages.value.map((m) => [m.id, m])), parentUserId);
  messages.value = [...messages.value, draft];
  // Write the (empty) reply before pointing the conversation at it, so closing the tab right now
  // cannot leave the conversation pointing at a message that does not exist
  await putMessage(draft, conv);
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);

  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  const model = modelOf(cfg.id, conv.modelId);
  // Tools, system prompt notes and built-in search come from the features through the tool registry
  const toolCtx: ToolProviderContext = { conv, messageId: draft.id, model, history };
  const tools = contributedTools(toolCtx);
  const systemPrompt = systemPromptFor(toolCtx);
  // The provider's own web search, when the web feature chose that route
  const nativeSearch = contributedBuiltinWebSearch(toolCtx);
  const providerOptions = providerOptionsFor(cfg.id, 'chat', nativeSearch);
  try {
    let headerBalance = false;
    const final = await runAssistant({
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport: settings.value.developerMode ? recordingTransport(transport, draft.id) : transport,
      model: conv.modelId,
      history,
      systemPrompt,
      params: settings.value.temperature != null ? { temperature: settings.value.temperature } : undefined,
      providerOptions,
      webSearch: nativeSearch === 'off' ? undefined : nativeSearch,
      imageOutput: !!model?.capabilities.imageOutput,
      saveImage: (data, mimeType) => saveReplyImage(conv, draft.id, data, mimeType),
      contextLength: model?.contextLength,
      maxOutputTokens: model?.maxOutputTokens,
      resendReasoning: settings.value.resendReasoning,
      cacheKey: conv.id,
      tools,
      dynamicTools: (turn) => contributedDynamicTools(toolCtx, turn),
      toolContext: { transport, authFor },
      permissionFor: (tool) => {
        const set = settings.value.toolPermissions[tool.name] ?? tool.defaultPermission ?? 'ask';
        return tool.alwaysAsk ? 'ask' : tool.confirmsItself ? (set === 'deny' ? 'deny' : 'allow') : set;
      },
      requestApproval: waitForApproval,
      draft,
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === 'account' && ev.balanceUsd !== undefined) {
          headerBalance = true;
          observeProviderBalance(cfg.id, ev.balanceUsd);
        }
      },
      onUpdate: (m) => {
        liveMessages.set(m.id, { ...m, parts: m.parts.map((p) => ({ ...p })) });
        if (currentId.value === conv.id) scheduleMessageUpdate(m);
      },
      persist: (m) => putMessage(m, conv)
    });
    if (currentId.value === conv.id) {
      scheduleMessageUpdate(final);
      flushUpdates();
    }
    recordUsage({ id: final.id, conversationId: conv.id, providerId: cfg.id, model: conv.modelId, kind: 'chat', usage: final.meta?.usage, costUsd: final.meta?.costUsd, temporary: conv.temporary });
    if (final.meta?.costUsd) recordProviderSpend(cfg.id, final.meta.costUsd);
    // Providers that do not send the balance with the answer are asked for it afterwards
    if (!headerBalance) void fetchBalance(cfg.id);
    if (final.status === 'error' && final.error) showToast(final.error.message, 'error');
    void suggestReplies(conv, final, history);
  } finally {
    liveMessages.delete(draft.id);
    controllers.delete(conv.id);
    setStreaming(conv.id, false);
    touchConversation(conv.id);
  }
}

export async function regenerate(assistantId: string) {
  const m = messages.value.find((x) => x.id === assistantId);
  const conv = currentConv.value;
  if (!m?.parentId || !currentId.value) return;
  // Requests a feature answers itself (e.g. images) go back to that feature
  const handler = requestHandlerFor(messages.value.find((x) => x.id === m.parentId));
  if (handler) return handler.run(currentId.value, m.parentId);
  if (!ensureKey(conv.providerId)) return;
  await generateReply(currentId.value, m.parentId);
}

/** Regenerate with another model: switch the conversation's model, then add an answer to the same question as a new version */
export async function regenerateWith(assistantId: string, providerId: string, modelId: string) {
  if (!ensureKey(providerId)) return;
  await updateConversation({ providerId, modelId });
  await saveSettings({ lastProviderId: providerId, lastModelId: modelId });
  await regenerate(assistantId);
}

/** Edit a user message: create a new message as a sibling and generate an answer */
export async function editUserMessage(userId: string, newText: string) {
  const conv = currentConv.value;
  const orig = messages.value.find((x) => x.id === userId);
  const handler = requestHandlerFor(orig);
  if (!currentId.value || !orig || !newText.trim() || (handler ? !handler.ready(orig) : !ensureKey(conv.providerId))) return;
  const user: MessageRecord = {
    ...orig,
    id: repo.newId(),
    parts: [{ type: 'text', text: newText }],
    createdAt: Date.now(),
    ...handler?.edit?.(orig, newText)
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await updateConversation({ currentLeafId: user.id });
  if (handler) return handler.run(conv.id, user.id);
  await generateReply(conv.id, user.id);
}

/** Switch between sibling nodes (< 1/3 >) */
export async function switchSibling(msgId: string, dir: -1 | 1) {
  const all = messages.value;
  const m = all.find((x) => x.id === msgId);
  if (!m) return;
  const sibs = childrenOf(all, m.parentId);
  const target = sibs[sibs.findIndex((s) => s.id === msgId) + dir];
  if (target) await updateConversation({ currentLeafId: deepestLatestLeaf(all, target.id) });
}

/** Change the conversation's model (also becomes the default for new chats) */
export async function chooseModel(providerId: string, modelId: string) {
  await updateConversation({ providerId, modelId } as Partial<Conversation>);
  await saveSettings({ lastProviderId: providerId, lastModelId: modelId });
}
