// Shared by reply generation, compaction and reply suggestions
import type { Usage } from '../lib/providers/types';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { makeUsageRecord } from '../lib/usage';
import { providerSettingsOf } from './settings';
import { modelOf, providerById } from './models';

/** Provider-specific request options (decided by the preset) */
export function providerOptionsFor(providerId: string, purpose: 'chat' | 'summary', webSearch: 'off' | 'auto' | 'on' = 'off') {
  const cfg = providerById(providerId);
  if (!cfg) return undefined;
  const preset = getPreset(cfg.preset);
  const opts = preset.requestOptions?.({ purpose, webSearch, settings: providerSettingsOf(cfg.id, preset.settings) });
  return opts ? { [preset.id]: opts } : undefined;
}

/** Record usage (temporary chats are not recorded) */
export function recordUsage(o: { id: string; providerId: string; model: string; kind: 'chat' | 'summary' | 'suggest' | 'image'; usage?: Usage; costUsd?: number; temporary?: boolean }) {
  if (o.temporary) return;
  const r = makeUsageRecord({ ...o, at: Date.now() }, modelOf(o.providerId, o.model)?.pricing);
  if (r) void repo.addUsage(r).catch(() => {});
}

export function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const i = ref.indexOf('|');
  return i > 0 ? { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) } : null;
}
