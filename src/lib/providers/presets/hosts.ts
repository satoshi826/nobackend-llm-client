// OpenAI-compatible hosts of open models: NanoGPT, DeepInfra, Cerebras, Novita, Chutes, Together.
// All take a Bearer key, stream SSE with usage at the end, and allow requests from a browser (checked 2026-11-26).
// Their model lists carry prices, context and capabilities; each has its own shape, read here.
// Reasoning comes as `reasoning` / `reasoning_content` or inline <think> (all handled by the adapter); it is never sent back.
import type { ModelInfo, ProviderPreset } from '../types';
import { numberOf as num } from '../openai-compatible';
import { ENDPOINTS } from '../endpoints';
import { definePreset, flexTier } from './define';
import { t as tp } from './messages';

const str = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);

/** A date from a model list (unix seconds, or an ISO 8601 string) in ms; undefined when missing, 0 or unreadable */
export function timeOf(x: unknown): number | undefined {
  const ms = typeof x === 'number' ? x * 1000 : typeof x === 'string' ? Date.parse(x) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function model(providerId: string, id: string, name: string | undefined, extra: Partial<ModelInfo>): ModelInfo {
  return { providerId, id, name: name ?? id, capabilities: {}, privacy: 'unknown', source: 'fetched', ...extra };
}

function pricing(input: number | undefined, output: number | undefined, cached?: number): ModelInfo['pricing'] {
  if (input === undefined && output === undefined) return undefined;
  return { inputPerMTok: input, outputPerMTok: output, ...(cached !== undefined ? { cachedInputPerMTok: cached } : {}), currency: 'USD' };
}

/** The shared parts of these presets: OpenAI-compatible, reasoning never sent back */
function host(
  id: string,
  o: Pick<ProviderPreset, 'mapModel' | 'modelsPath' | 'balanceApi'> & {
    hasPrivateModels?: boolean;
    /** Its cheaper flex tier, as the part of the list price it costs */
    flexPriceFactor?: number;
  }
): ProviderPreset {
  return definePreset(ENDPOINTS[id], {
    reasoningResend: 'never',
    modelsPath: o.modelsPath ?? 'models',
    mapModel: o.mapModel,
    ...(o.hasPrivateModels
      ? {
          copy: {
            get private() {
              return tp(`${id}.private` as Parameters<typeof tp>[0]);
            }
          }
        }
      : {}),
    ...(o.balanceApi ? { balanceApi: o.balanceApi } : {}),
    ...(o.flexPriceFactor !== undefined ? flexTier(o.flexPriceFactor) : {})
  });
}

// ---- NanoGPT: many models behind one key; per-key spend limits; zero-data-retention routes on some models ----
export const nanogptPreset = host('nanogpt', {
  modelsPath: 'models?detailed=true',
  hasPrivateModels: true,
  balanceApi: { path: '../check-balance', method: 'POST', read: (j) => num(j?.usd_balance) },
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    const out: string[] = raw?.architecture?.output_modalities ?? ['text'];
    if (!id || raw.available === false || !out.includes('text')) return null;
    const c = raw.capabilities ?? {};
    // zero_data_retention is "unknown" on every model; whether data is kept is told per route it relays to
    const routes: any[] = Array.isArray(raw.privacy?.providers) ? raw.privacy.providers : [];
    const zdr = raw.privacy?.zero_data_retention === true || (routes.length > 0 && routes.every((r) => r?.zdr_policy_eligible === true));
    const cachePer1k = num(raw.pricing?.cacheReadInputPer1kTokens);
    return model(providerId, id, str(raw.name), {
      description: str(raw.description),
      releasedAt: timeOf(raw.created),
      contextLength: num(raw.context_length),
      maxOutputTokens: num(raw.max_output_tokens),
      capabilities: {
        tools: !!c.tool_calling,
        vision: !!c.vision,
        reasoning: !!c.reasoning,
        reasoningEffort: Array.isArray(raw.reasoning_efforts) && raw.reasoning_efforts.length ? raw.reasoning_efforts.map(String) : undefined
      },
      pricing: pricing(num(raw.pricing?.prompt), num(raw.pricing?.completion), cachePer1k === undefined ? undefined : cachePer1k * 1000),
      privacy: zdr ? 'private' : 'unknown'
    });
  }
});

