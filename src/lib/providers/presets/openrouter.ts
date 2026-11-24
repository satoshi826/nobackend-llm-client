import type { ModelInfo, ProviderPreset } from '../types';
import { joinUrl } from '../openai-compatible';
import { errorFromFetchFailure, errorFromResponse, ProviderFailure } from '../errors';

const BASE_URL: string = (import.meta as any).env?.VITE_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

export const OPENROUTER_KEY_GUIDE =
  'OpenRouter の管理画面（Keys）でキーを作り、クレジットの上限（credit limit）を設定してください。キーが万一漏れても被害額が上限で止まります。';

/** 1 トークンあたりの文字列価格 → 100 万トークンあたりの USD */
function perMTok(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
}

export const openrouterPreset: ProviderPreset = {
  id: 'openrouter',
  label: 'OpenRouter',
  defaults: {
    name: 'OpenRouter',
    kind: 'openai-compatible',
    preset: 'openrouter',
    baseUrl: BASE_URL,
    // 既定で「データを保存・学習に使う提供元」を経由させない
    extraBody: { provider: { data_collection: 'deny' }, usage: { include: true } },
    modelListMode: 'fetch',
    enabled: false
  },
  browserAccess: 'direct',
  modelsPath: 'models',
  corsHint: 'OpenRouter は通常ブラウザから直接接続できます。ネットワーク接続、または拡張機能が openrouter.ai をブロックしていないか確認してください。',

  mapModel(raw: any, providerId: string): ModelInfo | null {
    if (!raw?.id) return null;
    const params: string[] = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
    const inputs: string[] = Array.isArray(raw.architecture?.input_modalities) ? raw.architecture.input_modalities : [];
    const outputs: string[] = Array.isArray(raw.architecture?.output_modalities) ? raw.architecture.output_modalities : ['text'];
    if (!outputs.includes('text')) return null; // 画像生成専用などは除外
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
        webSearch: false, // Web 検索（plugins）は未対応
        jsonSchema: params.includes('structured_outputs')
      },
      pricing: { inputPerMTok: perMTok(raw.pricing?.prompt), outputPerMTok: perMTok(raw.pricing?.completion), currency: 'USD' },
      // OpenRouter は複数の提供元へ中継する。保持方針は提供元ごとに異なる
      privacy: 'unknown',
      tags: String(raw.id).endsWith(':free') ? ['free'] : [],
      source: 'fetched'
    };
  },

  transformRequest(body) {
    const out = { ...body };
    // OpenRouter は reasoning: { effort } 形式
    if (out.reasoning_effort) {
      out.reasoning = { ...(out.reasoning ?? {}), effort: out.reasoning_effort };
      delete out.reasoning_effort;
    }
    delete out.venice_parameters;
    return out;
  },

  async validateKey(cfg, cred, transport) {
    const url = joinUrl(cfg.baseUrl, 'key');
    let res: Response;
    try {
      res = await transport.fetch(url, { method: 'GET', headers: { Accept: 'application/json' } }, cred);
    } catch (e) {
      if (e instanceof ProviderFailure) return { ok: false, error: e.error };
      return { ok: false, error: errorFromFetchFailure(e, openrouterPreset.corsHint) };
    }
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) };
    let info: any = null;
    try {
      info = await res.json();
    } catch {
      /* ignore */
    }
    return { ok: true, info };
  }
};
