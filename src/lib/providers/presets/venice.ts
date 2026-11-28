import type { ModelInfo, ProviderEvent } from '../types';
import { numberOf } from '../openai-compatible';
import { ENDPOINTS } from '../endpoints';
import { definePreset } from './define';
import { timeOf } from './hosts';
import { t as tp } from './messages';

// Texts are getters so they follow the current language
export const venicePreset = definePreset(ENDPOINTS.venice, {
  // Also sent in response headers; this reads it before the first message
  balanceApi: { path: 'api_keys/rate_limits', read: (j) => numberOf(j?.data?.balances?.USD) },
  // Venice's own web search (venice_parameters.enable_web_search, set in requestOptions)
  nativeWebSearch: {
    supports: (_id, m) => m?.capabilities.webSearch !== false,
    get note() {
      return tp('venice.searchNote');
    }
  },
  settings: [
    {
      key: 'includeSystemPrompt',
      get label() {
        return tp('venice.systemPrompt');
      },
      get desc() {
        return tp('venice.systemPromptDesc');
      },
      default: false
    }
  ],
  requestOptions: ({ purpose, webSearch, settings }) =>
    purpose === 'summary'
      ? { include_venice_system_prompt: false, strip_thinking_response: true }
      : { include_venice_system_prompt: !!settings.includeSystemPrompt, ...(webSearch !== 'off' ? { enable_web_search: webSearch } : {}) },
  copy: {
    get private() {
      return tp('venice.private');
    },
    get relayed() {
      return tp('venice.relayed');
    },
    get relayedNote() {
      return tp('venice.relayedNote');
    },
    get extraDestinations(): [string, string][] {
      return [
        [tp('venice.searchProviders'), tp('venice.searchProvidersWhat')],
        [tp('venice.thirdParties'), tp('venice.thirdPartiesWhat')],
        ['private-share.venice.ai', tp('venice.videoShareWhat')]
      ];
    }
  },
  modelsPath: 'models?type=text',
  get corsHint() {
    return tp('cors.venice');
  },

  mapModel(raw: any, providerId: string): ModelInfo | null {
    if (!raw?.id) return null;
    const spec = raw.model_spec ?? {};
    const cap = spec.capabilities ?? {};
    return {
      providerId,
      id: String(raw.id),
      name: String(spec.name ?? raw.id),
      description: typeof spec.description === 'string' ? spec.description : undefined,
      releasedAt: timeOf(raw.created),
      contextLength: spec.availableContextTokens ?? raw.context_length,
      maxOutputTokens: spec.maxCompletionTokens,
      capabilities: {
        vision: !!cap.supportsVision,
        tools: !!cap.supportsFunctionCalling,
        reasoning: !!cap.supportsReasoning,
        reasoningEffort: cap.supportsReasoningEffort && Array.isArray(cap.reasoningEffortOptions) ? cap.reasoningEffortOptions : undefined,
        webSearch: !!cap.supportsWebSearch,
        jsonSchema: !!cap.supportsResponseSchema
      },
      pricing: spec.pricing
        ? { inputPerMTok: spec.pricing.input?.usd, outputPerMTok: spec.pricing.output?.usd, cachedInputPerMTok: spec.pricing.cache_input?.usd, currency: 'USD' }
        : undefined,
      privacy: spec.privacy === 'private' ? 'private' : spec.privacy === 'anonymized' ? 'anonymized' : 'unknown',
      tags: Array.isArray(spec.traits) ? spec.traits.map(String) : [],
      offline: !!spec.offline,
      deprecated: spec.deprecation ? { date: spec.deprecation.date, replacementId: spec.deprecation.replacementModelId } : undefined,
      source: 'fetched'
    };
  },

  transformRequest(body, req) {
    // Venice's default system prompt is not added unless the setting asks for it (requestOptions)
    const vp: Record<string, unknown> = { include_venice_system_prompt: false, ...req.providerOptions?.venice };
    if (vp.enable_web_search && vp.enable_web_search !== 'off') {
      vp.enable_web_citations = vp.enable_web_citations ?? true;
      vp.include_search_results_in_stream = vp.include_search_results_in_stream ?? true;
    }
    const out: Record<string, any> = { ...body, venice_parameters: vp };
    // Route requests of the same conversation to the same cache so the resent history is cheaper and faster
    if (req.cacheKey) out.prompt_cache_key = req.cacheKey;
    return out;
  },

  parseExtra(chunk: any, seen: Set<string>): ProviderEvent[] {
    // Where citations appear varies across the docs, so search broadly
    const lists = [chunk?.venice_parameters?.web_search_citations, chunk?.web_search_citations, chunk?.choices?.[0]?.delta?.venice_parameters?.web_search_citations];
    const out: ProviderEvent[] = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        const url = typeof c?.url === 'string' ? c.url : undefined;
        if (!url || seen.has(url) || !/^https?:\/\//i.test(url)) continue;
        seen.add(url);
        out.push({ type: 'source', url, title: typeof c.title === 'string' ? c.title : undefined, snippet: typeof c.content === 'string' ? c.content.slice(0, 300) : undefined });
      }
    }
    return out;
  },

  readHeaders(headers: Headers): ProviderEvent[] {
    const usd = parseFloat(headers.get('x-venice-balance-usd') ?? '');
    const diem = parseFloat(headers.get('x-venice-balance-diem') ?? '');
    if (!Number.isFinite(usd) && !Number.isFinite(diem)) return [];
    return [{ type: 'account', balanceUsd: Number.isFinite(usd) ? usd : undefined, balanceDiem: Number.isFinite(diem) ? diem : undefined }];
  }
});
