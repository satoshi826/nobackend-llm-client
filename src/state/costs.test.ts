import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addConversationCost, conversationCosts, loadConversationCost } from './costs';
import { makeUsageRecord } from '../lib/usage';
import * as repo from '../lib/db/repo';

describe('conversation cost (header)', () => {
  it('adds known costs, counts unknown ones and marks estimates', () => {
    addConversationCost('c1', { costUsd: 0.01 });
    addConversationCost('c1', { costUsd: 0.02, costEstimated: true });
    addConversationCost('c1', { costUsd: undefined });
    expect(conversationCosts.value.c1).toEqual({ usd: 0.03, unknown: 1, estimated: true });
  });
  it('usage records carry the conversation and the estimate flag', () => {
    const r = makeUsageRecord({ id: 'u', at: 1, providerId: 'p', model: 'm', kind: 'image', costUsd: 0.04, costEstimated: true, conversationId: 'c2' });
    expect(r).toMatchObject({ conversationId: 'c2', costUsd: 0.04, costEstimated: true });
    // An image with an unknown price is still recorded (it counts as "unknown" in the total)
    expect(makeUsageRecord({ id: 'v', at: 1, providerId: 'p', model: 'm', kind: 'image' })).not.toBeNull();
  });
  it('reads a stored conversation back from the usage log', async () => {
    await repo.addUsage({ id: 'a', at: 1, providerId: 'p', model: 'm', kind: 'chat', inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, costUsd: 0.5, conversationId: 'c3' });
    await repo.addUsage({ id: 'b', at: 2, providerId: 'p', model: 'm', kind: 'chat', inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, costUsd: 0.25, conversationId: 'other' });
    await loadConversationCost('c3');
    expect(conversationCosts.value.c3).toEqual({ usd: 0.5, unknown: 0, estimated: false });
  });
});
