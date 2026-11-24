// 使用量と費用の記録・集計（この端末の中だけ）。
// 会話を消しても記録は残る。一時チャットは記録しない（どこにも残さない約束のため）。
import type { ModelInfo, Usage } from './providers/types';

export interface UsageRecord {
  id: string;
  /** 記録した時刻（ms） */
  at: number;
  providerId: string;
  model: string;
  kind: 'chat' | 'summary';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** 接続先が返した費用。返らないときはモデルの単価から推定（costEstimated） */
  costUsd?: number;
  costEstimated?: boolean;
}

/** 単価からの推定（キャッシュに当たった入力の割引は考えない＝多めに見積もる） */
export function estimateCost(u: Usage, pricing: ModelInfo['pricing'] | undefined): number | undefined {
  if (!pricing || (pricing.inputPerMTok == null && pricing.outputPerMTok == null)) return undefined;
  return ((u.inputTokens ?? 0) * (pricing.inputPerMTok ?? 0) + (u.outputTokens ?? 0) * (pricing.outputPerMTok ?? 0)) / 1_000_000;
}

export function makeUsageRecord(
  o: { id: string; at: number; providerId: string; model: string; kind: UsageRecord['kind']; usage?: Usage; costUsd?: number },
  pricing?: ModelInfo['pricing']
): UsageRecord | null {
  const u = o.usage ?? {};
  if (!u.inputTokens && !u.outputTokens && o.costUsd === undefined) return null;
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
    ...(o.costUsd !== undefined ? { costUsd: o.costUsd } : est !== undefined ? { costUsd: est, costEstimated: true } : {})
  };
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** 費用に推定が含まれる */
  estimated: boolean;
  /** 費用が分からない記録の数（単価も不明） */
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

/** その端末のタイムゾーンでの日付（YYYY-MM-DD） */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface UsageSummary {
  total: UsageTotals;
  /** 期間内のすべての日（記録のない日も 0 で入る。古い順） */
  byDay: { day: string; totals: UsageTotals }[];
  byProvider: { providerId: string; totals: UsageTotals }[];
  byModel: { providerId: string; model: string; totals: UsageTotals }[];
}

/**
 * since から now までを集計する。since が null なら記録の最初の日から。
 * 並びは費用の多い順（同じならリクエスト数）。
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
  // 期間内の日を、記録のない日も含めて並べる（長すぎる期間は記録のある範囲だけ）
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
