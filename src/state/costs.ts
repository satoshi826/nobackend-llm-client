// Estimated total cost of each conversation (shown in the chat header).
// Every recorded request adds to it (chat replies, summaries, reply suggestions, images); stored conversations
// are read back from the usage log, temporary ones live only in memory.
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { UsageRecord } from '../lib/usage';

export interface ConversationCost {
  /** Sum of the known costs (reported or estimated) in USD */
  usd: number;
  /** Requests whose cost is unknown (no price for the model) */
  unknown: number;
  /** Some of usd is an estimate */
  estimated: boolean;
}

export const conversationCosts = signal<Record<string, ConversationCost>>({});
const loaded = new Set<string>();

function add(c: ConversationCost | undefined, r: Pick<UsageRecord, 'costUsd' | 'costEstimated'>): ConversationCost {
  const base = c ?? { usd: 0, unknown: 0, estimated: false };
  return r.costUsd === undefined ? { ...base, unknown: base.unknown + 1 } : { usd: base.usd + r.costUsd, unknown: base.unknown, estimated: base.estimated || !!r.costEstimated };
}

/** Count one request toward its conversation */
export function addConversationCost(conversationId: string, r: Pick<UsageRecord, 'costUsd' | 'costEstimated'>) {
  conversationCosts.value = { ...conversationCosts.value, [conversationId]: add(conversationCosts.value[conversationId], r) };
}

/** Read a stored conversation's total from the usage log (once) */
export async function loadConversationCost(conversationId: string) {
  if (!conversationId || loaded.has(conversationId)) return;
  loaded.add(conversationId);
  let total: ConversationCost | undefined;
  for (const r of await repo.usageForConversation(conversationId)) total = add(total, r);
  // Requests recorded while loading were already added to the signal; the log has them too, so the log wins
  if (total) conversationCosts.value = { ...conversationCosts.value, [conversationId]: total };
}

/** Forget totals (after deleting data) */
export function resetConversationCosts() {
  loaded.clear();
  conversationCosts.value = {};
}
