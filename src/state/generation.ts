// 送信・回答の生成・再生成・編集・停止、ツールの承認、圧縮、残高の監視
import { computed, signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { runAssistant, type ApprovalDecision, type ApprovalRequest } from '../lib/chat/runner';
import { childrenOf, deepestLatestLeaf, pathToLeaf } from '../lib/chat/tree';
import { estimateRequestTokens, planCompaction, summarize } from '../lib/chat/compact';
import { estimateTokens } from '../lib/chat/context';
import { initialBalanceState, observeBalance, recordSpend, type BalanceState } from '../lib/chat/balance';
import { WEB_TOOLS } from '../lib/tools/web';
import { makeSkillTool } from '../lib/tools/skill';
import { withSkillCatalog } from '../lib/skills/skill';
import type { Skill } from '../lib/db/schema';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings, saveSettings, providerSettingsOf } from './settings';
import { authFor, keyReady } from './keys';
import { modelOf, providerById } from './models';
import { conversations, currentConv, currentId, currentPath, liveMessages, messages, persistDraft, putMessage, touchConversation, updateConversation } from './conversations';
import { openSettings, showToast } from './ui';
import { attachedSkillIds, attachedSkills, modelSkills } from './skills';

// ---- 生成中の状態 ----
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

export function stopGeneration(convId = currentId.value) {
  if (convId) controllers.get(convId)?.abort();
}

export function stopAll() {
  for (const c of controllers.values()) c.abort();
}

// ストリーミング中の更新は requestAnimationFrame ごとにまとめて反映する
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

// ---- 残高（応答ヘッダで残高を返す接続先のみ）: このアプリで使った分以上に減ったら警告 ----
export const balances = signal<Record<string, BalanceState>>({});
export const BALANCE_ALERT_USD = 0.5;
/** 説明のつかない減少があった接続先 */
export const balanceAlerts = computed(() => Object.entries(balances.value).filter(([, b]) => b.unexplainedUsd >= BALANCE_ALERT_USD));

function updateBalance(providerId: string, fn: (b: BalanceState) => BalanceState) {
  balances.value = { ...balances.value, [providerId]: fn(balances.value[providerId] ?? initialBalanceState()) };
}

/** 接続先固有の要求オプション（プリセットが決める） */
function providerOptionsFor(providerId: string, purpose: 'chat' | 'summary', webSearch: 'off' | 'auto' | 'on' = 'off') {
  const cfg = providerById(providerId);
  if (!cfg) return undefined;
  const preset = getPreset(cfg.preset);
  const opts = preset.requestOptions?.({ purpose, webSearch, settings: providerSettingsOf(cfg.id, preset.settings) });
  return opts ? { [preset.id]: opts } : undefined;
}

// ---- Web 検索 ----
/**
 * この会話で Web 検索をどう行うか。
 * - 'tools': ツール呼び出し対応モデル + Tavily のキー（内蔵検索がある接続先では、設定で「ツール」を選んだとき）
 * - 'builtin': 接続先の内蔵検索（features.builtInWebSearch）
 * - null: 使えない
 */
/** このモデルに一覧を見せるスキル（ツール呼び出しに対応したモデルのみ） */
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

// ---- ツールの承認待ち ----
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

/** 承認カードからの回答。「常に許可」はそのツールの設定を allow にする */
export async function resolveApproval(toolCallId: string, d: ApprovalDecision) {
  const p = pendingApprovals.value[toolCallId];
  if (d.approved && d.always && p) await saveSettings({ toolPermissions: { ...settings.value.toolPermissions, [p.toolName]: 'allow' } });
  approvalResolvers.get(toolCallId)?.(d);
}

// ---- 文脈の使用量と圧縮 ----
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

/** 古い部分を要約して圧縮ノードを追加する（元の履歴は消さない）。圧縮したら true */
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

// ---- 送信と生成 ----
/** キーが使えない場合は設定を開いて false */
function ensureKey(providerId: string): boolean {
  if (keyReady(providerId)) return true;
  openSettings('connections');
  showToast(`先に ${providerById(providerId)?.name ?? ''} の API キーを設定してください。`, 'error');
  return false;
}

