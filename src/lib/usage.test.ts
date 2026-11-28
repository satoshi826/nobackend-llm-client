import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { bucketFor, bucketStart, estimateCost, makeUsageRecord, summarizeUsage, type UsageRecord } from './usage';
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

  it('summarizes all of a very long record list (no spread of it into one call)', () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    const records = Array.from({ length: 300_000 }, (_, i) => rec({ at: now - (i % 30) * DAY, providerId: 'venice', model: 'a', inputTokens: 1 }));
    const s = summarizeUsage(records, null, now);
    expect(s.total.requests).toBe(300_000);
    expect(s.bucket).toBe('day');
    expect(s.series).toHaveLength(30);
  });

  it('picks a step that keeps the period readable, and starts weeks on Monday', () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    expect([bucketFor(now - DAY / 2, now), bucketFor(now - 30 * DAY, now), bucketFor(now - 200 * DAY, now), bucketFor(now - 800 * DAY, now)]).toEqual(['hour', 'day', 'week', 'month']);
    // 2026-11-25 is a Wednesday
    expect(new Date(bucketStart(now, 'week'))).toEqual(new Date(2026, 10, 23));
    expect(new Date(bucketStart(now, 'month'))).toEqual(new Date(2026, 10, 1));
  });

  it('summarizes by step (including empty ones) and by every split: provider, model, use and conversation', () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    const since = new Date(2026, 10, 23).getTime();
    const s = summarizeUsage(
      [
        rec({ at: now - 2 * DAY, providerId: 'venice', model: 'a', inputTokens: 100, outputTokens: 10, costUsd: 0.01, conversationId: 'c1' }),
        rec({ at: now, providerId: 'venice', model: 'a', kind: 'summary', inputTokens: 50, cachedInputTokens: 40, outputTokens: 5, costUsd: 0.02, conversationId: 'c2' }),
        rec({ at: now, providerId: 'anthropic', model: 'c', inputTokens: 10, outputTokens: 1, conversationId: 'c1' }),
        rec({ at: now - 10 * DAY, providerId: 'venice', model: 'old', inputTokens: 999, costUsd: 9 })
      ],
      since,
      now
    );
    expect(s.total).toMatchObject({ requests: 3, inputTokens: 160, cachedInputTokens: 40, outputTokens: 16, unknownCost: 1 });
    expect(s.total.costUsd).toBeCloseTo(0.03);
    expect(s.bucket).toBe('day');
    expect(s.series.map((d) => [d.at, d.totals.requests])).toEqual([
      [since, 1],
      [since + DAY, 0],
      [bucketStart(now, 'day'), 2]
    ]);
    expect(Object.keys(s.series[2].by.provider).sort()).toEqual(['anthropic', 'venice']);
    expect(Object.keys(s.series[2].by.kind).sort()).toEqual(['chat', 'summary']);
    expect(s.by.provider.map((p) => p.key)).toEqual(['venice', 'anthropic']);
    expect(s.by.model[0].key).toBe('venice\u0000a');
    expect(s.by.kind.map((k) => [k.key, k.totals.requests])).toEqual([['summary', 1], ['chat', 2]]);
    expect(s.by.conversation.map((c) => c.key)).toEqual(['c2', 'c1']);
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
