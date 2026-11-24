// アプリ状態（@preact/signals）。UI 非依存の lib/ からはこのファイルを import しない。
import { batch, computed, signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { exportAll, importAll } from '../lib/db/export';
import type { Credential, ModelInfo, ProviderConfig, ProviderError } from '../lib/providers/types';
import { getAdapter, getPreset, PRESET_ORDER } from '../lib/providers/registry';
import { directTransport, hostOf } from '../lib/providers/transport';
import { ProviderFailure } from '../lib/providers/errors';
import { runAssistant, titleFrom } from '../lib/chat/runner';
import { childrenOf, deepestLatestLeaf, pathToLeaf } from '../lib/chat/tree';
import { estimateRequestTokens, planCompaction, summarize } from '../lib/chat/compact';
import { estimateTokens } from '../lib/chat/context';
import { MIN_PASSPHRASE_LENGTH } from '../lib/crypto/passphrase';
import { vault, vaultEnabled, vaultTransport } from '../lib/vault/client';
import { SERVICE_ORDER, serviceById, serviceHost } from '../lib/tools/services';
import { WEB_TOOLS } from '../lib/tools/web';
import type { Permission } from '../lib/tools/types';
import type { ApprovalDecision, ApprovalRequest } from '../lib/chat/runner';
import { initialBalanceState, observeBalance, recordSpend, type BalanceState } from '../lib/chat/balance';

/** 既定のプロバイダー（MVP からの互換のため） */
export const DEFAULT_PROVIDER_ID = 'venice';

export interface Settings {
  defaultModelId: string;
  defaultProviderId: string;
  defaultSystemPrompt: string;
  showAnonymized: boolean;
  theme: 'system' | 'light' | 'dark';
  includeVeniceSystemPrompt: boolean;
  temperature: number | null;
  lastBackupAt: number | null;
  enabledProviders: string[];
  /** 前回までの思考（reasoning_content）をモデルに送り返す */
  resendReasoning: boolean;
  /** 入力が文脈長の compactThreshold を超えたら自動で圧縮する */
  autoCompact: boolean;
  compactThreshold: number;
  /** 圧縮（要約）に使うモデル。'providerId|modelId'、空なら会話と同じモデル */
  compactModel: string;
  /** Web 検索の方式: Venice 内蔵 or ツール（Tavily + Jina）。Venice 以外のプロバイダーは常にツール */
  searchEngine: 'venice' | 'tools';
  /** ツールごとの許可（allow: 自動 / ask: 毎回確認 / deny: 禁止） */
  toolPermissions: Record<string, Permission>;
}

const DEFAULT_SETTINGS: Settings = {
  defaultModelId: '',
  defaultProviderId: DEFAULT_PROVIDER_ID,
  defaultSystemPrompt: '',
  showAnonymized: false,
  theme: 'system',
  includeVeniceSystemPrompt: false,
  temperature: null,
  lastBackupAt: null,
  enabledProviders: [DEFAULT_PROVIDER_ID],
  resendReasoning: false,
  autoCompact: false,
  compactThreshold: 0.7,
  compactModel: '',
  searchEngine: 'venice',
  toolPermissions: { web_search: 'ask', fetch_url: 'ask' }
};

type ModelsState = { loading: boolean; error: ProviderError | null; fetchedAt: number | null };
const EMPTY_KEY: repo.SecretStatus = { present: false, mode: null, locked: false, hosts: [], last4: '' };
const EMPTY_MODELS_STATE: ModelsState = { loading: false, error: null, fetchedAt: null };

// ---- signals ----
export const ready = signal(false);
/** 既知のすべての接続先（有効・無効を問わない） */
export const providers = signal<ProviderConfig[]>([]);
export const keyInfos = signal<Record<string, repo.SecretStatus>>({});
/** すべてのプロバイダーのモデル（ModelInfo.providerId で区別） */
export const models = signal<ModelInfo[]>([]);
export const modelsStates = signal<Record<string, ModelsState>>({});
export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const conversations = signal<Conversation[]>([]);
export const currentId = signal<string | null>(null);
export const messages = signal<MessageRecord[]>([]);
export const streamingConv = signal<Set<string>>(new Set());
export const newChatTemporary = signal(false);
export const newChatDraft = signal<{ providerId: string; modelId: string; systemPrompt: string; webSearch: Conversation['webSearch'] }>({
  providerId: DEFAULT_PROVIDER_ID,
  modelId: '',
  systemPrompt: '',
  webSearch: 'off'
});
export const toast = signal<{ text: string; kind: 'info' | 'error' } | null>(null);
export const sidebarOpen = signal(false);
export const modal = signal<null | 'settings' | 'models' | 'system' | 'privacy'>(null);
/** モデル選択画面の用途: 会話のモデル変更 or 別のモデルで再生成 */
export const modelPickerTarget = signal<{ kind: 'conversation' } | { kind: 'regenerate'; assistantId: string }>({ kind: 'conversation' });
/** 残高（Venice。このセッション中に観測した値）と、説明のつかない減少の累計 */
export const balance = signal<BalanceState>(initialBalanceState());
export const BALANCE_ALERT_USD = 0.5;
export const balanceAlert = computed(() => balance.value.unexplainedUsd >= BALANCE_ALERT_USD);
/** キー金庫モードなのに本体側に残っている古いキーの件数 */
export const leftoverAppSecrets = signal(0);

const controllers = new Map<string, AbortController>();
/** 生成中の下書き（別の会話を開いている間も最新状態を保持） */
const liveDrafts = new Map<string, MessageRecord>();

export const currentConv = computed(() => conversations.value.find((c) => c.id === currentId.value) ?? null);

/** いま表示している会話（または新規チャットの下書き）のプロバイダー */
export const currentProviderId = computed(() => currentConv.value?.providerId ?? newChatDraft.value.providerId);
export const provider = computed(() => providers.value.find((p) => p.id === currentProviderId.value) ?? null);
export const keyInfo = computed(() => keyInfos.value[currentProviderId.value] ?? EMPTY_KEY);

export const enabledProviders = computed(() => providers.value.filter((p) => p.id === DEFAULT_PROVIDER_ID || settings.value.enabledProviders.includes(p.id)));

export const visibleModels = computed(() => {
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return models.value.filter((m) => enabled.has(m.providerId) && !m.offline && (settings.value.showAnonymized || m.privacy !== 'anonymized'));
});

export const currentPath = computed<MessageRecord[]>(() => {
  const conv = currentConv.value;
  if (!conv) return [];
  const byId = new Map(messages.value.map((m) => [m.id, m]));
  return pathToLeaf(byId, conv.currentLeafId);
});

export const isStreaming = computed(() => (currentId.value ? streamingConv.value.has(currentId.value) : false));

/**
 * この会話（プロバイダー・モデル）で Web 検索をどう行うか。
 * - 'tools': モデルがツール呼び出しに対応し、Tavily のキーがある（Venice では設定で「ツール」を選んだとき）
 * - 'venice': Venice の内蔵検索
 * - null: 使えない
 */
export function searchModeFor(providerId: string, modelId: string): 'tools' | 'venice' | null {
  const cfg = providerById(providerId);
  const m = modelOf(providerId, modelId);
  const tavily = keyInfos.value.tavily;
  const toolsReady = !!m?.capabilities.tools && !!tavily?.present && !tavily.locked;
  if (cfg?.preset === 'venice') {
    if (settings.value.searchEngine === 'tools' && toolsReady) return 'tools';
    return m?.capabilities.webSearch === false ? (toolsReady ? 'tools' : null) : 'venice';
  }
  return toolsReady ? 'tools' : null;
}

// ---- ツールの承認待ち ----
export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  label: string;
  summary: string;
  input: unknown;
}
export const pendingApprovals = signal<Record<string, PendingApproval>>({});
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
    pendingApprovals.value = {
      ...pendingApprovals.value,
      [req.toolCallId]: { toolCallId: req.toolCallId, toolName: req.tool.name, label: req.tool.label, summary: req.tool.summarize(req.input), input: req.input }
    };
    req.signal.addEventListener('abort', () => done({ approved: false, reason: '停止しました。' }), { once: true });
  });
}