export async function sendMessage(text: string) {
  const attached = attachedSkills.value.map((s) => ({ name: s.name, body: s.body }));
  if (!text.trim() && !attached.length) return;
  const cur = currentConv.value;
  if (!ensureKey(cur.providerId)) return;
  if (!cur.modelId) {
    showToast('モデルを選んでください。', 'error');
    return;
  }
  // 自動圧縮: 送ろうとしている入力が文脈長の閾値を超えそうなら、先に古い部分を要約する
  if (currentId.value && settings.value.autoCompact) {
    const u = contextUsage.value;
    if (u.limit && (u.tokens + estimateTokens(text)) / u.limit >= settings.value.compactThreshold) await compactConversation(true);
  }
  attachedSkillIds.value = [];
  const conv = await persistDraft(text.trim() ? text : attached.map((s) => s.name).join(', '));
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: currentConv.value.currentLeafId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    status: 'done',
    ...(attached.length ? { skills: attached } : {})
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await generateReply(conv.id, user.id);
}

/** parentUserId の子としてアシスタントの回答を生成する（再生成もこれを使う） */
async function generateReply(convId: string, parentUserId: string) {
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
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);

  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  const model = modelOf(cfg.id, conv.modelId);
  const webOn = conv.webSearch !== 'off';
  const search = webOn ? searchModeFor(cfg.id, conv.modelId) : null;
  const skillList = skillsFor(cfg.id, conv.modelId);
  const tools = [...(search === 'tools' ? WEB_TOOLS : []), ...(skillList.length ? [makeSkillTool(skillList)] : [])];
  const providerOptions = providerOptionsFor(cfg.id, 'chat', search === 'builtin' ? conv.webSearch : 'off');
  try {
    const final = await runAssistant({
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: conv.modelId,
      history,
      systemPrompt: withSkillCatalog(conv.systemPrompt, skillList),
      params: settings.value.temperature != null ? { temperature: settings.value.temperature } : undefined,
      providerOptions,
      contextLength: model?.contextLength,
      maxOutputTokens: model?.maxOutputTokens,
      resendReasoning: settings.value.resendReasoning,
      cacheKey: conv.id,
      tools,
      toolContext: { transport, authFor },
      permissionFor: (name) => settings.value.toolPermissions[name] ?? 'ask',
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
    if (final.meta?.costUsd && balances.value[cfg.id]) updateBalance(cfg.id, (b) => recordSpend(b, final.meta!.costUsd!));
    if (final.status === 'error' && final.error) showToast(final.error.message, 'error');
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
  if (!m?.parentId || !currentId.value || !ensureKey(conv.providerId)) return;
  await generateReply(currentId.value, m.parentId);
}

/** 別のモデルで再生成: 会話のモデルを切り替えたうえで、同じ質問への回答を新しい版として追加する */
export async function regenerateWith(assistantId: string, providerId: string, modelId: string) {
  if (!ensureKey(providerId)) return;
  await updateConversation({ providerId, modelId });
  await saveSettings({ lastProviderId: providerId, lastModelId: modelId });
  await regenerate(assistantId);
}

/** ユーザーメッセージを編集 → 兄弟として新しいメッセージを作り、回答を生成 */
export async function editUserMessage(userId: string, newText: string) {
  const conv = currentConv.value;
  const orig = messages.value.find((x) => x.id === userId);
  if (!currentId.value || !orig || !newText.trim() || !ensureKey(conv.providerId)) return;
  const user: MessageRecord = { ...orig, id: repo.newId(), parts: [{ type: 'text', text: newText }], createdAt: Date.now() };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await updateConversation({ currentLeafId: user.id });
  await generateReply(conv.id, user.id);
}

/** 兄弟ノードの切り替え（< 1/3 >） */
export async function switchSibling(msgId: string, dir: -1 | 1) {
  const all = messages.value;
  const m = all.find((x) => x.id === msgId);
  if (!m) return;
  const sibs = childrenOf(all, m.parentId);
  const target = sibs[sibs.findIndex((s) => s.id === msgId) + dir];
  if (target) await updateConversation({ currentLeafId: deepestLatestLeaf(all, target.id) });
}

/** 会話のモデルを変える（新しいチャットの既定にもなる） */
export async function chooseModel(providerId: string, modelId: string) {
  await updateConversation({ providerId, modelId } as Partial<Conversation>);
  await saveSettings({ lastProviderId: providerId, lastModelId: modelId });
}

export function abortConversation(id: string) {
  controllers.get(id)?.abort();
}
