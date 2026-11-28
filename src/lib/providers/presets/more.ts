// Built-in providers other than Venice / OpenRouter and the open-model hosts, and OpenAI-compatible providers added
// at build time.
import type { ModelInfo, ProviderEvent, ProviderPreset } from '../types';
import { numberOf } from '../openai-compatible';
import { ENDPOINTS, type Endpoint } from '../endpoints';
import { definePreset, flexTier } from './define';
import { t as tp } from './messages';
import { timeOf } from './hosts';

function model(providerId: string, id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { providerId, id, name, capabilities: {}, privacy: 'unknown', source: 'fetched', ...extra };
}

// ---- Anthropic (native Messages API) ----
export const anthropicPreset = definePreset(ENDPOINTS.anthropic, {
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
    // Each capability is { supported }; a list without them (older API) keeps what every current model has
    const cap = raw.capabilities;
    const has = (c: any) => (cap ? c?.supported === true : true);
    const ends = typeof raw.retires_at === 'string' ? raw.retires_at.slice(0, 10) : undefined;
    return model(providerId, String(raw.id), String(raw.display_name ?? raw.id), {
      releasedAt: timeOf(raw.created_at),
      contextLength: typeof raw.max_input_tokens === 'number' ? raw.max_input_tokens : undefined,
      maxOutputTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
      capabilities: { tools: true, vision: has(cap?.image_input), webSearch: has(cap?.server_tools?.web_search), jsonSchema: cap ? has(cap.structured_outputs) : undefined },
      deprecated: raw.lifecycle === 'deprecated' || ends ? { date: ends } : undefined
    });
  }
});

// ---- Google Gemini (native generateContent API; lib/providers/gemini.ts) ----
const GEMINI_SKIP = /embedding|tts|imagen|veo|live|native-audio|aqa|learnlm|robotics|computer-use/;
/** Models that output images (the models list has no field for it; their names end in -image) */
const geminiImageOut = (id: string) => /-image(-|$)|nano-banana/.test(id);
/** Google Search together with function calling: Gemini 3 and later (text models) */
const geminiSearches = (id: string) => /^gemini-([3-9]|\d{2})/.test(id) && !geminiImageOut(id);
export const geminiPreset = definePreset(ENDPOINTS.gemini, {
  // Google Search grounding (added by the adapter when ChatRequest.webSearch is set)
  nativeWebSearch: {
    supports: (id) => geminiSearches(id),
    get note() {
      return tp('gemini.searchNote');
    }
  },
  copy: {
    get destinationNote() {
      return tp('gemini.destinationNote');
    }
  },
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
  }
});

// ---- OpenAI (Chat Completions; images go through the images feature with the same key) ----
const OPENAI_SKIP = /image|audio|realtime|tts|transcribe|embedding|moderation|search|instruct|dall-e|whisper|babbage|davinci|codex|computer-use|deep-research/;
export const openaiPreset = definePreset(ENDPOINTS.openai, {
  // Chat Completions does not take earlier reasoning back
  reasoningResend: 'never',
  copy: {
    get destinationNote() {
      return tp('openai.destinationNote');
    }
  },
  // Flex is billed at Batch API rates, half the standard price
  ...flexTier(0.5),
  modelsPath: 'models',
  mapModel(raw, providerId) {
    const id = String(raw?.id ?? '');
    if (!/^(gpt-|o\d|chatgpt-)/.test(id) || OPENAI_SKIP.test(id)) return null;
    const reasoning = /^o\d|^gpt-5/.test(id);
    return model(providerId, id, id, {
      releasedAt: timeOf(raw.created),
      capabilities: { tools: true, vision: /gpt-4o|gpt-4\.1|gpt-5|^o[34]|chatgpt/.test(id), reasoning, reasoningEffort: reasoning ? ['low', 'medium', 'high'] : undefined },
      deprecated: typeof raw.shutdown_date === 'string' ? { date: raw.shutdown_date } : undefined
    });
  }
});

// ---- DeepSeek ----
export const deepseekPreset = definePreset(ENDPOINTS.deepseek, {
  // Accounts topped up in CNY have no USD entry
  balanceApi: { path: 'user/balance', read: (j) => numberOf((Array.isArray(j?.balance_infos) ? j.balance_infos : []).find((b: any) => b?.currency === 'USD')?.total_balance) },
  // Sending reasoning back on a different message is rejected, so send it back only in the middle of tool calls
  reasoningResend: 'tool-turns',
  copy: {
    get destinationNote() {
      return tp('deepseek.destinationNote');
    }
  },
  modelsPath: 'models',
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    const id = String(raw.id);
    const inputs: string[] = Array.isArray(raw.input_modalities) ? raw.input_modalities : [];
    return model(providerId, id, typeof raw.name === 'string' ? raw.name : id, {
      contextLength: numberOf(raw.context_window),
      maxOutputTokens: numberOf(raw.max_output_tokens),
      // Thinking models list their effort levels; which request field takes a level is not documented, so none is offered
      capabilities: { tools: true, vision: inputs.includes('image'), reasoning: raw.effort ? true : id.includes('reasoner') }
    });
  }
});

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
export const groqPreset = definePreset(ENDPOINTS.groq, {
  reasoningResend: 'never',
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
      releasedAt: timeOf(raw.created),
      contextLength: typeof raw.context_window === 'number' ? raw.context_window : undefined,
      maxOutputTokens: typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : undefined,
      capabilities: { tools: true, reasoning: /gpt-oss|qwen3|deepseek-r1|qwq/.test(id), webSearch: groqSearches(id) }
    });
  }
});

// ---- OpenAI-compatible providers added at build time (VITE_CUSTOM_PROVIDERS) ----
export function customPreset(e: Endpoint): ProviderPreset {
  const host = new URL(e.baseUrl).host;
  return definePreset(e, {
    get tagline() {
      return tp('custom.tagline', { host });
    },
    reasoningResend: 'never',
    get keyGuide() {
      return e.keyOptional ? tp('custom.keyGuideOptional') : tp('custom.keyGuide', { name: e.label });
    },
    get corsHint() {
      return tp('custom.corsHint', { host });
    },
    modelsPath: 'models'
  });
}
