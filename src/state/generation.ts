// Sending, generating / regenerating / editing / stopping answers, tool approval, compaction, balance monitoring
import { computed, signal } from '@preact/signals';
import type { Attachment, Conversation, MessageRecord } from '../lib/db/schema';
import type { Usage } from '../lib/providers/types';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { runAssistant, type ApprovalDecision, type ApprovalRequest } from '../lib/chat/runner';
import { childrenOf, deepestLatestLeaf, pathToLeaf } from '../lib/chat/tree';
import { estimateRequestTokens, planCompaction, summarize } from '../lib/chat/compact';
import { estimateTokens } from '../lib/chat/context';
import { initialBalanceState, observeBalance, recordSpend, type BalanceState } from '../lib/chat/balance';
import { WEB_TOOLS } from '../lib/tools/web';
import { ALWAYS_ASK, makeSaveSkillTool, makeSkillTool } from '../lib/tools/skill';
import { unlockedTools, withSkillCatalog } from '../lib/skills/skill';
import type { Tool } from '../lib/tools/types';
import { makeUsageRecord } from '../lib/usage';
import { generateSuggestions } from '../lib/chat/suggest';
import type { Skill } from '../lib/db/schema';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings, saveSettings, providerSettingsOf } from './settings';
import { authFor, keyReady } from './keys';
import { modelOf, providerById } from './models';
import { conversations, currentConv, currentId, currentPath, liveMessages, messages, persistDraft, putMessage, touchConversation, updateConversation } from './conversations';
import { openSettings, showToast } from './ui';
import { accountById } from '../lib/keys/accounts';
import { allSkills, attachedSkillIds, attachedSkills, modelSkills, saveSkill } from './skills';
import { contributedSystemNotes, contributedTools, type ToolProviderContext } from './tool-registry';

// ---- Generation state ----
export const streamingConv = signal<Set<string>>(new Set());
export const isStreaming = computed(() => (currentId.value ? streamingConv.value.has(currentId.value) : false));
export const compactingConv = signal<string | null>(null);
const controllers = new Map<string, AbortController>();

function setStreaming(convId: string, on: boolean) {
  const s = new Set(streamingConv.value);
  if (on) s.add(convId);
  else s.delete(convId);
  streamingConv.value = s;
}

/** Record spend / observed balance from work outside the chat loop (image jobs), so balance alerts stay accurate */
export function recordProviderSpend(providerId: string, usd: number) {
  if (balances.value[providerId]) updateBalance(providerId, (b) => recordSpend(b, usd));
}
/** Start the balance comparison afresh (after spend whose exact price is unknown, e.g. image jobs) */
export function resetProviderBalanceBaseline(providerId: string) {
  const b = balances.value[providerId];
  if (b) balances.value = { ...balances.value, [providerId]: { ...b, last: null, spentSinceLast: 0 } };
}
export function observeProviderBalance(providerId: string, usd: number) {
  updateBalance(providerId, (b) => observeBalance(b, usd));
}

/** Start a run for a conversation (shared by chat replies and image jobs): the stop button aborts it */
export function beginRun(convId: string): AbortController {
  const ctrl = new AbortController();
  controllers.set(convId, ctrl);
  setStreaming(convId, true);
  return ctrl;
}

export function endRun(convId: string) {
  controllers.delete(convId);
  setStreaming(convId, false);
}

/**
 * Image jobs live in state/images.ts, which imports this module; it registers itself here
 * so regenerate / edit can hand image requests over without a circular import.
 */
let imageHandler: ((convId: string, userMsgId: string) => Promise<void>) | null = null;
export function registerImageHandler(fn: (convId: string, userMsgId: string) => Promise<void>) {
  imageHandler = fn;
}


export function stopGeneration(convId = currentId.value) {
  if (convId) controllers.get(convId)?.abort();
}

export function stopAll() {
  for (const c of controllers.values()) c.abort();
}

// Batch streaming updates and apply them once per requestAnimationFrame
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

// ---- Balance (only providers that return it in response headers): warn if it drops more than this app spent ----
export const balances = signal<Record<string, BalanceState>>({});
export const BALANCE_ALERT_USD = 0.5;
/** Providers whose balance dropped by an unexplained amount */
export const balanceAlerts = computed(() => Object.entries(balances.value).filter(([, b]) => b.unexplainedUsd >= BALANCE_ALERT_USD));