// ---- DeepInfra: open models; per-key monthly spend limits; prompts kept in memory only ----
export const deepinfraPreset = host('deepinfra', {
  // Flex is billed at 0.8 of the standard price, on the models that offer it
  flexPriceFactor: 0.8,
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    const m = raw?.metadata ?? {};
    const tags: string[] = Array.isArray(m.tags) ? m.tags : [];
    if (!id || !tags.includes('chat')) return null;
    // Its `created` is always 0
    return model(providerId, id, undefined, {
      description: str(m.description),
      contextLength: num(m.context_length),
      maxOutputTokens: num(m.max_tokens),
      capabilities: { tools: true, vision: tags.includes('vision') || tags.includes('vlm'), reasoning: tags.includes('reasoning') },
      pricing: pricing(num(m.pricing?.input_tokens), num(m.pricing?.output_tokens), num(m.pricing?.cache_read_tokens))
    });
  }
});

// ---- Cerebras: very fast inference; its public model list sits outside /v1 ----
export const cerebrasPreset = host('cerebras', {
  modelsPath: '../public/v1/models',
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
      description: str(raw.description),
      releasedAt: timeOf(raw.created),
      contextLength: num(raw.limits?.max_context_length),
      maxOutputTokens: num(raw.limits?.max_completion_tokens),
      capabilities: { tools: !!(c.tools ?? c.function_calling), vision: !!c.vision, reasoning: !!c.reasoning },
      pricing: pricing(perM(raw.pricing?.prompt), perM(raw.pricing?.completion)),
      deprecated: raw.deprecated ? {} : undefined
    });
  }
});

// ---- Novita: open models; per-key budgets; no data kept by default ----
export const novitaPreset = host('novita', {
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id || raw.model_type !== 'chat' || (raw.status !== undefined && raw.status !== 1)) return null;
    const features: string[] = Array.isArray(raw.features) ? raw.features : [];
    const p = raw.pricing ?? {};
    return model(providerId, id, str(raw.display_name) ?? str(raw.title), {
      description: str(raw.description),
      releasedAt: timeOf(raw.created),
      contextLength: num(raw.context_size),
      maxOutputTokens: num(raw.max_output_tokens),
      capabilities: { tools: features.includes('function-calling'), vision: (raw.input_modalities ?? []).includes('image'), reasoning: features.includes('reasoning') },
      pricing: pricing(num(p.prompt?.price_per_m_decimal), num(p.completion?.price_per_m_decimal), num(p.input_cache_read?.price_per_m_decimal))
    });
  }
});

// ---- Chutes: decentralized inference; some models run in confidential computing (TEE) ----
export const chutesPreset = host('chutes', {
  hasPrivateModels: true,
  mapModel(raw, providerId) {
    const id = str(raw?.id);
    if (!id || !(raw.output_modalities ?? ['text']).includes('text')) return null;
    const features: string[] = Array.isArray(raw.supported_features) ? raw.supported_features : [];
    // `pricing` may be a time-limited price: then `regular_price` applies from `regular_price_from`
    let p = pricing(num(raw.pricing?.prompt), num(raw.pricing?.completion), num(raw.pricing?.input_cache_read));
    const regular = raw.regular_price;
    const regularFrom = timeOf(raw.regular_price_from);
    if (regular && regularFrom !== undefined) {
      if (Date.now() >= regularFrom) p = pricing(num(regular.input?.usd), num(regular.output?.usd), num(regular.input_cache_read?.usd));
      else if (p) p.saleEndsAt = regularFrom;
    }
    return model(providerId, id, undefined, {
      releasedAt: timeOf(raw.created),
      contextLength: num(raw.context_length) ?? num(raw.max_model_len),
      maxOutputTokens: num(raw.max_output_length),
      capabilities: { tools: features.includes('tools'), vision: (raw.input_modalities ?? []).includes('image'), reasoning: features.includes('reasoning') },
      pricing: p,
      privacy: raw.confidential_compute === true ? 'private' : 'unknown'
    });
  }
});

// ---- Together: open models; zero data retention by default; the model list needs a key ----
// Its list is a plain array (not { data }); `type` tells chat models apart and prices are per 1M tokens
export const togetherPreset = host('together', {
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
