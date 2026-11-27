// Built-in providers other than Venice / OpenRouter, and OpenAI-compatible providers added at build time.
// All of them need a key to fetch the model list, so it is fetched through the key vault (modelsNeedKey).
import type { ModelInfo, ProviderEvent, ProviderPreset } from '../types';
import { checkKey, flexTier, joinUrl, numberOf } from '../openai-compatible';
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
  // Anthropic's web search server tool (added by the adapter when ChatRequest.webSearch is set)
  nativeWebSearch: {
    supports: () => true,
    get note() {
      return tp('anthropic.searchNote');
    }
  },
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    return model(providerId, String(raw.id), String(raw.display_name ?? raw.id), {
      contextLength: typeof raw.max_input_tokens === 'number' ? raw.max_input_tokens : undefined,
      maxOutputTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
      capabilities: { tools: true, vision: true, webSearch: true }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models?limit=1'), f, anthropicPreset.corsHint, cfg.extraHeaders as Record<string, string>)
};

// ---- Google Gemini (native generateContent API; lib/providers/gemini.ts) ----
const GEMINI_SKIP = /embedding|tts|imagen|veo|live|native-audio|aqa|learnlm|robotics|computer-use/;
/** Models that output images (the models list has no field for it; their names end in -image) */
const geminiImageOut = (id: string) => /-image(-|$)|nano-banana/.test(id);
/** Google Search together with function calling: Gemini 3 and later (text models) */
const geminiSearches = (id: string) => /^gemini-([3-9]|\d{2})/.test(id) && !geminiImageOut(id);
export const geminiPreset: ProviderPreset = {
  id: 'gemini',
  label: 'Google Gemini',
  get tagline() {
    return tp('gemini.tagline');
  },
  keyHeader: { name: 'x-goog-api-key' },
  modelsNeedKey: true,
  get keyGuide() {
    return tp('gemini.keyGuide');
  },
  // Google Search grounding (added by the adapter when ChatRequest.webSearch is set)
  nativeWebSearch: {
    supports: (id) => geminiSearches(id),
    get note() {
      return tp('gemini.searchNote');
    }
  },
  get corsHint() {
    return tp('cors.generic', { host: 'generativelanguage.googleapis.com' });
  },
  copy: {
    get destinationNote() {
      return tp('gemini.destinationNote');
    }
  },
  defaults: { name: 'Gemini', kind: 'gemini', preset: 'gemini', baseUrl: builtinBaseUrl('gemini', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models?pageSize=200',
  mapModel(raw, providerId) {
    const id = String(raw?.name ?? raw?.id ?? '').replace(/^models\//, '');
    if (!id || !/gemini|gemma/.test(id) || GEMINI_SKIP.test(id)) return null;
    const methods: string[] = Array.isArray(raw.supportedGenerationMethods) ? raw.supportedGenerationMethods : ['generateContent'];
    if (!methods.includes('generateContent')) return null;
    const imageOutput = geminiImageOut(id);
    return model(providerId, id, String(raw.displayName ?? raw.display_name ?? id), {
      description: typeof raw.description === 'string' ? raw.description : undefined,
      contextLength: typeof raw.inputTokenLimit === 'number' ? raw.inputTokenLimit : undefined,
      maxOutputTokens: typeof raw.outputTokenLimit === 'number' ? raw.outputTokenLimit : undefined,
      capabilities: {
        tools: !id.startsWith('gemma') && !imageOutput,
        vision: true,
        reasoning: raw.thinking === true || /2\.5|thinking|[3-9]\./.test(id),
        webSearch: geminiSearches(id),
        imageOutput
      }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models?pageSize=1'), f, geminiPreset.corsHint)
};

// ---- OpenAI (Chat Completions; images go through the images feature with the same key) ----
const OPENAI_SKIP = /image|audio|realtime|tts|transcribe|embedding|moderation|search|instruct|dall-e|whisper|babbage|davinci|codex|computer-use|deep-research/;
export const openaiPreset: ProviderPreset = {
  id: 'openai',
  label: 'OpenAI',
  get tagline() {
    return tp('openai.tagline');
  },
  modelsNeedKey: true,
  // Chat Completions does not take earlier reasoning back
  reasoningResend: 'never',
  get keyGuide() {
    return tp('openai.keyGuide');
  },
  get corsHint() {
    return tp('cors.generic', { host: 'api.openai.com' });
  },
  copy: {
    get destinationNote() {
      return tp('openai.destinationNote');
    }
  },
  // Flex is billed at Batch API rates, half the standard price
  ...flexTier(0.5),
  defaults: { name: 'OpenAI', kind: 'openai-compatible', preset: 'openai', baseUrl: builtinBaseUrl('openai', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    const id = String(raw?.id ?? '');
    if (!/^(gpt-|o\d|chatgpt-)/.test(id) || OPENAI_SKIP.test(id)) return null;
    const reasoning = /^o\d|^gpt-5/.test(id);
    return model(providerId, id, id, {
      capabilities: { tools: true, vision: /gpt-4o|gpt-4\.1|gpt-5|^o[34]|chatgpt/.test(id), reasoning, reasoningEffort: reasoning ? ['low', 'medium', 'high'] : undefined }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, openaiPreset.corsHint)
};

// ---- DeepSeek ----
export const deepseekPreset: ProviderPreset = {
  id: 'deepseek',
  label: 'DeepSeek',
  // Accounts topped up in CNY have no USD entry
  balanceApi: { path: 'user/balance', read: (j) => numberOf((Array.isArray(j?.balance_infos) ? j.balance_infos : []).find((b: any) => b?.currency === 'USD')?.total_balance) },
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
const GROQ_SKIP = /whisper|tts|guard|playai|orpheus|distil|compound/;
/** Models with Groq's built-in browser search (gpt-oss) */
const groqSearches = (id: string) => /^openai\/gpt-oss-(20b|120b)$/.test(id);

/**
 * Sources out of Groq's executed_tools (browser_search). Groq documents executed_tools on the message;
 * deltas are read the same way. Results without a URL are skipped.
 */
export function groqExtras(chunk: any, seen: Set<string>): ProviderEvent[] {
  const out: ProviderEvent[] = [];
  const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
  for (const src of [choice?.delta, choice?.message]) {
    for (const [i, tool] of (Array.isArray(src?.executed_tools) ? src.executed_tools : []).entries()) {
      const results: any[] = Array.isArray(tool?.search_results?.results) ? tool.search_results.results : [];
      if (tool?.type !== 'browser_search' && !/search/.test(String(tool?.name ?? '')) && !results.length) continue;
      const id = 'groq-search-' + (tool.index ?? i);
      if (!seen.has(id)) {
        seen.add(id);
        let query: string | undefined;
        try {
          query = JSON.parse(String(tool.arguments ?? '{}'))?.query;
        } catch {}
        out.push({ type: 'server-tool', id, name: 'web_search', query: typeof query === 'string' ? query : undefined, state: 'done', resultCount: results.length || undefined });
      }
      for (const r of results) {
        if (typeof r?.url !== 'string' || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({ type: 'source', url: r.url, title: typeof r.title === 'string' ? r.title : undefined });
      }
    }
  }
  return out;
}
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
  // Groq's browser search on the gpt-oss models
  nativeWebSearch: {
    supports: (id) => groqSearches(id),
    get note() {
      return tp('groq.searchNote');
    }
  },
  transformRequest(body, req) {
    if (!req.webSearch || !groqSearches(req.model)) return body;
    return { ...body, tools: [...(body.tools ?? []), { type: 'browser_search' }] };
  },
  parseExtra: groqExtras,
  mapModel(raw, providerId) {
    if (!raw?.id || raw.active === false) return null;
    const id = String(raw.id);
    if (GROQ_SKIP.test(id)) return null;
    return model(providerId, id, id, {
      contextLength: typeof raw.context_window === 'number' ? raw.context_window : undefined,
      maxOutputTokens: typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : undefined,
      capabilities: { tools: true, reasoning: /gpt-oss|qwen3|deepseek-r1|qwq/.test(id), webSearch: groqSearches(id) }
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