/** 承認カードからの回答。「常に許可」はそのツールの設定を allow にする */
export async function resolveApproval(toolCallId: string, d: ApprovalDecision) {
  const p = pendingApprovals.value[toolCallId];
  if (d.approved && d.always && p) await saveSettings({ toolPermissions: { ...settings.value.toolPermissions, [p.toolName]: 'allow' } });
  approvalResolvers.get(toolCallId)?.(d);
}

/** 圧縮中の会話 ID */
export const compactingConv = signal<string | null>(null);

/** いまの会話を送ったときの概算入力トークン数と、モデルの文脈長に対する割合 */
export const contextUsage = computed<{ tokens: number; limit: number | null; ratio: number | null } | null>(() => {
  const conv = currentConv.value;
  if (!conv) return null;
  const tokens = estimateRequestTokens(currentPath.value, conv.systemPrompt);
  const limit = modelOf(conv.providerId, conv.modelId)?.contextLength ?? null;
  return { tokens, limit, ratio: limit ? tokens / limit : null };
});

function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const i = ref.indexOf('|');
  return i > 0 ? { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) } : null;
}

/**
 * 会話を圧縮する（古い部分を要約し、圧縮ノードを末尾に追加）。元の履歴は消さない。
 * @returns 圧縮したら true
 */
