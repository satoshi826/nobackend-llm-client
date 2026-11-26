// Recording and aggregating usage and cost (on this device only).
// Records survive deleting conversations. Temporary chats are not recorded (they promise to leave nothing behind).
import type { ModelInfo, Usage } from './providers/types';

export interface UsageRecord {
  id: string;
  /** Time of recording (ms) */
  at: number;
  providerId: string;
  model: string;
  kind: 'chat' | 'summary' | 'suggest' | 'image';
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
  return ((input - cached) * inPrice + cached * (pricing.cachedInputPerMTok ?? inPrice) + (u.outputTokens ?? 0) * (pricing.outputPerMTok ?? 0)) / 1_000_000;
}

export function makeUsageRecord(
  o: { id: string; at: number; providerId: string; model: string; kind: UsageRecord['kind']; usage?: Usage; costUsd?: number; costEstimated?: boolean; conversationId?: string },
  pricing?: ModelInfo['pricing']
): UsageRecord | null {
  const u = o.usage ?? {};
  if (!u.inputTokens && !u.outputTokens && o.costUsd === undefined && o.kind !== 'image') return null;
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

/** Date in the device's time zone (YYYY-MM-DD) */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface UsageSummary {
  total: UsageTotals;
  /** Every day in the period (days without records are 0; oldest first) */
  byDay: { day: string; totals: UsageTotals }[];
  byProvider: { providerId: string; totals: UsageTotals }[];
  byModel: { providerId: string; model: string; totals: UsageTotals }[];
}

/**
 * Aggregates from since to now. If since is null, from the first recorded day.
 * Sorted by cost, highest first (ties broken by request count).
 */
export function summarizeUsage(records: UsageRecord[], since: number | null, now = Date.now()): UsageSummary {
  const list = records.filter((r) => (since === null || r.at >= since) && r.at <= now);
  const total = zero();
  const days = new Map<string, UsageTotals>();
  const prov = new Map<string, UsageTotals>();
  const mod = new Map<string, { providerId: string; model: string; totals: UsageTotals }>();
  for (const r of list) {
    add(total, r);
    const d = localDay(r.at);
    if (!days.has(d)) days.set(d, zero());
    add(days.get(d)!, r);
    if (!prov.has(r.providerId)) prov.set(r.providerId, zero());
    add(prov.get(r.providerId)!, r);
    const k = `${r.providerId}\u0000${r.model}`;
    if (!mod.has(k)) mod.set(k, { providerId: r.providerId, model: r.model, totals: zero() });
    add(mod.get(k)!.totals, r);
  }
  // List the days in the period, including days without records (for very long periods, only the range that has records)
  const start = since ?? (list.length ? Math.min(...list.map((r) => r.at)) : now);
  const byDay: UsageSummary['byDay'] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400 && cur.getTime() <= now; i++) {
    const d = localDay(cur.getTime());
    byDay.push({ day: d, totals: days.get(d) ?? zero() });
    cur.setDate(cur.getDate() + 1);
  }
  const order = (a: UsageTotals, b: UsageTotals) => b.costUsd - a.costUsd || b.requests - a.requests;
  return {
    total,
    byDay,
    byProvider: [...prov.entries()].map(([providerId, totals]) => ({ providerId, totals })).sort((a, b) => order(a.totals, b.totals)),
    byModel: [...mod.values()].sort((a, b) => order(a.totals, b.totals))
  };
}
