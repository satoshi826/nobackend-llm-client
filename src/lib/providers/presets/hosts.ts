// OpenAI-compatible hosts of open models: NanoGPT, DeepInfra, Cerebras, Novita, Chutes, Together.
// All take a Bearer key, stream SSE with usage at the end, and allow requests from a browser (checked 2026-11-26).
// Their model lists carry prices, context and capabilities; each has its own shape, read here (docs/specs/provider-research.md).
// Reasoning comes as `reasoning` / `reasoning_content` or inline <think> (all handled by the adapter); it is never sent back.
import type { ModelInfo, ProviderPreset } from '../types';
import { checkKey, flexTier, joinUrl, numberOf as num } from '../openai-compatible';
import { builtinBaseUrl } from '../endpoints';
import { t as tp } from '../messages';

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

const str = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);

function model(providerId: string, id: string, name: string | undefined, extra: Partial<ModelInfo>): ModelInfo {
  return { providerId, id, name: name ?? id, capabilities: {}, privacy: 'unknown', source: 'fetched', ...extra };
}

function pricing(input: number | undefined, output: number | undefined, cached?: number): ModelInfo['pricing'] {
  if (input === undefined && output === undefined) return undefined;
  return { inputPerMTok: input, outputPerMTok: output, ...(cached !== undefined ? { cachedInputPerMTok: cached } : {}), currency: 'USD' };
}

/** The shared parts of these presets: OpenAI-compatible, direct from the browser, reasoning never sent back */
function host(o: {
  id: string;
  label: string;
  /** Model list without a key (fetched by the app directly) */
  publicModels: boolean;
  modelsPath?: string;
  mapModel: ProviderPreset['mapModel'];
  /** A request that fails without a valid key (none for hosts whose only cheap GET needs no key) */
  keyCheckPath?: string;
  hasPrivateModels?: boolean;
  balanceApi?: ProviderPreset['balanceApi'];
  /** Its cheaper flex tier, as the part of the list price it costs */
  flexPriceFactor?: number;
}): ProviderPreset {
  const corsHost = new URL(builtinBaseUrl(o.id, env) || 'https://invalid').host;
  const preset: ProviderPreset = {
    id: o.id,
    label: o.label,
    get tagline() {
      return tp(`${o.id}.tagline` as Parameters<typeof tp>[0]);
    },
    modelsNeedKey: !o.publicModels,
    reasoningResend: 'never',
    get keyGuide() {
      return tp(`${o.id}.keyGuide` as Parameters<typeof tp>[0]);
    },
    get corsHint() {
      return tp('cors.generic', { host: corsHost });
    },
    ...(o.hasPrivateModels
      ? {
          copy: {
            get private() {
              return tp(`${o.id}.private` as Parameters<typeof tp>[0]);
            }
          }
        }
      : {}),
    defaults: { name: o.label, kind: 'openai-compatible', preset: o.id, baseUrl: builtinBaseUrl(o.id, env), modelListMode: 'fetch', enabled: false },
    browserAccess: 'direct',
    modelsPath: o.modelsPath ?? 'models',
    mapModel: o.mapModel,
    ...(o.balanceApi ? { balanceApi: o.balanceApi } : {}),
    ...(o.flexPriceFactor !== undefined ? flexTier(o.flexPriceFactor) : {}),
    ...(o.keyCheckPath ? { validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, o.keyCheckPath!), f, preset.corsHint) } : {})
  };
  return preset;
}

// ---- NanoGPT: many models behind one key; per-key spend limits; zero-data-retention routes on some models ----
export const nanogptPreset = host({
  id: 'nanogpt',
  label: 'NanoGPT',
  publicModels: true,
  modelsPath: 'models?detailed=true',
  hasPrivateModels: true,
  balanceApi: { path: '../check-balance', method: 'POST', read: (j) => num(j?.usd_balance) },
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    const out: string[] = raw?.architecture?.output_modalities ?? ['text'];
    if (!id || raw.available === false || !out.includes('text')) return null;
    const c = raw.capabilities ?? {};
    return model(providerId, id, str(raw.name), {
      contextLength: num(raw.context_length),
      maxOutputTokens: num(raw.max_output_tokens),
      capabilities: { tools: !!c.tool_calling, vision: !!c.vision, reasoning: !!c.reasoning },
      pricing: pricing(num(raw.pricing?.prompt), num(raw.pricing?.completion)),
      privacy: raw.privacy?.zero_data_retention === true ? 'private' : 'unknown'
    });
  }
});

