// Built-in providers other than Venice / OpenRouter, and OpenAI-compatible providers added at build time.
// All of them need a key to fetch the model list, so it is fetched through the key vault (modelsNeedKey).
import type { ModelInfo, ProviderPreset } from '../types';
import { checkKey, joinUrl } from '../openai-compatible';
import { builtinBaseUrl, parseCustomProviders, type CustomProviderDef } from '../endpoints';
import { t as tp } from '../messages';

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

function model(providerId: string, id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { providerId, id, name, capabilities: {}, privacy: 'unknown', source: 'fetched', ...extra };
}

// ---- Anthropic (native Messages API) ----
export const anthropicPreset: ProviderPreset = {
  id: 'anthropic',
  label: 'Anthropic',
  // Texts are getters so they follow the current language
  get tagline() {
    return tp('anthropic.tagline');
  },
  keyHeader: { name: 'x-api-key' },
  modelsNeedKey: true,
  get keyGuide() {
    return tp('anthropic.keyGuide');
  },
  get corsHint() {
    return tp('cors.generic', { host: 'api.anthropic.com' });
  },
  defaults: {
    name: 'Anthropic',
    kind: 'anthropic',
    preset: 'anthropic',
    baseUrl: builtinBaseUrl('anthropic', env),
    extraHeaders: { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    modelListMode: 'fetch',
    enabled: false
  },
  browserAccess: 'needs-header',
  modelsPath: 'models?limit=100',
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    return model(providerId, String(raw.id), String(raw.display_name ?? raw.id), {
      contextLength: typeof raw.max_input_tokens === 'number' ? raw.max_input_tokens : undefined,
      maxOutputTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
      capabilities: { tools: true, vision: true }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models?limit=1'), f, anthropicPreset.corsHint, cfg.extraHeaders as Record<string, string>)
};

// ---- Google Gemini (OpenAI-compatible endpoint) ----
const GEMINI_SKIP = /embedding|tts|image|imagen|veo|live|native-audio|aqa|learnlm/;
export const geminiPreset: ProviderPreset = {
  id: 'gemini',
  label: 'Google Gemini',
  get tagline() {
    return tp('gemini.tagline');
  },
  modelsNeedKey: true,
  reasoningResend: 'never',
  get keyGuide() {
    return tp('gemini.keyGuide');
  },
  get corsHint() {
    return tp('cors.generic', { host: 'generativelanguage.googleapis.com' });
  },
  copy: {
    get destinationNote() {
      return tp('gemini.destinationNote');
    }
  },
  defaults: { name: 'Gemini', kind: 'openai-compatible', preset: 'gemini', baseUrl: builtinBaseUrl('gemini', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    const id = String(raw?.id ?? '').replace(/^models\//, '');
    if (!id || !/gemini|gemma/.test(id) || GEMINI_SKIP.test(id)) return null;
    return model(providerId, id, String(raw.display_name ?? id), { capabilities: { tools: !id.startsWith('gemma'), vision: true, reasoning: /2\.5|thinking|[3-9]\./.test(id) } });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, geminiPreset.corsHint)
};

// ---- DeepSeek ----
export const deepseekPreset: ProviderPreset = {
  id: 'deepseek',
  label: 'DeepSeek',
  get tagline() {
    return tp('deepseek.tagline');
  },
  modelsNeedKey: true,
  // Sending reasoning back on a different message is rejected, so send it back only in the middle of tool calls
  reasoningResend: 'tool-turns',
  get keyGuide() {
    return tp('deepseek.keyGuide');
  },
  get corsHint() {
    return tp('cors.generic', { host: 'api.deepseek.com' });
  },
  copy: {
    get destinationNote() {
      return tp('deepseek.destinationNote');
    }
  },
  defaults: { name: 'DeepSeek', kind: 'openai-compatible', preset: 'deepseek', baseUrl: builtinBaseUrl('deepseek', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    const id = String(raw.id);
    return model(providerId, id, id, { capabilities: { tools: true, reasoning: id.includes('reasoner') }, tags: id === 'deepseek-chat' ? ['default'] : [] });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, deepseekPreset.corsHint)
};

// ---- Groq ----
const GROQ_SKIP = /whisper|tts|guard|playai|orpheus|distil/;
export const groqPreset: ProviderPreset = {
  id: 'groq',
  label: 'Groq',
  get tagline() {
    return tp('groq.tagline');
  },
  modelsNeedKey: true,
  reasoningResend: 'never',
  get keyGuide() {
    return tp('groq.keyGuide');
  },
  get corsHint() {
    return tp('cors.generic', { host: 'api.groq.com' });
  },
  defaults: { name: 'Groq', kind: 'openai-compatible', preset: 'groq', baseUrl: builtinBaseUrl('groq', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    if (!raw?.id || raw.active === false) return null;
    const id = String(raw.id);
    if (GROQ_SKIP.test(id)) return null;
    return model(providerId, id, id, {
      contextLength: typeof raw.context_window === 'number' ? raw.context_window : undefined,
      maxOutputTokens: typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : undefined,
      capabilities: { tools: true, reasoning: /gpt-oss|qwen3|deepseek-r1|qwq/.test(id) }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, groqPreset.corsHint)
};

// ---- OpenAI-compatible providers added at build time (VITE_CUSTOM_PROVIDERS) ----
export function customPreset(c: CustomProviderDef): ProviderPreset {
  const host = new URL(c.baseUrl).host;
  return {
    id: c.id,
    label: c.label,
    get tagline() {
      return tp('custom.tagline', { host });
    },
    keyOptional: c.keyOptional,
    modelsNeedKey: !c.publicModels,
    reasoningResend: 'never',
    get keyGuide() {
      return c.keyOptional ? tp('custom.keyGuideOptional') : tp('custom.keyGuide', { name: c.label });
    },
    get corsHint() {
      return tp('custom.corsHint', { host });
    },
    defaults: { name: c.label, kind: 'openai-compatible', preset: c.id, baseUrl: c.baseUrl, modelListMode: 'fetch', enabled: false },
    browserAccess: 'unknown',
    modelsPath: 'models',
    validateKey: c.keyOptional ? undefined : (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, tp('custom.checkConnection', { host }))
  };
}

export const customPresets: ProviderPreset[] = parseCustomProviders(env.VITE_CUSTOM_PROVIDERS).map(customPreset);
