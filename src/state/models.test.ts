import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultModel, enabledProviders, isFavorite, modelOf, models, modelsStates, refreshModels, toggleFavorite, visibleModels } from './models';
import { authFor, keyInfos, keyReady } from './keys';
import { DEFAULT_SETTINGS, settings, type Settings } from './settings';
import { EMPTY_KEY_STATUS } from '../lib/keys/accounts';
import { PRESET_ORDER } from '../lib/providers/registry';
import type { ModelInfo } from '../lib/providers/types';

const model = (providerId: string, id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ providerId, id, name: id, capabilities: {}, source: 'fetched', ...extra });
const withKeys = (...ids: string[]) => (keyInfos.value = Object.fromEntries(ids.map((id) => [id, { ...EMPTY_KEY_STATUS, present: true }])));
const use = (patch: Partial<Settings>) => (settings.value = { ...DEFAULT_SETTINGS, ...patch });

beforeEach(() => {
  use({});
  keyInfos.value = {};
  models.value = [];
  modelsStates.value = {};
});
afterEach(() => vi.unstubAllGlobals());

describe('keys', () => {
  it('a key is usable only when it is set and unlocked', () => {
    keyInfos.value = { a: { ...EMPTY_KEY_STATUS, present: true }, b: { ...EMPTY_KEY_STATUS, present: true, locked: true } };
    expect(keyReady('a')).toBe(true);
    expect(keyReady('b')).toBe(false);
    expect(keyReady('c')).toBe(false);
    expect(authFor('a')).toEqual({ keyId: 'a' });
    expect(authFor('b')).toBeUndefined();
  });
});

describe('providers and models', () => {
  it('lists enabled providers in on-screen order, whatever order they were enabled in', () => {
    use({ enabledProviders: ['venice', 'anthropic', 'openrouter'] });
    const order = enabledProviders.value.map((p) => p.id);
    expect(order).toEqual(PRESET_ORDER.filter((id) => ['venice', 'anthropic', 'openrouter'].includes(id)));
  });

  it('offers only models of enabled providers that are online', () => {
    use({ enabledProviders: ['venice'] });
    models.value = [model('venice', 'a'), model('venice', 'gone', { offline: true }), model('openrouter', 'b')];
    expect(visibleModels.value.map((m) => m.id)).toEqual(['a']);
  });

  it('finds a model by id, within one provider when given', () => {
    models.value = [model('venice', 'same'), model('openrouter', 'same', { name: 'OR' })];
    expect(modelOf('openrouter', 'same')?.name).toBe('OR');
    expect(modelOf(undefined, 'same')?.providerId).toBe('venice');
    expect(modelOf('venice', undefined)).toBeUndefined();
  });
});

describe('defaultModel', () => {
  beforeEach(() => {
    models.value = [model('venice', 'v1'), model('venice', 'v2', { tags: ['default'] }), model('openrouter', 'o1')];
  });

  it('starts with the last used model when its provider can be used', () => {
    use({ enabledProviders: ['venice', 'openrouter'], lastProviderId: 'openrouter', lastModelId: 'o1' });
    withKeys('openrouter');
    expect(defaultModel()).toEqual({ providerId: 'openrouter', modelId: 'o1' });
  });

  it('otherwise picks a provider with a usable key first, and its default model', () => {
    use({ enabledProviders: ['venice', 'openrouter'], lastProviderId: 'openrouter', lastModelId: 'o1' });
    withKeys('venice');
    expect(defaultModel()).toEqual({ providerId: 'venice', modelId: 'v2' });
  });

  it('skips a last used model that is no longer offered', () => {
    use({ enabledProviders: ['openrouter'], lastProviderId: 'openrouter', lastModelId: 'removed' });
    withKeys('openrouter');
    expect(defaultModel()).toEqual({ providerId: 'openrouter', modelId: 'o1' });
  });

  it('falls back to the first enabled provider with no model when nothing is listed', () => {
    models.value = [];
    use({ enabledProviders: ['venice'] });
    expect(defaultModel()).toEqual({ providerId: 'venice', modelId: '' });
    use({ enabledProviders: [] });
    expect(defaultModel()).toEqual({ providerId: '', modelId: '' });
  });
});

describe('model lists', () => {
  it('waits for a key before fetching a list that needs one', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await refreshModels('anthropic');
    expect(fetch).not.toHaveBeenCalled();
    expect(modelsStates.value.anthropic).toMatchObject({ loading: false, needsKey: true, error: null });
  });

  it('keeps the error of a failed fetch and the models it had', async () => {
    models.value = [model('venice', 'cached')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"down"}', { status: 503 })));
    await refreshModels('venice');
    expect(modelsStates.value.venice).toMatchObject({ loading: false, error: { kind: 'server', status: 503 } });
    expect(models.value.map((m) => m.id)).toEqual(['cached']);
  });
});

describe('bookmarked models', () => {
  it('toggles a bookmark per provider and model', async () => {
    await toggleFavorite('venice', 'm');
    expect(isFavorite('venice', 'm')).toBe(true);
    expect(isFavorite('openrouter', 'm')).toBe(false);
    await toggleFavorite('venice', 'm');
    expect(isFavorite('venice', 'm')).toBe(false);
  });
});
