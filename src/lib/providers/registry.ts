import type { ProviderAdapter, ProviderConfig, ProviderPreset } from './types';
import { openAICompatibleAdapter } from './openai-compatible';
import { venicePreset } from './presets/venice';
import { openrouterPreset } from './presets/openrouter';

export const PRESETS: Record<string, ProviderPreset> = {
  venice: venicePreset,
  openrouter: openrouterPreset
};

/** 画面に出す順番 */
export const PRESET_ORDER = ['venice', 'openrouter'] as const;

export function getPreset(id: string): ProviderPreset {
  const p = PRESETS[id];
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

export function getAdapter(cfg: ProviderConfig): ProviderAdapter {
  switch (cfg.kind) {
    case 'openai-compatible':
      return openAICompatibleAdapter;
    default:
      throw new Error(`adapter not implemented: ${cfg.kind}`);
  }
}
