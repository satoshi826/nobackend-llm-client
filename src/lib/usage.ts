// Recording and aggregating usage and cost (on this device only).
// Records survive deleting conversations. Temporary chats are not recorded (they promise to leave nothing behind).
import type { ModelInfo, Usage } from './providers/types';

export interface UsageRecord {
  id: string;
  /** Time of recording (ms) */
  at: number;
  providerId: string;
  model: string;
  kind: 'chat' | 'summary' | 'suggest' | 'image' | 'video';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Cost reported by the provider. If not reported, estimated from the model's prices (costEstimated) */
  costUsd?: number;
  costEstimated?: boolean;
  /** Conversation the request belonged to (for the conversation's total in the header) */
  conversationId?: string;
}

/**
 * Estimate from prices. inputTokens includes cached input (every adapter reports it that way); cached input is
 * charged at the cache price when the model has one, otherwise at the full input price (errs on the high side)
 */
export function estimateCost(u: Usage, pricing: ModelInfo['pricing'] | undefined): number | undefined {
  if (!pricing || (pricing.inputPerMTok == null && pricing.outputPerMTok == null)) return undefined;
  const input = u.inputTokens ?? 0;
  const cached = pricing.cachedInputPerMTok != null ? Math.min(input, u.cachedInputTokens ?? 0) : 0;
  const inPrice = pricing.inputPerMTok ?? 0;
  const full = (input - cached) * inPrice + cached * (pricing.cachedInputPerMTok ?? inPrice) + (u.outputTokens ?? 0) * (pricing.outputPerMTok ?? 0);
  return (full * (u.priceFactor ?? 1)) / 1_000_000;
}

export function makeUsageRecord(
  o: { id: string; at: number; providerId: string; model: string; kind: UsageRecord['kind']; usage?: Usage; costUsd?: number; costEstimated?: boolean; conversationId?: string },
  pricing?: ModelInfo['pricing']
): UsageRecord | null {
  const u = o.usage ?? {};
  if (!u.inputTokens && !u.outputTokens && o.costUsd === undefined && o.kind !== 'image' && o.kind !== 'video') return null;
  const est = o.costUsd === undefined ? estimateCost(u, pricing) : undefined;
  return {
    id: o.id,
    at: o.at,
    providerId: o.providerId,
    model: o.model,
    kind: o.kind,
    inputTokens: u.inputTokens ?? 0,
    cachedInputTokens: u.cachedInputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    reasoningTokens: u.reasoningTokens ?? 0,
    ...(o.costUsd !== undefined ? { costUsd: o.costUsd, ...(o.costEstimated ? { costEstimated: true } : {}) } : est !== undefined ? { costUsd: est, costEstimated: true } : {}),
    ...(o.conversationId ? { conversationId: o.conversationId } : {})
  };
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** The cost includes estimates */
  estimated: boolean;
  /** Number of records with unknown cost (prices unknown too) */
  unknownCost: number;
}

const zero = (): UsageTotals => ({ requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0, estimated: false, unknownCost: 0 });

function add(t: UsageTotals, r: UsageRecord) {
  t.requests++;
  t.inputTokens += r.inputTokens;
  t.cachedInputTokens += r.cachedInputTokens;
  t.outputTokens += r.outputTokens;
  if (r.costUsd === undefined) t.unknownCost++;
  else t.costUsd += r.costUsd;
  if (r.costEstimated) t.estimated = true;
}

/** How long each step of the period's series is */
export type UsageBucket = 'hour' | 'day' | 'week' | 'month';

/** The start of the step that holds a time, in the device's time zone (weeks start on Monday) */
export function bucketStart(ms: number, bucket: UsageBucket): number {
  const d = new Date(ms);
  if (bucket === 'hour') d.setMinutes(0, 0, 0);
  else {
    d.setHours(0, 0, 0, 0);
    if (bucket === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (bucket === 'month') d.setDate(1);
  }
  return d.getTime();
}

function nextBucket(ms: number, bucket: UsageBucket): number {
  const d = new Date(ms);
  if (bucket === 'hour') d.setHours(d.getHours() + 1);
  else if (bucket === 'day') d.setDate(d.getDate() + 1);
  else if (bucket === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** The step that keeps a period readable: hours for a day, days up to two months, weeks up to a year, then months */
export function bucketFor(from: number, now: number): UsageBucket {
  const days = (now - from) / 86_400_000;
  return days <= 1 ? 'hour' : days <= 62 ? 'day' : days <= 400 ? 'week' : 'month';
}

/** What the usage can be split by */
export type UsageSplit = 'provider' | 'model' | 'kind' | 'conversation';
export const USAGE_SPLITS: UsageSplit[] = ['provider', 'model', 'kind', 'conversation'];

/**
 * A record's key in a split: the provider id; "provider\0model"; the kind; the conversation id ('' for requests made
 * outside any conversation)
 */
export function splitKey(r: UsageRecord, split: UsageSplit): string {
  if (split === 'provider') return r.providerId;
  if (split === 'model') return `${r.providerId}\u0000${r.model}`;
  if (split === 'kind') return r.kind;
  return r.conversationId ?? '';
}

type Split<T> = Record<UsageSplit, T>;
const splits = <T>(make: () => T): Split<T> => ({ provider: make(), model: make(), kind: make(), conversation: make() });

export interface UsageSummary {
  total: UsageTotals;
  /** The period step by step, oldest first (steps without records are zero), each also by every split */
  series: { at: number; totals: UsageTotals; by: Split<Record<string, UsageTotals>> }[];
  bucket: UsageBucket;
  /** The period by every split, highest cost first (ties broken by request count) */
  by: Split<{ key: string; totals: UsageTotals }[]>;
}

/**
 * Aggregates from since to now in one pass. If since is null, from the first record. The step of the series follows
 * the length of the period (bucketFor)
 */
export function summarizeUsage(records: UsageRecord[], since: number | null, now = Date.now()): UsageSummary {
  const list = records.filter((r) => (since === null || r.at >= since) && r.at <= now);
  // A loop, not Math.min(...): spreading a very long list overflows the call stack
  const from = since ?? list.reduce((min, r) => Math.min(min, r.at), now);
  const bucket = bucketFor(from, now);
  const total = zero();
  const steps = new Map<number, { totals: UsageTotals; by: Split<Record<string, UsageTotals>> }>();
  const groups = splits(() => new Map<string, UsageTotals>());
  for (const r of list) {
    add(total, r);
    const at = bucketStart(r.at, bucket);
    let step = steps.get(at);
    if (!step) steps.set(at, (step = { totals: zero(), by: splits(() => ({})) }));
    add(step.totals, r);
    for (const split of USAGE_SPLITS) {
      const k = splitKey(r, split);
      add((step.by[split][k] ??= zero()), r);
      let t = groups[split].get(k);
      if (!t) groups[split].set(k, (t = zero()));
      add(t, r);
    }
  }
  const series: UsageSummary['series'] = [];
  for (let at = bucketStart(from, bucket); at <= now && series.length < 400; at = nextBucket(at, bucket)) series.push({ at, ...(steps.get(at) ?? { totals: zero(), by: splits(() => ({})) }) });
  const order = (a: { totals: UsageTotals }, b: { totals: UsageTotals }) => b.totals.costUsd - a.totals.costUsd || b.totals.requests - a.totals.requests;
  const sorted = (m: Map<string, UsageTotals>) => [...m].map(([key, totals]) => ({ key, totals })).sort(order);
  return { total, series, bucket, by: { provider: sorted(groups.provider), model: sorted(groups.model), kind: sorted(groups.kind), conversation: sorted(groups.conversation) } };
}
