import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { estimateCost, localDay, makeUsageRecord, summarizeUsage, type UsageRecord } from './usage';
import { AppDB } from './db/schema';

const DAY = 86_400_000;
const rec = (o: Partial<UsageRecord>): UsageRecord => ({ id: Math.random().toString(36), at: 0, providerId: 'p', model: 'm', kind: 'chat', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, ...o });

describe('usage', () => {
  it('uses the reported cost, else estimates from pricing, else leaves it unknown', () => {
    const pricing = { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' as const };
    expect(makeUsageRecord({ id: 'a', at: 1, providerId: 'p', model: 'm', kind: 'chat', usage: { inputTokens: 10 }, costUsd: 0.5 }, pricing)).toMatchObject({ costUsd: 0.5 });
    const est = makeUsageRecord({ id: 'b', at: 1, providerId: 'p', model: 'm', kind: 'chat', usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }, pricing)!;
    expect(est.costUsd).toBeCloseTo(2);
    expect(est.costEstimated).toBe(true);
    expect(makeUsageRecord({ id: 'c', at: 1, providerId: 'p', model: 'm', kind: 'chat', usage: { inputTokens: 5 } })!.costUsd).toBeUndefined();
    expect(makeUsageRecord({ id: 'd', at: 1, providerId: 'p', model: 'm', kind: 'chat', usage: {} })).toBeNull();
    expect(estimateCost({ inputTokens: 1 }, undefined)).toBeUndefined();
  });

  it('summarizes by day (including empty days), provider and model', () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    const since = new Date(2026, 10, 23).getTime();
    const s = summarizeUsage(
      [
        rec({ at: now - 2 * DAY, providerId: 'venice', model: 'a', inputTokens: 100, outputTokens: 10, costUsd: 0.01 }),
        rec({ at: now, providerId: 'venice', model: 'a', inputTokens: 50, cachedInputTokens: 40, outputTokens: 5, costUsd: 0.02 }),
        rec({ at: now, providerId: 'anthropic', model: 'c', inputTokens: 10, outputTokens: 1 }),
        rec({ at: now - 10 * DAY, providerId: 'venice', model: 'old', inputTokens: 999, costUsd: 9 })
      ],
      since,
      now
    );
    expect(s.total).toMatchObject({ requests: 3, inputTokens: 160, cachedInputTokens: 40, outputTokens: 16, unknownCost: 1 });
    expect(s.total.costUsd).toBeCloseTo(0.03);
    expect(s.byDay.map((d) => [d.day, d.totals.requests])).toEqual([
      [localDay(since), 1],
      [localDay(since + DAY), 0],
      [localDay(now), 2]
    ]);
    expect(s.byProvider.map((p) => p.providerId)).toEqual(['venice', 'anthropic']);
    expect(s.byModel[0]).toMatchObject({ providerId: 'venice', model: 'a' });
  });

  it('backfills the usage log from existing replies when upgrading the database', async () => {
    const name = 'usage-upgrade-test';
    const old = new Dexie(name);
    old.version(3).stores({ conversations: 'id', messages: 'id, conversationId', blobs: 'id', prompts: 'id', models: '[providerId+id]', settings: 'key', skills: 'id, name, updatedAt' });
    await old.open();
    await old.table('messages').bulkPut([
      { id: 'a1', conversationId: 'c', role: 'assistant', parts: [], createdAt: 5, status: 'done', meta: { providerId: 'venice', model: 'x', usage: { inputTokens: 3, outputTokens: 4 }, costUsd: 0.1 } },
      { id: 'u1', conversationId: 'c', role: 'user', parts: [], createdAt: 4, status: 'done' }
    ]);
    old.close();
    const db = new AppDB(name);
    await db.open();
    expect(await db.usage.toArray()).toEqual([
      { id: 'a1', at: 5, providerId: 'venice', model: 'x', kind: 'chat', inputTokens: 3, cachedInputTokens: 0, outputTokens: 4, reasoningTokens: 0, costUsd: 0.1 }
    ]);
    db.close();
  });
});
