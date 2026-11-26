// Web search (Tavily) and page text fetching (Jina Reader). Both can be called directly from the browser (CORS support verified).
// Fetched external content is passed to the model explicitly marked as "untrusted data" (prompt injection defence).
import { errorFromFetchFailure, errorFromResponse, ProviderFailure } from '../../lib/providers/errors';
import { joinUrl } from '../../lib/providers/openai-compatible';
import { SERVICES } from '../../lib/tools/services';
import type { Tool, ToolContext, ToolResult, ToolSource } from '../../lib/tools/types';
import { t } from './messages';

/** Max characters of page text passed to the model */
export const FETCH_MAX_CHARS = 12000;

async function call(ctx: ToolContext, serviceId: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await ctx.transport.fetch(url, { ...init, signal: ctx.signal }, ctx.authFor(serviceId));
  } catch (e) {
    if (e instanceof ProviderFailure) throw e;
    throw new ProviderFailure(errorFromFetchFailure(e));
  }
  if (!res.ok) throw new ProviderFailure(await errorFromResponse(res));
  return res;
}

function oneLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

export interface SearchInput {
  query: string;
  max_results: number;
}

export const webSearchTool: Tool<SearchInput> = {
  name: 'web_search',
  // Getters: the texts follow the UI language at the time of use
  get label() {
    return t('webSearch');
  },
  get description() {
    return t('search.desc');
  },
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: t('search.queryDesc') },
        max_results: { type: 'integer', minimum: 1, maximum: 10, description: t('search.maxDesc') }
      },
      required: ['query']
    };
  },
  risk: 'network',
  summarize: (i) => i.query,
  prepare(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const query = typeof r.query === 'string' ? r.query.trim() : '';
    if (!query) throw new Error(t('search.emptyQuery'));
    const n = Number(r.max_results ?? 5);
    return { query: query.slice(0, 400), max_results: Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : 5 };
  },
  async execute(input, ctx): Promise<ToolResult> {
    const res = await call(ctx, 'tavily', joinUrl(SERVICES.tavily.baseUrl, 'search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: input.query, max_results: input.max_results, search_depth: 'basic', include_answer: false })
    });
    const json = await res.json();
    const results: { title: string; url: string; content: string }[] = (Array.isArray(json?.results) ? json.results : [])
      .filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//i.test(r.url))
      .map((r: any) => ({ title: String(r.title ?? r.url), url: String(r.url), content: String(r.content ?? '') }));
    if (results.length === 0) return { content: t('search.noResults', { query: input.query }), details: { query: input.query, results: [] } };
    const lines = results.map((r, i) => `[${i + 1}] ${oneLine(r.title, 200)}\nURL: ${r.url}\n${oneLine(r.content, 600)}`);
    const sources: ToolSource[] = results.map((r) => ({ url: r.url, title: r.title, snippet: oneLine(r.content, 200) }));
    return {
      content: `${t('untrusted')}\n\n${t('search.header', { query: input.query })}\n\n${lines.join('\n\n')}`,
      details: { query: input.query, results: results.map((r) => ({ title: r.title, url: r.url })) },
      sources
    };
  }
};

export interface FetchInput {
  url: string;
}

export const fetchUrlTool: Tool<FetchInput> = {
  name: 'fetch_url',
  get label() {
    return t('fetchPage');
  },
  get description() {
    return t('fetch.desc');
  },
  get parameters() {
    return {
      type: 'object',
      properties: { url: { type: 'string', description: t('fetch.urlDesc') } },
      required: ['url']
    };
  },
  risk: 'network',
  // The address leaves the browser and may carry anything from the conversation, so it is shown every time
  alwaysAsk: true,
  summarize: (i) => i.url,
  prepare(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error(t('fetch.badUrl'));
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(t('fetch.badProtocol'));
    if (u.username || u.password) throw new Error(t('fetch.credentials'));
    return { url: u.toString() };
  },
  async execute(input, ctx): Promise<ToolResult> {
    // Jina Reader: https://r.jina.ai/<target URL>
    const res = await call(ctx, 'jina', `${SERVICES.jina.baseUrl.replace(/\/+$/, '')}/${input.url}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const json = await res.json().catch(() => null);
    const data = json?.data ?? {};
    const title = typeof data.title === 'string' ? data.title : '';
    let text = typeof data.content === 'string' ? data.content : '';
    const total = text.length;
    let truncated = false;
    if (text.length > FETCH_MAX_CHARS) {
      text = text.slice(0, FETCH_MAX_CHARS);
      truncated = true;
    }
    if (!text.trim()) return { content: t('fetch.empty', { url: input.url }), details: { url: input.url, title, chars: 0 }, isError: true };
    return {
      content: `${t('untrusted')}\n\nURL: ${input.url}\n${t('fetch.title', { title })}\n${truncated ? `${t('fetch.truncated', { max: FETCH_MAX_CHARS, total })}\n` : ''}\n${text}`,
      details: { url: input.url, title, chars: total, truncated },
      sources: [{ url: input.url, title: title || input.url }]
    };
  }
};

export const WEB_TOOLS: Tool[] = [webSearchTool, fetchUrlTool];

export function toolByName(name: string, tools: Tool[] = WEB_TOOLS): Tool | undefined {
  return tools.find((x) => x.name === name);
}