function updateBalance(providerId: string, fn: (b: BalanceState) => BalanceState) {
  balances.value = { ...balances.value, [providerId]: fn(balances.value[providerId] ?? initialBalanceState()) };
}

/** Provider-specific request options (decided by the preset) */
function providerOptionsFor(providerId: string, purpose: 'chat' | 'summary', webSearch: 'off' | 'auto' | 'on' = 'off') {
  const cfg = providerById(providerId);
  if (!cfg) return undefined;
  const preset = getPreset(cfg.preset);
  const opts = preset.requestOptions?.({ purpose, webSearch, settings: providerSettingsOf(cfg.id, preset.settings) });
  return opts ? { [preset.id]: opts } : undefined;
}

/** Record usage (temporary chats are not recorded) */
function recordUsage(o: { id: string; providerId: string; model: string; kind: 'chat' | 'summary' | 'suggest'; usage?: Usage; costUsd?: number; temporary?: boolean }) {
  if (o.temporary) return;
  const r = makeUsageRecord({ ...o, at: Date.now() }, modelOf(o.providerId, o.model)?.pricing);
  if (r) void repo.addUsage(r).catch(() => {});
}

// ---- Web search ----
/**
 * How web search is done in this conversation.
 * - 'tools': a tool-calling model + a Tavily key (on providers with built-in search, when "tools" is chosen in settings)
 * - 'builtin': the provider's built-in search (features.builtInWebSearch)
 * - null: unavailable
 */
/** Skills listed to this model (only for models that support tool calling) */
export function skillsFor(providerId: string, modelId: string): Skill[] {
  return modelOf(providerId, modelId)?.capabilities.tools ? modelSkills.value : [];
}

export function searchModeFor(providerId: string, modelId: string): 'tools' | 'builtin' | null {
  const m = modelOf(providerId, modelId);
  const toolsReady = !!m?.capabilities.tools && keyReady('tavily');
  const cfg = providerById(providerId);
  if (cfg && getPreset(cfg.preset).features?.builtInWebSearch) {
    if (settings.value.searchEngine === 'tools' && toolsReady) return 'tools';
    return m?.capabilities.webSearch === false ? (toolsReady ? 'tools' : null) : 'builtin';
  }
  return toolsReady ? 'tools' : null;
}

// ---- Pending tool approvals ----
export const pendingApprovals = signal<Record<string, { toolName: string }>>({});
const approvalResolvers = new Map<string, (d: ApprovalDecision) => void>();

function waitForApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const done = (d: ApprovalDecision) => {
      approvalResolvers.delete(req.toolCallId);
      const next = { ...pendingApprovals.value };
      delete next[req.toolCallId];
      pendingApprovals.value = next;
      resolve(d);
    };
    approvalResolvers.set(req.toolCallId, done);
    pendingApprovals.value = { ...pendingApprovals.value, [req.toolCallId]: { toolName: req.tool.name } };
    req.signal.addEventListener('abort', () => done({ approved: false, reason: '停止しました。' }), { once: true });
  });
}

/** Answer from the approval card. "Always allow" sets that tool's setting to allow */
export async function resolveApproval(toolCallId: string, d: ApprovalDecision) {
  const p = pendingApprovals.value[toolCallId];
  if (d.approved && d.always && p && !ALWAYS_ASK.has(p.toolName)) await saveSettings({ toolPermissions: { ...settings.value.toolPermissions, [p.toolName]: 'allow' } });
  approvalResolvers.get(toolCallId)?.(d);
}

// ---- Context usage and compaction ----
export const contextUsage = computed<{ tokens: number; limit: number | null; ratio: number | null }>(() => {
  const conv = currentConv.value;
  const tokens = estimateRequestTokens(currentPath.value, withSkillCatalog(conv.systemPrompt, skillsFor(conv.providerId, conv.modelId)));
  const limit = modelOf(conv.providerId, conv.modelId)?.contextLength ?? null;
  return { tokens, limit, ratio: limit ? tokens / limit : null };
});

function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const i = ref.indexOf('|');
  return i > 0 ? { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) } : null;
}

// ---- Reply suggestions ----
/** ID of the answer whose reply suggestions are being generated */
export const suggestingFor = signal<string | null>(null);
let suggestCtrl: AbortController | null = null;

/** Cancel in-progress reply suggestions (on send, or when the user starts typing) */
export function cancelSuggestions() {
  suggestCtrl?.abort();
  suggestCtrl = null;
  suggestingFor.value = null;
}

