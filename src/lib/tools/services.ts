// External services used by tools (other than LLMs). Keys are kept the same way as for LLM providers (direct mode / key vault).

export interface ToolService {
  id: string;
  label: string;
  baseUrl: string;
  /** Usable without a key (with limits) */
  keyOptional: boolean;
  keyGuide: string;
}

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

export const SERVICES: Record<string, ToolService> = {
  tavily: {
    id: 'tavily',
    label: 'Tavily（Web 検索）',
    baseUrl: env.VITE_TAVILY_BASE_URL || 'https://api.tavily.com',
    keyOptional: false,
    keyGuide: 'Tavily（tavily.com）でキーを作成してください。無料枠は月 1,000 クレジット（検索 1 回 = 1 クレジット）です。検索語は Tavily に送られます。'
  },
  jina: {
    id: 'jina',
    label: 'Jina Reader（ページ本文の取得）',
    baseUrl: env.VITE_JINA_BASE_URL || 'https://r.jina.ai',
    keyOptional: true,
    keyGuide: 'キーなしでも使えます（1 分あたり 20 回まで）。キーを設定すると上限が上がります。取得する URL は Jina に送られます。'
  }
};

export const SERVICE_ORDER = ['tavily', 'jina'] as const;

export function serviceById(id: string): ToolService | undefined {
  return SERVICES[id];
}

export function serviceHost(id: string): string {
  const s = SERVICES[id];
  return s ? new URL(s.baseUrl).host : '';
}