export async function compactConversation(convId: string | null = currentId.value, auto = false): Promise<boolean> {
  const conv = conversations.value.find((c) => c.id === convId);
  if (!conv || convId !== currentId.value) return false;
  if (streamingConv.value.has(conv.id)) return false;
  const byId = new Map(messages.value.map((m) => [m.id, m]));
  const path = pathToLeaf(byId, conv.currentLeafId);
  const plan = planCompaction(path);
  if (!plan) {
    if (!auto) showToast('まだ圧縮するほど長くありません。');
    return false;
  }
  // 要約に使うモデル（設定が無効・キー未設定なら会話と同じモデル）
  let ref = parseModelRef(settings.value.compactModel);
  if (!ref || !modelOf(ref.providerId, ref.modelId) || !keyInfos.value[ref.providerId]?.present || keyInfos.value[ref.providerId]?.locked) {
    ref = { providerId: conv.providerId, modelId: conv.modelId };
  }
  const cfg = providerById(ref.providerId);
  if (!cfg) return false;
  const model = modelOf(ref.providerId, ref.modelId);
  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  compactingConv.value = conv.id;
  try {
    const summary = await summarize(plan, {
      provider: cfg,
      preset: getPreset(cfg.preset),
      credential: await getCredential(cfg.id),
      transport,
      model: ref.modelId,
      contextLength: model?.contextLength,
      providerOptions: cfg.preset === 'venice' ? { venice: { include_venice_system_prompt: false, strip_thinking_response: true } } : undefined,
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
    await repo.putMessage(node, !!conv.temporary);
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

export function modelOf(providerId: string | undefined, id: string | undefined): ModelInfo | undefined {
  if (!id) return undefined;
  return models.value.find((m) => m.id === id && (!providerId || m.providerId === providerId));
}

export function providerById(id: string): ProviderConfig | undefined {
  return providers.value.find((p) => p.id === id);
}

export function hostOfProvider(id: string): string {
  const p = providerById(id);
  try {
    return p ? new URL(p.baseUrl).host : '';
  } catch {
    return '';
  }
}

export function showToast(text: string, kind: 'info' | 'error' = 'info') {
  toast.value = { text, kind };
  setTimeout(() => {
    if (toast.value?.text === text) toast.value = null;
  }, 4000);
}

// ---- 初期化 ----
export async function init() {
  const stored = await repo.listProviders();
  const cfgs: ProviderConfig[] = [];
  for (const id of PRESET_ORDER) {
    const preset = getPreset(id);
    const prev = stored.find((p) => p.id === id);
    // 開発用の VITE_*_BASE_URL を反映するため baseUrl は常にプリセットから取る
    const cfg: ProviderConfig = { ...preset.defaults, ...(prev ?? {}), id, baseUrl: preset.defaults.baseUrl };
    await repo.putProvider(cfg);
    cfgs.push(cfg);
  }
  const s = { ...DEFAULT_SETTINGS, ...(await repo.getSetting<Partial<Settings>>('settings', {})) };
  const cached: ModelInfo[] = [];
  const states: Record<string, ModelsState> = {};
  for (const c of cfgs) {
    const list = await repo.listModels(c.id);
    cached.push(...list);
    states[c.id] = { loading: false, error: null, fetchedAt: list[0]?.fetchedAt ?? null };
  }
  batch(() => {
    providers.value = cfgs;
    settings.value = s;
    models.value = sortModels(cached);
    modelsStates.value = states;
  });
  await refreshKeyInfos();
  if (vaultEnabled) leftoverAppSecrets.value = await repo.countStoredSecrets();
  conversations.value = await repo.listConversations();
  resetNewChatDraft();
  applyTheme();
  ready.value = true;
  await restoreFromHash();
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
  for (const p of enabledProviders.value) {
    const st = modelsStates.value[p.id];
    if (!st?.fetchedAt || Date.now() - st.fetchedAt > 6 * 3600_000) void refreshModels(p.id);
  }
}

function sortModels(list: ModelInfo[]): ModelInfo[] {
  const order = (m: ModelInfo) => (m.privacy === 'private' ? 0 : m.privacy === 'unknown' ? 1 : 2);
  return [...list].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

export function resetNewChatDraft() {
  const s = settings.value;
  const d = pickDefaultModel();
  newChatDraft.value = { providerId: d.providerId, modelId: d.modelId, systemPrompt: s.defaultSystemPrompt, webSearch: 'off' };
}

function pickDefaultModel(): { providerId: string; modelId: string } {
  const s = settings.value;
  const vis = visibleModels.value;
  if (s.defaultModelId && vis.some((m) => m.id === s.defaultModelId && m.providerId === s.defaultProviderId)) {
    return { providerId: s.defaultProviderId, modelId: s.defaultModelId };
  }
  const venice = vis.filter((m) => m.providerId === DEFAULT_PROVIDER_ID);
  const m = venice.find((x) => x.tags?.includes('default')) ?? venice[0] ?? vis[0];
  return m ? { providerId: m.providerId, modelId: m.id } : { providerId: DEFAULT_PROVIDER_ID, modelId: '' };
}

export async function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  await repo.setSetting('settings', settings.value);
  if ('theme' in patch) applyTheme();
}

export async function setProviderEnabled(id: string, enabled: boolean) {
  const set = new Set(settings.value.enabledProviders);
  if (enabled) set.add(id);
  else set.delete(id);
  set.add(DEFAULT_PROVIDER_ID);
  await saveSettings({ enabledProviders: [...set] });
  if (enabled && !modelsStates.value[id]?.fetchedAt) void refreshModels(id);
}

export function applyTheme() {
  const t = settings.value.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

// ---- キー ----
/** キー金庫を使う場合、キーの保存・解錠は金庫の画面で行い、本体はキーを一切持たない */
export const transport = vaultEnabled ? vaultTransport : directTransport;

async function getCredential(providerId: string): Promise<Credential | undefined> {
  if (vaultEnabled) return { kind: 'vault', providerId };
  const s = await repo.getSecret(providerId);
  return s ? { key: s.key, hosts: s.hosts } : undefined;
}

let vaultSubscribed = false;
export async function refreshKeyInfos() {
  if (vaultEnabled) {
    if (!vaultSubscribed) {
      vaultSubscribed = true;
      vault.onStatus((st) => (keyInfos.value = st));
    }
    try {
      await vault.requestStatus();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
    return;
  }
  const out: Record<string, repo.SecretStatus> = {};
  for (const id of [...providers.value.map((p) => p.id), ...SERVICE_ORDER]) out[id] = await repo.getSecretStatus(id);
  keyInfos.value = out;
}

/** キーが設定済み（かつ解錠済み）のときだけ資格情報を返す。キーが任意のサービス（Jina）はキーなしで呼ぶ */
async function getCredentialIfPresent(id: string): Promise<Credential | undefined> {
  const st = keyInfos.value[id];
  if (!st?.present || st.locked) return undefined;
  return getCredential(id);
}

/** キーを検証してから保存する。キーは登録時のホストと組で保存する。 */
export async function saveKey(providerId: string, key: string, mode: repo.SecretMode, passphrase?: string): Promise<{ ok: boolean; message: string }> {
  const cfg = providerById(providerId);
  const service = serviceById(providerId);
  if (!cfg && !service) return { ok: false, message: '接続先が見つかりません。' };
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, message: 'キーを入力してください。' };
  if (mode === 'encrypted' && (passphrase ?? '').length < MIN_PASSPHRASE_LENGTH) {
    return { ok: false, message: `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` };
  }
  const cred: Credential = { key: trimmed, hosts: [cfg ? hostOf(cfg.baseUrl) : serviceHost(providerId)] };
  const preset = cfg ? getPreset(cfg.preset) : undefined;
  if (cfg && preset?.validateKey) {
    const r = await preset.validateKey(cfg, cred, directTransport);
    if (!r.ok) return { ok: false, message: r.error?.message ?? 'キーを確認できませんでした。' };
  }
  await repo.setSecret({ id: providerId, key: trimmed, hosts: cred.hosts }, mode, passphrase);
  await refreshKeyInfos();
  return { ok: true, message: mode === 'encrypted' ? 'キーを暗号化して保存しました。次回からは起動時にパスフレーズを入力します。' : 'キーを保存しました。' };
}

export async function unlockKey(providerId: string, passphrase: string): Promise<{ ok: boolean; message: string }> {
  try {
    await repo.unlockSecret(providerId, passphrase);
    await refreshKeyInfos();
    return { ok: true, message: '解錠しました。' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function lockKey(providerId: string) {
  for (const c of conversations.value) if (c.providerId === providerId) controllers.get(c.id)?.abort();
  repo.lockSecret(providerId);
  await refreshKeyInfos();
}

export async function removeKey(providerId: string) {
  await repo.deleteSecret(providerId);
  await refreshKeyInfos();
}

// ---- モデル ----
export async function refreshModels(providerId: string = currentProviderId.value) {
  const cfg = providerById(providerId);
  if (!cfg) return;
  const setState = (st: ModelsState) => (modelsStates.value = { ...modelsStates.value, [providerId]: st });
  setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: true, error: null });
  try {
    const preset = getPreset(cfg.preset);
    // モデル一覧はキー不要（Venice・OpenRouter とも公開）。キーを送る必要がない処理には送らない。
    const list = await getAdapter(cfg).listModels(cfg, preset, undefined, directTransport);
    await repo.replaceModels(cfg.id, list);
    batch(() => {
      models.value = sortModels([...models.value.filter((m) => m.providerId !== providerId), ...list]);
      setState({ loading: false, error: null, fetchedAt: Date.now() });
    });
    if (!newChatDraft.value.modelId) resetNewChatDraft();
  } catch (e) {
    const err: ProviderError = e instanceof ProviderFailure ? e.error : { kind: 'server', message: String(e) };
    setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: false, error: err });
  }
}

export async function refreshAllModels() {
  await Promise.all(enabledProviders.value.map((p) => refreshModels(p.id)));
}

// ---- 会話 ----
export async function reloadConversations() {
  conversations.value = await repo.listConversations();
}

export function startNewChat(temporary = false) {
  batch(() => {
    currentId.value = null;
    messages.value = [];
    newChatTemporary.value = temporary;
    sidebarOpen.value = false;
  });
  resetNewChatDraft();
  setHash(null);
}

export async function openConversation(id: string) {
  const stored = await repo.listMessages(id);
  // 生成中の下書きは DB より新しいのでメモリ上のものを優先する
  // 生成中のまま残ったもの（再読み込み等で中断）は「停止」扱いにする
  const list = stored.map((m) => liveDrafts.get(m.id) ?? (m.status === 'streaming' ? { ...m, status: 'aborted' as const } : m));
  for (const d of liveDrafts.values()) if (d.conversationId === id && !list.some((m) => m.id === d.id)) list.push(d);
  batch(() => {
    currentId.value = id;
    messages.value = list;
    sidebarOpen.value = false;
  });
  setHash(id);
}

// ---- URL（#/c/<id>）----
function setHash(id: string | null) {
  const conv = id ? conversations.value.find((c) => c.id === id) : null;
  const next = conv && !conv.temporary ? `#/c/${id}` : '';
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}

export async function restoreFromHash() {
  const m = /^#\/c\/([\w-]+)$/.exec(location.hash);
  if (m && conversations.value.some((c) => c.id === m[1])) await openConversation(m[1]);
}

export async function updateConversation(patch: Partial<Conversation>, id = currentId.value) {
  if (!id) {
    // 新規チャット画面での変更は下書きに入れる
    const d = newChatDraft.value;
    newChatDraft.value = {
      providerId: patch.providerId ?? d.providerId,
      modelId: patch.modelId ?? d.modelId,
      systemPrompt: patch.systemPrompt ?? d.systemPrompt,
      webSearch: patch.webSearch ?? d.webSearch
    };
    return;
  }
  const conv = conversations.value.find((c) => c.id === id);
  if (!conv) return;
  const next = { ...conv, ...patch };
  conversations.value = conversations.value.map((c) => (c.id === id ? next : c));
  await repo.putConversation(next);
}

export async function removeConversation(id: string) {
  controllers.get(id)?.abort();
  await repo.deleteConversation(id);
  if (currentId.value === id) startNewChat();
  await reloadConversations();
}

// ---- メッセージ送信 ----
let pendingFlush = 0;
const pendingUpdates = new Map<string, MessageRecord>();

/** ストリーミング中の更新は requestAnimationFrame ごとにまとめて反映 */
function scheduleMessageUpdate(m: MessageRecord) {
  pendingUpdates.set(m.id, { ...m, parts: m.parts.map((p) => ({ ...p })) });
  if (pendingFlush) return;
  pendingFlush = requestAnimationFrame(flushUpdates);
}

function flushUpdates() {
  pendingFlush = 0;
  if (pendingUpdates.size === 0) return;
  const ups = new Map(pendingUpdates);
  pendingUpdates.clear();
  let changed = false;
  const next = messages.value.map((m) => {
    const u = ups.get(m.id);
    if (u) {
      changed = true;
      return u;
    }
    return m;
  });
  if (changed) messages.value = next;
}

function setStreaming(convId: string, on: boolean) {
  const s = new Set(streamingConv.value);
  if (on) s.add(convId);
  else s.delete(convId);
  streamingConv.value = s;
}

async function ensureConversation(firstText: string): Promise<Conversation> {
  const existing = currentConv.value;
  if (existing) return existing;
  const d = newChatDraft.value;
  const now = Date.now();
  const conv: Conversation = {
    id: repo.newId(),
    title: titleFrom(firstText),
    createdAt: now,
    updatedAt: now,
    currentLeafId: null,
    providerId: d.providerId,
    modelId: d.modelId,
    systemPrompt: d.systemPrompt,
    webSearch: d.webSearch,
    pinned: 0,
    tags: [],
    temporary: newChatTemporary.value || undefined
  };
  await repo.putConversation(conv);
  batch(() => {
    conversations.value = [conv, ...conversations.value];
    currentId.value = conv.id;
    messages.value = [];
  });
  setHash(conv.id);
  return conv;
}

export async function sendMessage(text: string) {
  if (!text.trim()) return;
  if (!keyInfo.value.present || keyInfo.value.locked) {
    modal.value = 'settings';
    showToast(`先に ${provider.value?.name ?? ''} の API キーを設定してください。`, 'error');
    return;
  }
  const modelId = currentConv.value?.modelId ?? newChatDraft.value.modelId;
  if (!modelId) {
    modal.value = 'models';
    showToast('モデルを選んでください。', 'error');
    return;
  }
  // 自動圧縮: 送ろうとしている入力が文脈長の閾値を超えそうなら、先に古い部分を要約する
  const cur = currentConv.value;
  if (cur && settings.value.autoCompact) {
    const usage = contextUsage.value;
    const extra = estimateTokens(text);
    if (usage && usage.limit && (usage.tokens + extra) / usage.limit >= settings.value.compactThreshold) {
      await compactConversation(cur.id, true);
    }
  }
  const conv = await ensureConversation(text);
  const parentId = conv.currentLeafId;
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    status: 'done'
  };
  await repo.putMessage(user, !!conv.temporary);
  messages.value = [...messages.value, user];
  await generateReply(conv.id, user.id);
}

/** parentUserId の子としてアシスタントの回答を生成する（再生成もこれを使う） */
export async function generateReply(convId: string, parentUserId: string) {
  const conv = conversations.value.find((c) => c.id === convId);
  const cfg = conv ? providerById(conv.providerId) : undefined;
  if (!conv || !cfg) return;
  if (streamingConv.value.has(convId)) return;
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
  const byId = new Map(messages.value.map((m) => [m.id, m]));
  const history = pathToLeaf(byId, parentUserId);
  messages.value = [...messages.value, draft];
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);

  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  const model = modelOf(cfg.id, conv.modelId);
  const search = searchModeFor(cfg.id, conv.modelId);
  const webOn = conv.webSearch !== 'off';
  const providerOptions: Record<string, Record<string, unknown>> = {};
  if (cfg.preset === 'venice') {
    const veniceOpts: Record<string, unknown> = { include_venice_system_prompt: settings.value.includeVeniceSystemPrompt };
    if (webOn && search === 'venice') veniceOpts.enable_web_search = conv.webSearch;
    providerOptions.venice = veniceOpts;
  }
  const tools = webOn && search === 'tools' ? WEB_TOOLS : [];
  try {
    const final = await runAssistant({
      provider: cfg,
      preset: getPreset(cfg.preset),
      credential: await getCredential(cfg.id),
      transport,
      model: conv.modelId,
      history,
      systemPrompt: conv.systemPrompt,
      params: settings.value.temperature != null ? { temperature: settings.value.temperature } : undefined,
      providerOptions,
      contextLength: model?.contextLength,
      maxOutputTokens: model?.maxOutputTokens,
      resendReasoning: settings.value.resendReasoning,
      cacheKey: conv.id,
      tools,
      toolContext: { transport, credentialFor: (id) => getCredentialIfPresent(id) },
      permissionFor: (name) => settings.value.toolPermissions[name] ?? 'ask',
      requestApproval: (req) => waitForApproval(req),
      draft,
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === 'account' && ev.balanceUsd !== undefined && cfg.preset === 'venice') balance.value = observeBalance(balance.value, ev.balanceUsd);
      },
      onUpdate: (m) => {
        liveDrafts.set(m.id, { ...m, parts: m.parts.map((p) => ({ ...p })) });
        if (currentId.value === conv.id) scheduleMessageUpdate(m);
      },
      persist: (m) => repo.putMessage(m, !!conv.temporary)
    });
    if (currentId.value === conv.id) {
      scheduleMessageUpdate(final);
      flushUpdates();
    }
    if (final.meta?.costUsd && cfg.preset === 'venice') balance.value = recordSpend(balance.value, final.meta.costUsd);
    if (final.status === 'error' && final.error) showToast(final.error.message, 'error');
  } finally {
    liveDrafts.delete(draft.id);
    controllers.delete(conv.id);
    setStreaming(conv.id, false);
    await updateConversation({ updatedAt: Date.now() }, conv.id);
    conversations.value = [...conversations.value].sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt);
  }
}