/** After an answer, generate reply suggestions and save them on the answer (shows nothing on failure) */
async function suggestReplies(conv: Conversation, final: MessageRecord, history: MessageRecord[]) {
  const s = settings.value;
  if (!s.replySuggestions || final.status !== 'done') return;
  if (!final.parts.some((p) => p.type === 'text' && p.text.trim())) return;
  const ref = parseModelRef(s.suggestionModel) ?? { providerId: conv.providerId, modelId: conv.modelId };
  const cfg = providerById(ref.providerId);
  if (!cfg || !ref.modelId || !(keyReady(cfg.id) || accountById(cfg.id)?.keyOptional)) return;
  cancelSuggestions();
  const ctrl = new AbortController();
  suggestCtrl = ctrl;
  suggestingFor.value = final.id;
  try {
    const list = await generateSuggestions([...history, final], Math.max(1, s.suggestionTurns), Math.max(1, s.suggestionCount), {
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      signal: ctrl.signal,
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), providerId: cfg.id, model: ref.modelId, kind: 'suggest', usage, costUsd, temporary: conv.temporary })
    });
    if (ctrl.signal.aborted || !list.length) return;
    const latest = messages.value.find((m) => m.id === final.id) ?? final;
    const updated: MessageRecord = { ...latest, suggestions: list };
    await putMessage(updated, conv);
    if (messages.value.some((m) => m.id === final.id)) messages.value = messages.value.map((m) => (m.id === final.id ? updated : m));
  } catch {
    /* Reply suggestions are only an aid, so failures are not reported */
  } finally {
    if (suggestCtrl === ctrl) {
      suggestCtrl = null;
      suggestingFor.value = null;
    }
  }
}

/** Summarize the older part and add a compaction node (the original history is kept). Returns true if compacted */
export async function compactConversation(auto = false): Promise<boolean> {
  const conv = currentConv.value;
  if (!currentId.value || streamingConv.value.has(conv.id)) return false;
  const plan = planCompaction(currentPath.value);
  if (!plan) {
    if (!auto) showToast('まだ圧縮するほど長くありません。');
    return false;
  }
  let ref = parseModelRef(settings.value.compactModel);
  if (!ref || !modelOf(ref.providerId, ref.modelId) || !keyReady(ref.providerId)) ref = { providerId: conv.providerId, modelId: conv.modelId };
  const cfg = providerById(ref.providerId);
  if (!cfg) return false;
  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  compactingConv.value = conv.id;
  try {
    const summary = await summarize(plan, {
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      contextLength: modelOf(ref.providerId, ref.modelId)?.contextLength,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), providerId: cfg.id, model: ref.modelId, kind: 'summary', usage, costUsd, temporary: conv.temporary }),
      signal: ctrl.signal
    });
    const node: MessageRecord = {
      id: repo.newId(),
      conversationId: conv.id,
      parentId: conv.currentLeafId,
      role: 'system',
      parts: [{ type: 'text', text: summary }],
      createdAt: Date.now(),
      status: 'done',
      meta: { providerId: cfg.id, model: ref.modelId },
      compaction: { summary, coversUntilId: plan.coversUntilId, count: plan.toSummarize.length, model: ref.modelId, auto }
    };
    await putMessage(node, conv);
    messages.value = [...messages.value, node];
    await updateConversation({ currentLeafId: node.id, updatedAt: Date.now() }, conv.id);
    showToast(auto ? `会話が長くなったため、古い ${plan.toSummarize.length} 件を自動で要約しました` : `古い ${plan.toSummarize.length} 件を要約しました`);
    return true;
  } catch (e) {
    if (!ctrl.signal.aborted) showToast(`要約に失敗しました: ${(e as Error).message}`, 'error');
    return false;
  } finally {
    controllers.delete(conv.id);
    setStreaming(conv.id, false);
    compactingConv.value = null;
  }
}

// ---- Sending and generation ----
/** If no key is usable, open settings and return false */
function ensureKey(providerId: string): boolean {
  if (keyReady(providerId) || accountById(providerId)?.keyOptional) return true;
  openSettings('connections');
  showToast(`先に ${providerById(providerId)?.name ?? ''} の API キーを設定してください。`, 'error');
  return false;
}

/** Extra content a feature adds to the user message (e.g. attached files, built by features/files) */
export interface SendExtras {
  attachments?: Attachment[];
}

