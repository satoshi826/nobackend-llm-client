import type { ProviderAdapter, ProviderConfig, ProviderPreset } from './types';
import { openAICompatibleAdapter } from './openai-compatible';
import { anthropicAdapter } from './anthropic';
import { venicePreset } from './presets/venice';
import { openrouterPreset } from './presets/openrouter';
import { anthropicPreset, customPresets, deepseekPreset, geminiPreset, groqPreset } from './presets/more';

const BUILTIN: ProviderPreset[] = [venicePreset, openrouterPreset, anthropicPreset, geminiPreset, deepseekPreset, groqPreset];

export const PRESETS: Record<string, ProviderPreset> = Object.fromEntries([...BUILTIN, ...customPresets].map((p) => [p.id, p]));

/** Display order: alphabetical by label (no provider is privileged), including providers added at build time */
export const PRESET_ORDER: string[] = [...BUILTIN, ...customPresets]
  .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
  .map((p) => p.id);

export function getPreset(id: string): ProviderPreset {
  const p = PRESETS[id];
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

export function getAdapter(cfg: ProviderConfig): ProviderAdapter {
  switch (cfg.kind) {
    case 'openai-compatible':
      return openAICompatibleAdapter;
    case 'anthropic':
      return anthropicAdapter;
    default:
      throw new Error(`adapter not implemented: ${cfg.kind}`);
  }
}
