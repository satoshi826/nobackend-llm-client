import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseModelRef, providerOptionsFor, recordUsage } from './request-helpers';
import { conversationCosts } from './costs';
import { models } from './models';
import { DEFAULT_SETTINGS, settings } from './settings';
import * as repo from '../lib/db/repo';
import { db } from '../lib/db/schema';
import { PRESETS } from '../lib/providers/registry';

beforeEach(async () => {
  settings.value = DEFAULT_SETTINGS;
  models.value = [];
  conversationCosts.value = {};
  await db().usage.clear();
});

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('parseModelRef', () => {
  it('splits "provider|model" at the first bar, and rejects refs without a provider', () => {
    expect(parseModelRef('venice|llama|v2')).toEqual({ providerId: 'venice', modelId: 'llama|v2' });
    expect(parseModelRef('venice|')).toEqual({ providerId: 'venice', modelId: '' });
    expect(parseModelRef('|m')).toBeNull();
    expect(parseModelRef('')).toBeNull();
  });
});

describe('providerOptionsFor', () => {
  it('puts the preset’s own options under its id, and gives nothing for unknown providers', () => {
    const opts = providerOptionsFor('venice', 'chat');
    expect(Object.keys(opts ?? {})).toEqual(['venice']);
    expect(opts!.venice).toEqual(PRESETS.venice.requestOptions!({ purpose: 'chat', webSearch: 'off', settings: Object.fromEntries((PRESETS.venice.settings ?? []).map((s) => [s.key, s.default])) }));
    expect(providerOptionsFor('nope', 'chat')).toBeUndefined();
  });
});

describe('recordUsage', () => {
  it('writes the usage log and adds to the conversation’s total, estimating from the model’s price', async () => {
    models.value = [{ providerId: 'venice', id: 'm', name: 'm', capabilities: {}, source: 'fetched', pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' } }];
    recordUsage({ id: 'u1', conversationId: 'c', providerId: 'venice', model: 'm', kind: 'chat', usage: { inputTokens: 1_000_000, outputTokens: 500_000 } });
    await flush();
    const [row] = await repo.listUsage(null);
    expect(row).toMatchObject({ id: 'u1', conversationId: 'c', costUsd: 2, costEstimated: true });
    expect(conversationCosts.value.c).toMatchObject({ usd: 2 });
  });

  it('counts a temporary chat in memory only', async () => {
    recordUsage({ id: 'u2', conversationId: 't', providerId: 'venice', model: 'm', kind: 'chat', usage: { inputTokens: 5 }, costUsd: 0.1, temporary: true });
    await flush();
    expect(await repo.listUsage(null)).toEqual([]);
    expect(conversationCosts.value.t).toMatchObject({ usd: 0.1 });
  });

  it('records nothing for a request that reported neither tokens nor a cost', async () => {
    recordUsage({ id: 'u3', conversationId: 'c', providerId: 'venice', model: 'm', kind: 'suggest', usage: {} });
    await flush();
    expect(await repo.listUsage(null)).toEqual([]);
    expect(conversationCosts.value.c).toBeUndefined();
  });
});
