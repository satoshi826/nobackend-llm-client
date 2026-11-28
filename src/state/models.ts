// Providers (LLM providers) and model lists
import { batch, computed, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { ModelInfo, ProviderConfig, ProviderError } from '../lib/providers/types';
import { getAdapter, getPreset, PRESET_ORDER } from '../lib/providers/registry';
import { plainTransport } from '../lib/providers/transport';
import { vaultTransport } from '../lib/vault/client';
import { authFor, keyReady, keyStatus } from './keys';
import { ProviderFailure } from '../lib/providers/errors';
import { providerConfigOf } from '../lib/keys/accounts';
import { ENDPOINTS } from '../lib/providers/endpoints';
import { compareModels } from '../lib/model-list';
import { saveSettings, settings } from './settings';
import { withListPrices } from '../lib/providers/prices';

type ModelsState = { loading: boolean; error: ProviderError | null; fetchedAt: number | null; needsKey?: boolean };
const EMPTY_MODELS_STATE: ModelsState = { loading: false, error: null, fetchedAt: null };

/** Providers are determined by presets (not stored) */
export const providers = signal<ProviderConfig[]>(PRESET_ORDER.map((id) => providerConfigOf(id)!));
export const models = signal<ModelInfo[]>([]);
export const modelsStates = signal<Record<string, ModelsState>>({});

const needsNoKey = (p: ProviderConfig) => ENDPOINTS[p.id].keyOptional;

/**
 * Connections the user added (on or off), in on-screen order: a provider is one while its key is stored (locked or
 * not); one that needs no key, while it is turned on. There is no connection without a key
 */
export const connections = computed(() => providers.value.filter((p) => (needsNoKey(p) ? settings.value.enabledProviders.includes(p.id) : keyStatus(p.id).present)));

/** Connections turned on: their models are offered, and features use their keys (in on-screen order) */
export const enabledProviders = computed(() => connections.value.filter((p) => settings.value.enabledProviders.includes(p.id)));

/** Selectable models (those offered by enabled providers) */
export const visibleModels = computed(() => {
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return models.value.filter((m) => enabled.has(m.providerId) && !m.offline);
});

/**
 * Whether an account can be used now. A connection: turned on, and its key unlocked (or it needs none). A service
 * (web search, ...): its key is set and unlocked. Every feature asks this, so a connection turned off is used nowhere
 */
export function accountInUse(id: string): boolean {
  const p = providers.value.find((x) => x.id === id);
  if (!p) return keyReady(id);
  return enabledProviders.value.includes(p) && (keyReady(id) || needsNoKey(p));
}

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
    cached.push(...withListPrices(list, p.id));
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
  const preset = getPreset(cfg.id);
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
    const priced = withListPrices(list, cfg.id);
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
    if (getPreset(p.id).modelsNeedKey && keyReady(p.id) && !st?.loading && (st?.needsKey || !st?.fetchedAt) && !st?.error) void refreshModels(p.id);
  }
}

export async function setProviderEnabled(id: string, enabled: boolean) {
  const set = new Set(settings.value.enabledProviders);
  if (enabled) set.add(id);
  else set.delete(id);
  await saveSettings({ enabledProviders: [...set] });
  if (enabled && !modelsStates.value[id]?.fetchedAt) void refreshModels(id);
}

/**
 * Model for a new chat: the last used one -> the first enabled provider's default (the model its list marks as
 * default, else the first of its preset's defaultModels it lists) -> its first model
 */
export function defaultModel(): { providerId: string; modelId: string } {
  const s = settings.value;
  const vis = visibleModels.value;
  // Connections that can be used right away (not locked) come first
  if (s.lastModelId && accountInUse(s.lastProviderId) && vis.some((m) => m.id === s.lastModelId && m.providerId === s.lastProviderId)) return { providerId: s.lastProviderId, modelId: s.lastModelId };
  const ordered = [...enabledProviders.value].sort((a, b) => Number(accountInUse(b.id)) - Number(accountInUse(a.id)));
  for (const p of ordered) {
    const list = vis.filter((m) => m.providerId === p.id);
    const hinted = (getPreset(p.id).defaultModels ?? []).map((id) => list.find((m) => m.id === id)).find((m) => m);
    const m = list.find((x) => x.tags?.includes('default')) ?? hinted ?? list[0];
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
