// Providers (LLM providers) and model lists
import { batch, computed, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { ModelInfo, ProviderConfig, ProviderError } from '../lib/providers/types';
import { getAdapter, getPreset, PRESET_ORDER, PRESETS } from '../lib/providers/registry';
import { plainTransport } from '../lib/providers/transport';
import { vaultTransport } from '../lib/vault/client';
import { authFor, keyReady } from './keys';
import { ProviderFailure } from '../lib/providers/errors';
import { providerConfigOf } from '../lib/keys/accounts';
import { compareModels } from '../lib/model-list';
import { saveSettings, settings } from './settings';
import { withListPrices } from '../lib/providers/prices';

type ModelsState = { loading: boolean; error: ProviderError | null; fetchedAt: number | null; needsKey?: boolean };
const EMPTY_MODELS_STATE: ModelsState = { loading: false, error: null, fetchedAt: null };

/** Providers are determined by presets (not stored) */
export const providers = signal<ProviderConfig[]>(PRESET_ORDER.map((id) => providerConfigOf(id)!));
export const models = signal<ModelInfo[]>([]);
export const modelsStates = signal<Record<string, ModelsState>>({});

/** Providers in use (in on-screen order, not the order they were enabled in settings) */
export const enabledProviders = computed(() => providers.value.filter((p) => settings.value.enabledProviders.includes(p.id)));

/** Selectable models (those offered by enabled providers) */
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

/** Read the stored list and refetch it if stale */
export async function loadModels() {
  const cached: ModelInfo[] = [];
  const states: Record<string, ModelsState> = {};
  // One read for every provider's cached list
  const all = await repo.listAllModels();
  for (const p of providers.value) {
    const list = all.filter((m) => m.providerId === p.id);
    cached.push(...withListPrices(list, p.preset));
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
  // For providers whose model list requires a key, do not fetch until a key is set
  if (preset.modelsNeedKey && !keyReady(providerId)) {
    setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: false, error: null, needsKey: true });
    return;
  }
  setState({ ...(modelsStates.value[providerId] ?? EMPTY_MODELS_STATE), loading: true, error: null, needsKey: false });
  try {
    // Public model lists are fetched without a key. For ones that need a key, have the vault attach it
    const list = preset.modelsNeedKey
      ? await getAdapter(cfg).listModels(cfg, preset, vaultTransport, authFor(providerId))
      : await getAdapter(cfg).listModels(cfg, preset, plainTransport);
    await repo.replaceModels(cfg.id, list);
    // Prices from the app's own list are added on reading, so a scheduled price change applies without refetching
    const priced = withListPrices(list, cfg.preset);
    batch(() => {
      models.value = sortModels([...models.value.filter((m) => m.providerId !== providerId), ...priced]);
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

/** For a provider whose key just became usable, fetch the model list if there is none yet (providers that require a key) */
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

/** Model for a new chat: the last used one -> the first enabled provider's default model -> its first model */
export function defaultModel(): { providerId: string; modelId: string } {
  const s = settings.value;
  const vis = visibleModels.value;
  // Providers that can be used right away (key ready, or no key needed) come first
  const usable = (id: string) => keyReady(id) || !!PRESETS[providerById(id)?.preset ?? '']?.keyOptional;
  if (s.lastModelId && usable(s.lastProviderId) && vis.some((m) => m.id === s.lastModelId && m.providerId === s.lastProviderId)) return { providerId: s.lastProviderId, modelId: s.lastModelId };
  const ordered = [...enabledProviders.value].sort((a, b) => Number(usable(b.id)) - Number(usable(a.id)));
  for (const p of ordered) {
    const list = vis.filter((m) => m.providerId === p.id);
    const m = list.find((x) => x.tags?.includes('default')) ?? list[0];
    if (m) return { providerId: m.providerId, modelId: m.id };
  }
  return { providerId: enabledProviders.value[0]?.id ?? '', modelId: '' };
}

// ---- Bookmarked models ----
export const modelKey = (providerId: string, modelId: string) => `${providerId}|${modelId}`;

export function isFavorite(providerId: string, modelId: string): boolean {
  return settings.value.favoriteModels.includes(modelKey(providerId, modelId));
}

export async function toggleFavorite(providerId: string, modelId: string) {
  const k = modelKey(providerId, modelId);
  const cur = settings.value.favoriteModels;
  await saveSettings({ favoriteModels: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
}
