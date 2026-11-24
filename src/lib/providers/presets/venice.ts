import type { ModelInfo, ProviderEvent, ProviderPreset } from '../types';
import { checkKey, joinUrl } from '../openai-compatible';

// 開発時はモック（scripts/mock-venice.mjs）に向けられるようにする
const BASE_URL: string = (import.meta as any).env?.VITE_VENICE_BASE_URL || 'https://api.venice.ai/api/v1';

const KEY_GUIDE =
  'Venice の管理画面（Settings → API）で「INFERENCE」タイプのキーを作り、1 日の利用上限（consumption limit）と有効期限を設定してください。モデルを Venice ホストのものに限る「PRIVATE_ONLY」もおすすめです。キーが万一漏れても被害額が上限で止まります。';

export const venicePreset: ProviderPreset = {
  id: 'venice',
  label: 'Venice.ai',
  defaults: {
    name: 'Venice',
    kind: 'openai-compatible',
    preset: 'venice',
    baseUrl: BASE_URL,
    // Venice 既定のシステムプロンプトは付けない（UI で切り替え可能）
    extraBody: { venice_parameters: { include_venice_system_prompt: false } },
    modelListMode: 'fetch',
    enabled: true
  },
  browserAccess: 'direct',
  keyGuide: KEY_GUIDE,
  modelsPath: 'models?type=text',
  corsHint: 'Venice は通常ブラウザから直接接続できます。ネットワーク接続、または広告ブロッカー等の拡張機能が api.venice.ai をブロックしていないか確認してください。',

  mapModel(raw: any, providerId: string): ModelInfo | null {
    if (!raw?.id) return null;
    const spec = raw.model_spec ?? {};
    const cap = spec.capabilities ?? {};
    return {
      providerId,
      id: String(raw.id),
      name: String(spec.name ?? raw.id),
      description: typeof spec.description === 'string' ? spec.description : undefined,
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
        ? { inputPerMTok: spec.pricing.input?.usd, outputPerMTok: spec.pricing.output?.usd, currency: 'USD' }
        : undefined,
      privacy: spec.privacy === 'private' ? 'private' : spec.privacy === 'anonymized' ? 'anonymized' : 'unknown',
      tags: Array.isArray(spec.traits) ? spec.traits.map(String) : [],
      offline: !!spec.offline,
      deprecated: spec.deprecation ? { date: spec.deprecation.date, replacementId: spec.deprecation.replacementModelId } : undefined,
      source: 'fetched'
    };
  },

  transformRequest(body, req) {
    const opts = (req.providerOptions?.venice ?? {}) as Record<string, unknown>;
    const vp = { ...(body.venice_parameters ?? {}), ...opts };
    if (vp.enable_web_search && vp.enable_web_search !== 'off') {
      vp.enable_web_citations = vp.enable_web_citations ?? true;
      vp.include_search_results_in_stream = vp.include_search_results_in_stream ?? true;
    }
    const out: Record<string, any> = { ...body, venice_parameters: vp };
    // 同じ会話の要求を同じキャッシュに当てて、送り直す履歴部分を安く・速くする
    if (req.cacheKey) out.prompt_cache_key = req.cacheKey;
    return out;
  },

  parseExtra(chunk: any, seen: Set<string>): ProviderEvent[] {
    // 引用の位置はドキュメントで揺れているので、見つかる場所を広く探す
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
  },

  validateKey: (cfg, fetchWithKey) => checkKey(joinUrl(cfg.baseUrl, 'api_keys/rate_limits'), fetchWithKey, venicePreset.corsHint)
};