export function stopGeneration() {
  if (currentId.value) controllers.get(currentId.value)?.abort();
}

/** 別のモデルで再生成: 会話のモデルを切り替えたうえで、同じ質問への回答を新しい版として追加する */
export async function regenerateWith(assistantId: string, providerId: string, modelId: string) {
  const st = keyInfos.value[providerId];
  if (!st?.present || st.locked) {
    modal.value = 'settings';
    showToast(`先に ${providerById(providerId)?.name ?? ''} の API キーを設定してください。`, 'error');
    return;
  }
  await updateConversation({ providerId, modelId });
  await regenerate(assistantId);
}

export function openModelPicker(target: { kind: 'conversation' } | { kind: 'regenerate'; assistantId: string } = { kind: 'conversation' }) {
  modelPickerTarget.value = target;
  modal.value = 'models';
}

export async function regenerate(assistantId: string) {
  const m = messages.value.find((x) => x.id === assistantId);
  if (!m?.parentId || !currentId.value) return;
  await generateReply(currentId.value, m.parentId);
}

/** ユーザーメッセージを編集 → 兄弟として新しいメッセージを作り、回答を生成 */
export async function editUserMessage(userId: string, newText: string) {
  const conv = currentConv.value;
  const orig = messages.value.find((x) => x.id === userId);
  if (!conv || !orig || !newText.trim()) return;
  const user: MessageRecord = { ...orig, id: repo.newId(), parts: [{ type: 'text', text: newText }], createdAt: Date.now() };
  await repo.putMessage(user, !!conv.temporary);
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
  const i = sibs.findIndex((s) => s.id === msgId);
  const target = sibs[i + dir];
  if (!target) return;
  await updateConversation({ currentLeafId: deepestLatestLeaf(all, target.id) });
}

// ---- データ管理 ----
export async function downloadExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nobackend-llm-client-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await saveSettings({ lastBackupAt: Date.now() });
}

export async function importFromFile(file: File) {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした。');
  }
  const r = await importAll(json);
  await reloadConversations();
  return r;
}

export async function clearLeftoverAppSecrets() {
  await repo.clearStoredSecrets();
  leftoverAppSecrets.value = 0;
}

export async function wipeEverything() {
  for (const c of controllers.values()) c.abort();
  await repo.wipeAll();
  location.reload();
}