export async function sendMessage(text: string, extras: SendExtras = {}) {
  cancelSuggestions();
  const attached = attachedSkills.value.map((s) => ({ name: s.name, body: s.body }));
  const files = extras.attachments ?? [];
  if (!text.trim() && !attached.length && !files.length) return;
  const cur = currentConv.value;
  if (!ensureKey(cur.providerId)) return;
  if (!cur.modelId) {
    showToast('モデルを選んでください。', 'error');
    return;
  }
  // Auto-compaction: if the input about to be sent is likely to exceed the context-length threshold, summarize the older part first
  if (currentId.value && settings.value.autoCompact) {
    const u = contextUsage.value;
    if (u.limit && (u.tokens + estimateTokens(text)) / u.limit >= settings.value.compactThreshold) await compactConversation(true);
  }
  attachedSkillIds.value = [];
  const conv = await persistDraft(text.trim() ? text : [...attached.map((s) => s.name), ...files.map((f) => f.name)].join(', '));
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: currentConv.value.currentLeafId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    status: 'done',
    ...(attached.length ? { skills: attached } : {}),
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
  const webOn = conv.webSearch !== 'off';
  const search = webOn ? searchModeFor(cfg.id, conv.modelId) : null;
  const skillList = skillsFor(cfg.id, conv.modelId);
  // Tools contributed by features (images, files, ...) through the tool registry
  const toolCtx: ToolProviderContext = { conv, messageId: draft.id, model, history };
  const tools = [...(search === 'tools' ? WEB_TOOLS : []), ...(skillList.length ? [makeSkillTool(skillList)] : []), ...contributedTools(toolCtx)];
  const notes = contributedSystemNotes(toolCtx);
  const systemPrompt = [withSkillCatalog(conv.systemPrompt, skillList), notes].filter(Boolean).join('\n\n');
  // Tools available only in conversations that loaded (specified) a skill. For skill-creator: save_skill, and load_skill that can read all skills
  const toolsCapable = !!model?.capabilities.tools;
  const dynamicTools = (turn: MessageRecord): Tool[] => {
    if (!toolsCapable) return [];
    const unlocked = unlockedTools([...history, turn], allSkills.value);
    if (!unlocked.has('save_skill')) return [];
    return [
      makeSkillTool(allSkills.value),
      makeSaveSkillTool({
        find: (name) => allSkills.value.find((s) => s.name === name),
        save: (draft, id) => saveSkill(draft, id, 'model')
      })
    ];
  };
  const providerOptions = providerOptionsFor(cfg.id, 'chat', search === 'builtin' ? conv.webSearch : 'off');
  try {
    const final = await runAssistant({
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: conv.modelId,
      history,
      systemPrompt,
      params: settings.value.temperature != null ? { temperature: settings.value.temperature } : undefined,
      providerOptions,
      contextLength: model?.contextLength,
      maxOutputTokens: model?.maxOutputTokens,
      resendReasoning: settings.value.resendReasoning,
      cacheKey: conv.id,
      tools,
      dynamicTools,
      toolContext: { transport, authFor },
      permissionFor: (name) => (ALWAYS_ASK.has(name) ? 'ask' : (settings.value.toolPermissions[name] ?? 'ask')),
      requestApproval: waitForApproval,
      draft,
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === 'account' && ev.balanceUsd !== undefined) updateBalance(cfg.id, (b) => observeBalance(b, ev.balanceUsd!));
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
    recordUsage({ id: final.id, providerId: cfg.id, model: conv.modelId, kind: 'chat', usage: final.meta?.usage, costUsd: final.meta?.costUsd, temporary: conv.temporary });
    if (final.meta?.costUsd && balances.value[cfg.id]) updateBalance(cfg.id, (b) => recordSpend(b, final.meta!.costUsd!));
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
  // Image requests are regenerated by the image module
  const parent = messages.value.find((x) => x.id === m.parentId);
  if (parent?.imageRequest && imageHandler) return imageHandler(currentId.value, parent.id);
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
  if (!currentId.value || !orig || !newText.trim() || (!orig.imageRequest && !ensureKey(conv.providerId))) return;
  const user: MessageRecord = {
    ...orig,
    id: repo.newId(),
    parts: [{ type: 'text', text: newText }],
    createdAt: Date.now(),
    ...(orig.imageRequest ? { imageRequest: { ...orig.imageRequest, prompt: newText } } : {})
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await updateConversation({ currentLeafId: user.id });
  if (user.imageRequest && imageHandler) return imageHandler(conv.id, user.id);
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

export function abortConversation(id: string) {
  controllers.get(id)?.abort();
}
