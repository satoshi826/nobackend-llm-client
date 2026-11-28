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
import { authFor } from './keys';
import { accountInUse, modelOf, providerById } from './models';
import { conversations, currentConv, currentId, endWriting, messages, persistDraft, saveMessage, showMessage, touchConversation, updateConversation } from './conversations';
import { openSettings, showToast } from './ui';
import { chatOptionsOf } from './chat-options';
import type { ChatParams } from '../lib/providers/types';
import { contributedBuiltinWebSearch, contributedDynamicTools, contributedTools, requestHandlerFor, systemPromptFor, type ToolProviderContext } from './tool-registry';
import { beginRun, endRun, runs } from './runs';
import { observeProviderBalance } from './balance';
import { recordingTransport } from './sent-requests';
import { providerOptionsFor, recordUsage } from './request-helpers';
import { waitForApproval } from './approvals';
import { cancelSuggestions, suggestReplies } from './suggestions';
import { compactConversation, contextUsage } from './compaction';
import { t } from './messages';
import { saveReplyImage } from './media';

// ---- Sending and generation ----
/** If the connection cannot be used now (removed, turned off, or locked), open settings and return false */
function ensureKey(providerId: string): boolean {
  if (accountInUse(providerId)) return true;
  openSettings('connections');
  showToast(t('gen.notInUse', { name: providerById(providerId)?.name ?? providerId }), 'error');
  return false;
}

/** Extra content features add to the user message (attached files, picked skills, ...) */
export type SendExtras = Partial<Pick<MessageRecord, 'attachments' | 'skills'>>;

/** Send a message and start the reply. false: it was not sent (nothing to send, no key or model, or it could not be saved) */
export async function sendMessage(text: string, extras: SendExtras = {}): Promise<boolean> {
  cancelSuggestions();
  const skills = extras.skills ?? [];
  const files: Attachment[] = extras.attachments ?? [];
  if (!text.trim() && !skills.length && !files.length) return false;
  const cur = currentConv.value;
  if (!ensureKey(cur.providerId)) return false;
  if (!cur.modelId) {
    showToast(t('gen.chooseModel'), 'error');
    return false;
  }
  // Auto-compaction: if the input about to be sent is likely to exceed the context-length threshold, summarize the older part first
  if (currentId.value && settings.value.autoCompact) {
    const u = contextUsage.value;
    if (u.limit && (u.total + estimateTokens(text)) / u.limit >= settings.value.compactThreshold) await compactConversation(true);
  }
  let conv: Conversation;
  let user: MessageRecord;
  try {
    conv = await persistDraft(text.trim() ? text : [...skills.map((s) => s.name), ...files.map((f) => f.name)].join(', '));
    user = {
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
    await saveMessage(user);
  } catch (e) {
    showToast(storageFull(e) ? t('gen.storageFull') : t('gen.notSaved', { message: (e as Error)?.message ?? String(e) }), 'error');
    return false;
  }
  void generateReply(conv.id, user.id);
  return true;
}

/** The browser refused to store more (Dexie passes the browser's error on, or wraps it) */
const storageFull = (e: unknown): boolean => {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
};

/** The request's parameters: the temperature from settings, and this chat's answer length and reasoning effort */
function replyParams(convId: string): ChatParams | undefined {
  const o = chatOptionsOf(convId);
  const p: ChatParams = {
    ...(settings.value.temperature != null ? { temperature: settings.value.temperature } : {}),
    ...(o.maxTokens ? { maxTokens: o.maxTokens } : {}),
    ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort } : {})
  };
  return Object.keys(p).length ? p : undefined;
}

/** Generate an assistant answer as a child of parentUserId (also used for regeneration) */
async function generateReply(convId: string, parentUserId: string) {
  cancelSuggestions();
  const conv = conversations.value.find((c) => c.id === convId);
  const cfg = conv ? providerById(conv.providerId) : undefined;
  if (!conv || !cfg || runs.value.has(convId)) return;
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
  // Write the (empty) reply before pointing the conversation at it, so closing the tab right now
  // cannot leave the conversation pointing at a message that does not exist
  await saveMessage(draft);
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);

  const ctrl = beginRun(conv.id);
  const model = modelOf(cfg.id, conv.modelId);
  // Tools, system prompt notes and built-in search come from the features through the tool registry
  const toolCtx: ToolProviderContext = { conv, messageId: draft.id, model, history };
  const tools = contributedTools(toolCtx);
  const systemPrompt = systemPromptFor(toolCtx);
  // The provider's own web search, when the web feature chose that route
  const nativeSearch = contributedBuiltinWebSearch(toolCtx);
  const providerOptions = providerOptionsFor(cfg.id, 'chat', nativeSearch);
  try {
    const final = await runAssistant({
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport: settings.value.developerMode ? recordingTransport(transport, draft.id) : transport,
      model: conv.modelId,
      history,
      systemPrompt,
      params: replyParams(conv.id),
      providerOptions,
      webSearch: nativeSearch === 'off' ? undefined : nativeSearch,
      imageOutput: !!model?.capabilities.imageOutput,
      saveImage: (data, mimeType) => saveReplyImage(conv, draft.id, data, mimeType),
      contextLength: model?.contextLength,
      maxOutputTokens: model?.maxOutputTokens,
      resendReasoning: chatOptionsOf(conv.id).resendReasoning ?? settings.value.resendReasoning,
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
        if (ev.type === 'account' && ev.balanceUsd !== undefined) observeProviderBalance(cfg.id, ev.balanceUsd);
      },
      onUpdate: showMessage,
      // Shown already by onUpdate
      persist: (m) => repo.putMessage(m)
    });
    recordUsage({ id: final.id, conversationId: conv.id, providerId: cfg.id, model: conv.modelId, kind: 'chat', usage: final.meta?.usage, costUsd: final.meta?.costUsd, temporary: conv.temporary });
    // The answer shows the error; a conversation not on screen tells it in a toast
    if (final.status === 'error' && final.error && currentId.value !== conv.id) showToast(final.error.message, 'error');
    void suggestReplies(conv, final, history);
  } finally {
    // Ended already unless the run failed
    endWriting(draft.id);
    endRun(conv.id);
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
  await saveMessage(user);
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
