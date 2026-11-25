import type { ModelInfo, ProviderPreset } from '../types';
import { checkKey, joinUrl } from '../openai-compatible';
import { builtinBaseUrl } from '../endpoints';
import { t as tp } from '../messages';

const BASE_URL = builtinBaseUrl('openrouter', (import.meta as any).env ?? {});

/** Per-token price string → USD per million tokens */
function perMTok(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
}

export const openrouterPreset: ProviderPreset = {
  id: 'openrouter',
  label: 'OpenRouter',
  // Texts are getters so they follow the current language
  get tagline() {
    return tp('openrouter.tagline');
  },
  copy: {
    get pickerNote() {
      return tp('openrouter.pickerNote');
    },
    get destinationNote() {
      return tp('openrouter.destinationNote');
    }
  },
  defaults: {
    name: 'OpenRouter',
    kind: 'openai-compatible',
    preset: 'openrouter',
    baseUrl: BASE_URL,
    // By default, do not route through providers that store or train on data
    extraBody: { provider: { data_collection: 'deny' }, usage: { include: true } },
    modelListMode: 'fetch',
    enabled: false
  },
  browserAccess: 'direct',
  get keyGuide() {
    return tp('openrouter.keyGuide');
  },
  modelsPath: 'models',
  get corsHint() {
    return tp('cors.direct', { name: 'OpenRouter', host: 'openrouter.ai' });
  },

  mapModel(raw: any, providerId: string): ModelInfo | null {
    if (!raw?.id) return null;
    const params: string[] = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
    const inputs: string[] = Array.isArray(raw.architecture?.input_modalities) ? raw.architecture.input_modalities : [];
    const outputs: string[] = Array.isArray(raw.architecture?.output_modalities) ? raw.architecture.output_modalities : ['text'];
    if (!outputs.includes('text')) return null; // exclude image-generation-only models etc.
    return {
      providerId,
      id: String(raw.id),
      name: String(raw.name ?? raw.id),
      description: typeof raw.description === 'string' ? raw.description : undefined,
      contextLength: raw.context_length ?? raw.top_provider?.context_length,
      maxOutputTokens: raw.top_provider?.max_completion_tokens ?? undefined,
      capabilities: {
        vision: inputs.includes('image'),
        tools: params.includes('tools'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
        reasoningEffort: params.includes('reasoning') ? ['low', 'medium', 'high'] : undefined,
        webSearch: false, // web search (plugins) not supported
        jsonSchema: params.includes('structured_outputs')
      },
      pricing: { inputPerMTok: perMTok(raw.pricing?.prompt), outputPerMTok: perMTok(raw.pricing?.completion), currency: 'USD' },
      // OpenRouter relays to multiple providers. Retention policies differ per provider
      privacy: 'unknown',
      tags: String(raw.id).endsWith(':free') ? ['free'] : [],
      source: 'fetched'
    };
  },

  transformRequest(body) {
    const out = { ...body };
    // OpenRouter uses the reasoning: { effort } format
    if (out.reasoning_effort) {
      out.reasoning = { ...(out.reasoning ?? {}), effort: out.reasoning_effort };
      delete out.reasoning_effort;
    }
    return out;
  },

  validateKey: (cfg, fetchWithKey) => checkKey(joinUrl(cfg.baseUrl, 'key'), fetchWithKey, openrouterPreset.corsHint)
};