// ---- DeepInfra: open models; per-key monthly spend limits; prompts kept in memory only ----
export const deepinfraPreset = host({
  id: 'deepinfra',
  label: 'DeepInfra',
  publicModels: true,
  // Flex is billed at 0.8 of the standard price, on the models that offer it
  flexPriceFactor: 0.8,
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    const m = raw?.metadata ?? {};
    const tags: string[] = Array.isArray(m.tags) ? m.tags : [];
    if (!id || !tags.includes('chat')) return null;
    return model(providerId, id, undefined, {
      contextLength: num(m.context_length),
      maxOutputTokens: num(m.max_tokens),
      capabilities: { tools: true, vision: tags.includes('vision') || tags.includes('vlm'), reasoning: tags.includes('reasoning') },
      pricing: pricing(num(m.pricing?.input_tokens), num(m.pricing?.output_tokens), num(m.pricing?.cache_read_tokens))
    });
  }
});

// ---- Cerebras: very fast inference; its public model list sits outside /v1 ----
export const cerebrasPreset = host({
  id: 'cerebras',
  label: 'Cerebras',
  publicModels: true,
  modelsPath: '../public/v1/models',
  keyCheckPath: 'models',
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id) return null;
    const c = raw.capabilities ?? {};
    // Prices are per token, as strings
    const perM = (x: unknown) => {
      const n = num(x);
      return n === undefined ? undefined : n * 1_000_000;
    };
    return model(providerId, id, str(raw.name), {
      contextLength: num(raw.limits?.max_context_length),
      maxOutputTokens: num(raw.limits?.max_completion_tokens),
      capabilities: { tools: !!(c.tools ?? c.function_calling), vision: !!c.vision, reasoning: !!c.reasoning },
      pricing: pricing(perM(raw.pricing?.prompt), perM(raw.pricing?.completion)),
      tags: raw.deprecated ? ['deprecated'] : []
    });
  }
});

// ---- Novita: open models; per-key budgets; no data kept by default ----
export const novitaPreset = host({
  id: 'novita',
  label: 'Novita',
  publicModels: true,
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id || raw.model_type !== 'chat' || (raw.status !== undefined && raw.status !== 1)) return null;
    const features: string[] = Array.isArray(raw.features) ? raw.features : [];
    const p = raw.pricing ?? {};
    return model(providerId, id, str(raw.display_name) ?? str(raw.title), {
      contextLength: num(raw.context_size),
      maxOutputTokens: num(raw.max_output_tokens),
      capabilities: { tools: features.includes('function-calling'), vision: (raw.input_modalities ?? []).includes('image'), reasoning: features.includes('reasoning') },
      pricing: pricing(num(p.prompt?.price_per_m_decimal), num(p.completion?.price_per_m_decimal), num(p.input_cache_read?.price_per_m_decimal))
    });
  }
});

// ---- Chutes: decentralized inference; some models run in confidential computing (TEE) ----
export const chutesPreset = host({
  id: 'chutes',
  label: 'Chutes',
  publicModels: true,
  hasPrivateModels: true,
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id || !(raw.output_modalities ?? ['text']).includes('text')) return null;
    const features: string[] = Array.isArray(raw.supported_features) ? raw.supported_features : [];
    return model(providerId, id, undefined, {
      contextLength: num(raw.context_length) ?? num(raw.max_model_len),
      maxOutputTokens: num(raw.max_output_length),
      capabilities: { tools: features.includes('tools'), vision: (raw.input_modalities ?? []).includes('image'), reasoning: features.includes('reasoning') },
      pricing: pricing(num(raw.pricing?.prompt), num(raw.pricing?.completion), num(raw.pricing?.input_cache_read)),
      privacy: raw.confidential_compute === true ? 'private' : 'unknown'
    });
  }
});

// ---- Together: open models; zero data retention by default; the model list needs a key ----
// Its list is a plain array (not { data }); `type` tells chat models apart and prices are per 1M tokens
export const togetherPreset = host({
  id: 'together',
  label: 'Together',
  publicModels: false,
  keyCheckPath: 'models',
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id || (raw.type !== undefined && raw.type !== 'chat')) return null;
    return model(providerId, id, str(raw.display_name), {
      contextLength: num(raw.context_length),
      capabilities: { tools: true },
      pricing: pricing(num(raw.pricing?.input), num(raw.pricing?.output), num(raw.pricing?.cached_input))
    });
  }
});

export const hostPresets = [nanogptPreset, deepinfraPreset, cerebrasPreset, novitaPreset, chutesPreset, togetherPreset];
