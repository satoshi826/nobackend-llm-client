// 接続先（LLM プロバイダー）とモデル一覧
import { batch, computed, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { ModelInfo, ProviderConfig, ProviderError } from '../lib/providers/types';
import { getAdapter, getPreset, PRESET_ORDER } from '../lib/providers/registry';
import { plainTransport } from '../lib/providers/transport';
import { vaultTransport } from '../lib/vault/client';
import { authFor, keyReady } from './keys';
import { ProviderFailure } from '../lib/providers/errors';
import { providerConfigOf } from '../lib/keys/accounts';
import { compareModels } from '../lib/model-list';
import { saveSettings, settings } from './settings';

type ModelsState = { loading: boolean; error: ProviderError | null; fetchedAt: number | null; needsKey?: boolean };
const EMPTY_MODELS_STATE: ModelsState = { loading: false, error: null, fetchedAt: null };

/** 接続先はプリセットから決まる（保存しない） */
export const providers = signal<ProviderConfig[]>(PRESET_ORDER.map((id) => providerConfigOf(id)!));
export const models = signal<ModelInfo[]>([]);
export const modelsStates = signal<Record<string, ModelsState>>({});

/** 使う接続先（設定で有効にした順ではなく、画面の並び順） */
export const enabledProviders = computed(() => providers.value.filter((p) => settings.value.enabledProviders.includes(p.id)));

/** 選べるモデル（有効な接続先で提供中のもの） */
export const visibleModels = computed(() => {
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return models.value.filter((m) => enabled.has(m.providerId) && !m.offline);
});

export function providerById(id: string): ProviderConfig | undefined {
  return providers.value.find((p) => p.id === id);
}

export function hostOfProvider(id: string): string {
  const p = providerById(id);
  return p ? new URL(p.baseUrl).host : '';
}

export function modelOf(providerId: string | undefined, id: string | undefined): ModelInfo | undefined {
  if (!id) return undefined;
  return models.value.find((m) => m.id === id && (!providerId || m.providerId === providerId));
}

function sortModels(list: ModelInfo[]): ModelInfo[] {
  return [...list].sort(compareModels('recommended'));
}

/** 保存済みの一覧を読み、古ければ取り直す */
export async function loadModels() {
  const cached: ModelInfo[] = [];
  const states: Record<string, ModelsState> = {};
  for (const p of providers.value) {
    const list = await repo.listModels(p.id);
    cached.push(...list);
    states[p.id] = { ...EMPTY_MODELS_STATE, fetchedAt: list[0]?.fetchedAt ?? null };
  }
  batch(() => {
    models.value = sortModels(cached);
    modelsStates.value = states;
  });
  for (const p of enabledProviders.value) {
    const at = modelsStates.value[p.id]?.fetchedAt;
    if (!at || Date.now() - at > 6 * 3600_000) void refreshModels(p.id);
  }
}

export async function refreshModels(providerId: string) {
  const cfg = providerById(providerId);
  if (!cfg) return;
  const setState = (st: ModelsState) => (modelsStates.value = { ...modelsStates.value, [providerId]: st });
  const preset = getPreset(cfg.preset);
  // モデル一覧にキーが要る接続先は、キーを設定するまで取らない
  if (preset.modelsNeedKey && !keyReady(providerId)) {
    setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: false, error: null, needsKey: true });
    return;
  }
  setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: true, error: null, needsKey: false });
  try {
    // 公開されているモデル一覧はキーを付けずに取る。キーが要るものは金庫に付けてもらう
    const list = preset.modelsNeedKey
      ? await getAdapter(cfg).listModels(cfg, preset, vaultTransport, authFor(providerId))
      : await getAdapter(cfg).listModels(cfg, preset, plainTransport);
    await repo.replaceModels(cfg.id, list);
    batch(() => {
      models.value = sortModels([...models.value.filter((m) => m.providerId !== providerId), ...list]);
      setState({ loading: false, error: null, fetchedAt: Date.now() });
    });
  } catch (e) {
    const err: ProviderError = e instanceof ProviderFailure ? e.error : { kind: 'server', message: String(e) };
    setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: false, error: err });
  }
}

export async function refreshAllModels() {
  await Promise.all(enabledProviders.value.map((p) => refreshModels(p.id)));
}

/** キーが使えるようになった接続先で、まだモデル一覧がなければ取る（キーが要る接続先） */
export function refreshModelsNeedingKey() {
  for (const p of enabledProviders.value) {
    const st = modelsStates.value[p.id];
    if (getPreset(p.preset).modelsNeedKey && keyReady(p.id) && !st?.loading && (st?.needsKey || !st?.fetchedAt) && !st?.error) void refreshModels(p.id);
  }
}

export async function setProviderEnabled(id: string, enabled: boolean) {
  const set = new Set(settings.value.enabledProviders);
  if (enabled) set.add(id);
  else set.delete(id);
  await saveSettings({ enabledProviders: [...set] });
  if (enabled && !modelsStates.value[id]?.fetchedAt) void refreshModels(id);
}

/** 新しいチャットで使うモデル: 最後に使ったもの → 最初の有効な接続先の既定モデル → その先頭 */
export function defaultModel(): { providerId: string; modelId: string } {
  const s = settings.value;
  const vis = visibleModels.value;
  if (s.lastModelId && vis.some((m) => m.id === s.lastModelId && m.providerId === s.lastProviderId)) return { providerId: s.lastProviderId, modelId: s.lastModelId };
  for (const p of enabledProviders.value) {
    const list = vis.filter((m) => m.providerId === p.id);
    const m = list.find((x) => x.tags?.includes('default')) ?? list[0];
    if (m) return { providerId: m.providerId, modelId: m.id };
  }
  return { providerId: enabledProviders.value[0]?.id ?? '', modelId: '' };
}
