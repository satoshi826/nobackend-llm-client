// Shared by reply generation, compaction and reply suggestions
import type { Usage } from '../lib/providers/types';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { makeUsageRecord } from '../lib/usage';
import { providerSettingsOf } from './settings';
import { modelOf, providerById } from './models';
import { addConversationCost } from './costs';

/** Provider-specific request options (decided by the preset) */
export function providerOptionsFor(providerId: string, purpose: 'chat' | 'summary', webSearch: 'off' | 'auto' | 'on' = 'off') {
  const cfg = providerById(providerId);
  if (!cfg) return undefined;
  const preset = getPreset(cfg.preset);
  const opts = preset.requestOptions?.({ purpose, webSearch, settings: providerSettingsOf(cfg.id, preset.settings) });
  return opts ? { [preset.id]: opts } : undefined;
}

/**
 * Record usage. It also counts toward the conversation's total (header); temporary chats are counted
 * in memory only and never written to the log.
 */
export function recordUsage(o: {
  id: string;
  conversationId?: string;
  providerId: string;
  model: string;
  kind: 'chat' | 'summary' | 'suggest' | 'image';
  usage?: Usage;
  costUsd?: number;
  costEstimated?: boolean;
  temporary?: boolean;
}) {
  const r = makeUsageRecord({ ...o, at: Date.now() }, modelOf(o.providerId, o.model)?.pricing);
  if (!r) return;
  if (o.conversationId) addConversationCost(o.conversationId, r);
  if (!o.temporary) void repo.addUsage(r).catch(() => {});
}

export function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const i = ref.indexOf('|');
  return i > 0 ? { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) } : null;
}
