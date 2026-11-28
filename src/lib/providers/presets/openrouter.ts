import type { ModelInfo, ProviderEvent, ProviderPreset } from '../types';
import { checkKey, joinUrl, numberOf } from '../openai-compatible';
import { builtinBaseUrl } from '../endpoints';
import { timeOf } from './hosts';
import { t as tp } from '../messages';

const BASE_URL = builtinBaseUrl('openrouter', (import.meta as any).env ?? {});

/** Search results per search (OpenRouter bills per search request) */
const MAX_RESULTS = 5;
/** Quantizations of 6 bits or more, and providers that do not say (the noLowBits setting) */
const ENOUGH_BITS = ['fp6', 'int8', 'fp8', 'fp16', 'bf16', 'fp32', 'unknown'];

/**
 * Sources, images and search counts out of a chunk (streaming delta or a whole message).
 * OpenRouter documents annotations and images on the message; deltas are read the same way in case they carry them.
 */
export function openrouterExtras(chunk: any, seen: Set<string>): ProviderEvent[] {
  const out: ProviderEvent[] = [];
  const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
  for (const src of [choice?.delta, choice?.message]) {
    if (!src) continue;
    for (const a of Array.isArray(src.annotations) ? src.annotations : []) {
      const c = a?.type === 'url_citation' ? a.url_citation : undefined;
      if (typeof c?.url !== 'string' || seen.has(c.url)) continue;
      seen.add(c.url);
      if (!seen.has('search')) {
        seen.add('search');
        out.push({ type: 'server-tool', id: 'openrouter-search', name: 'web_search', state: 'done' });
      }
      out.push({ type: 'source', url: c.url, title: typeof c.title === 'string' ? c.title : undefined, snippet: typeof c.content === 'string' ? c.content.slice(0, 300) : undefined });
    }
    for (const img of Array.isArray(src.images) ? src.images : []) {
      const url = img?.image_url?.url;
      if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
      const key = 'img:' + url.length + url.slice(-64);
      if (seen.has(key)) continue;
      seen.add(key);
      const mime = /^data:(image\/[a-z+.-]+)/.exec(url)?.[1] ?? 'image/png';
      out.push({ type: 'image', data: url, mimeType: mime });
    }
  }
  const searches = chunk?.usage?.server_tool_use_details?.web_search_requests;
  if (typeof searches === 'number' && searches > 0) out.push({ type: 'usage', usage: { webSearches: searches } });
  return out;
}

/** Per-token price string → USD per million tokens */
function perMTok(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
}

export const openrouterPreset: ProviderPreset = {
  id: 'openrouter',
  label: 'OpenRouter',
  // The account's credits need a management key; a normal key sees only its own limit (none when unlimited)
  balanceApi: { path: 'key', scope: 'key', read: (j) => numberOf(j?.data?.limit_remaining) },
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
  // All output kinds, so models that also output images are listed (image-only models are skipped in mapModel)
  modelsPath: 'models?output_modalities=all',
  get corsHint() {
    return tp('cors.direct', { name: 'OpenRouter', host: 'openrouter.ai' });
  },
  // OpenRouter's web search server tool (openrouter:web_search); the model decides when to search
  nativeWebSearch: {
    supports: (_id, m) => !!m?.capabilities.tools,
    get note() {
      return tp('openrouter.searchNote');
    }
  },
  parseExtra: openrouterExtras,

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
      releasedAt: timeOf(raw.created),
      knowledgeCutoff: timeOf(raw.knowledge_cutoff),
      contextLength: raw.context_length ?? raw.top_provider?.context_length,
      maxOutputTokens: raw.top_provider?.max_completion_tokens ?? undefined,
      capabilities: {
        vision: inputs.includes('image'),
        tools: params.includes('tools'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
        // The model's own levels when listed (max, xhigh, minimal, none...); OpenRouter maps the usual three for the rest
        reasoningEffort: !params.includes('reasoning') ? undefined : Array.isArray(raw.reasoning?.supported_efforts) ? raw.reasoning.supported_efforts.map(String) : ['low', 'medium', 'high'],
        webSearch: params.includes('tools'),
        jsonSchema: params.includes('structured_outputs'),
        imageOutput: outputs.includes('image')
      },
      pricing: { inputPerMTok: perMTok(raw.pricing?.prompt), outputPerMTok: perMTok(raw.pricing?.completion), cachedInputPerMTok: perMTok(raw.pricing?.input_cache_read), currency: 'USD' },
      // OpenRouter relays to multiple providers. Retention policies differ per provider
      privacy: 'unknown',
      tags: String(raw.id).endsWith(':free') ? ['free'] : [],
      deprecated: typeof raw.expiration_date === 'string' ? { date: raw.expiration_date } : undefined,
      source: 'fetched'
    };
  },

  settings: [
    {
      key: 'noLowBits',
      get label() {
        return tp('openrouter.noLowBits');
      },
      get desc() {
        return tp('openrouter.noLowBitsDesc');
      },
      default: true
    },
    {
      key: 'cheapest',
      get label() {
        return tp('openrouter.cheapest');
      },
      get desc() {
        return tp('openrouter.cheapestDesc');
      },
      default: false
    }
  ],
  // Provider routing preferences, put into body.provider next to data_collection (transformRequest)
  requestOptions: ({ settings }) => ({
    ...(settings.noLowBits ? { quantizations: ENOUGH_BITS } : {}),
    ...(settings.cheapest ? { sort: 'price' } : {})
  }),

  transformRequest(body, req) {
    const out = { ...body };
    const routing = req.providerOptions?.openrouter;
    if (routing && Object.keys(routing).length) out.provider = { ...out.provider, ...routing };
    if (req.webSearch) out.tools = [...(out.tools ?? []), { type: 'openrouter:web_search', parameters: { max_results: MAX_RESULTS } }];
    if (req.imageOutput) out.modalities = ['image', 'text'];
    // OpenRouter uses the reasoning: { effort } format
    if (out.reasoning_effort) {
      out.reasoning = { ...out.reasoning, effort: out.reasoning_effort };
      delete out.reasoning_effort;
    }
    return out;
  },

  validateKey: (cfg, fetchWithKey) => checkKey(joinUrl(cfg.baseUrl, 'key'), fetchWithKey, openrouterPreset.corsHint)
};
