import type { ProviderAdapter, ProviderConfig, ProviderPreset } from './types';
import { openAICompatibleAdapter } from './openai-compatible';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { ENDPOINTS } from './endpoints';
import { venicePreset } from './presets/venice';
import { openrouterPreset } from './presets/openrouter';
import { anthropicPreset, customPreset, deepseekPreset, geminiPreset, groqPreset, openaiPreset } from './presets/more';
import { hostPresets } from './presets/hosts';

const BUILTIN = Object.fromEntries([venicePreset, openrouterPreset, anthropicPreset, geminiPreset, openaiPreset, deepseekPreset, groqPreset, ...hostPresets].map((p) => [p.id, p]));

/** One preset per connection: the built-in ones, and an OpenAI-compatible one for each provider added at build time */
export const PRESETS: Record<string, ProviderPreset> = Object.fromEntries(Object.values(ENDPOINTS).map((e) => [e.id, BUILTIN[e.id] ?? customPreset(e)]));

/** Display order: alphabetical by label (no provider is privileged), including providers added at build time */
export const PRESET_ORDER: string[] = Object.values(PRESETS)
  .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
  .map((p) => p.id);

export function getPreset(id: string): ProviderPreset {
  const p = PRESETS[id];
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

const ADAPTERS: Record<ProviderConfig['kind'], ProviderAdapter> = { 'openai-compatible': openAICompatibleAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter };

export const getAdapter = (cfg: ProviderConfig): ProviderAdapter => ADAPTERS[cfg.kind];
