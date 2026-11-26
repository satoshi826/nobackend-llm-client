// Adapter for the Anthropic Messages API (not OpenAI-compatible, so a separate implementation).
// - the vault attaches the key in the x-api-key header (preset.keyHeader)
// - calling directly from the browser needs the anthropic-dangerous-direct-browser-access header (preset extraHeaders)
// - extended thinking is not used (combined with tool calls it would require sending signed thinking blocks back)
// - web search is Anthropic's server tool. The basic version is used:
//   the dynamic-filtering versions add code execution blocks and a container to echo back.
//   A step that used server tools is kept verbatim (provider-content) and sent back as is while the turn runs
//   (required after pause_turn); later turns send only the answer text.
import type { ChatMessage, ChatRequest, ModelInfo, ProviderAdapter, ProviderEvent, Part } from './types';
import { parseSSE } from './sse';
import { classifyError, errorFromFetchFailure, errorFromResponse, isAbort, ProviderFailure } from './errors';
import { joinUrl } from './openai-compatible';
import { t as tp } from './messages';

type ToolPart = Extract<Part, { type: 'tool' }>;
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;
/** Searches per request at most (each one is billed) */
const MAX_SEARCHES = 5;
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES };

function toolResultText(t: ToolPart): string {
  if (t.state === 'output-denied') return tp('tool.denied', { reason: t.approval?.reason ?? '' }).trim();
  if (t.state === 'output-error') return tp('tool.failed', { error: t.error ?? '' });
  return typeof t.modelOutput === 'string' ? t.modelOutput : JSON.stringify(t.modelOutput ?? null);
}

/** Normalized messages → Anthropic system and messages */
export function toAnthropic(messages: ChatMessage[]): { system: string; messages: any[] } {
  const system: string[] = [];
  const out: any[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    // Merge consecutive messages with the same role
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    if (m.role === 'system') {
      if (text.trim()) system.push(text);
      continue;
    }
    if (m.role === 'user') {
      push('user', text.trim() ? [{ type: 'text', text }] : []);
      continue;
    }
    const tools = m.parts.filter((p): p is ToolPart => p.type === 'tool');
    // A step that used server tools goes back exactly as received
    const raw = (m.vendorState?.providerContent as { provider?: string; content?: unknown[] } | undefined)?.content;
    if (Array.isArray(raw) && raw.length) push('assistant', structuredClone(raw));
    else {
      const blocks: any[] = text.trim() ? [{ type: 'text', text }] : [];
      for (const t of tools) blocks.push({ type: 'tool_use', id: t.toolCallId, name: t.name, input: t.input && typeof t.input === 'object' ? t.input : {} });
      push('assistant', blocks);
    }
    const results = tools
      .filter((t) => t.state === 'output-available' || t.state === 'output-error' || t.state === 'output-denied')
      .map((t) => ({ type: 'tool_result', tool_use_id: t.toolCallId, content: toolResultText(t), ...(t.state !== 'output-available' ? { is_error: true } : {}) }));
    push('user', results);
  }
  return { system: system.join('\n\n'), messages: out };
}

/** Block types a cache breakpoint may be put on */
const CACHEABLE = new Set(['text', 'tool_use', 'tool_result']);

export function buildAnthropicBody(req: ChatRequest): Record<string, any> {
  const { system, messages } = toAnthropic(req.messages);
  const p = req.params ?? {};
  // Prompt cache: put breakpoints after the system prompt and at the end of the last message
  const last = messages[messages.length - 1];
  const lastBlock = last?.content?.[last.content.length - 1];
  if (lastBlock && CACHEABLE.has(lastBlock.type)) last.content[last.content.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } };
  const body: Record<string, any> = {
    model: req.model,
    max_tokens: p.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages,
    stream: true
  };
  if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  if (p.temperature !== undefined) body.temperature = Math.min(1, p.temperature);
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.stop?.length) body.stop_sequences = p.stop;
  const tools: any[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (req.webSearch) tools.push(WEB_SEARCH_TOOL);
  if (tools.length) body.tools = tools;
  return body;
}

function mapStop(r: string | undefined): 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'pause' {
  if (r === 'max_tokens') return 'length';
  if (r === 'tool_use') return 'tool-calls';
  if (r === 'refusal') return 'content-filter';
  if (r === 'pause_turn') return 'pause';
  return 'stop';
}

/** The search query out of a server_tool_use input */
function queryOf(input: unknown): string | undefined {
  const q = (input as { query?: unknown } | null)?.query;
  return typeof q === 'string' ? q : undefined;
}

type Block =
  | { kind: 'text' | 'reasoning'; raw: any }
  | { kind: 'tool'; args: string; raw: any }
  | { kind: 'server-tool'; args: string; raw: any }
  | { kind: 'other'; raw: any };

export const anthropicAdapter: ProviderAdapter = {
  async listModels(cfg, preset, transport, auth): Promise<ModelInfo[]> {
    let res: Response;
    try {
      res = await transport.fetch(joinUrl(cfg.baseUrl, preset.modelsPath ?? 'models?limit=100'), { method: 'GET', headers: { Accept: 'application/json', ...(cfg.extraHeaders ?? {}) } }, auth);
    } catch (e) {
      if (e instanceof ProviderFailure) throw e;
      throw new ProviderFailure(errorFromFetchFailure(e, preset.corsHint));
    }
    if (!res.ok) throw new ProviderFailure(await errorFromResponse(res, preset.corsHint));
    const json = await res.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : [];
    return list.map((raw) => preset.mapModel?.(raw, cfg.id)).filter((m): m is ModelInfo => !!m);
  },

  async *chat(cfg, preset, auth, req, transport): AsyncGenerator<ProviderEvent> {
    let res: Response;
    try {
      res = await transport.fetch(
        joinUrl(cfg.baseUrl, 'messages'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(cfg.extraHeaders ?? {}) },
          body: JSON.stringify(buildAnthropicBody(req)),
          signal: req.signal
        },
        auth
      );
    } catch (e) {
      yield { type: 'error', error: e instanceof ProviderFailure ? e.error : errorFromFetchFailure(e, preset.corsHint) };
      return;
    }
    if (!res.ok) {
      yield { type: 'error', error: await errorFromResponse(res, preset.corsHint) };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: { kind: 'server', message: tp('stream.emptyBody') } };
      return;
    }
    yield { type: 'start' };
    // Block number (Anthropic's index) → this app's block, and every block as received (for provider-content)
    const blocks = new Map<number, Block>();
    const content: any[] = [];
    let usedServerTools = false;
    let usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, webSearches: 0 };
    let stop: string | undefined;
    const parseArgs = (args: string): { input: unknown; parseError?: string } => {
      try {
        return { input: args ? JSON.parse(args) : {} };
      } catch (e) {
        return { input: {}, parseError: String(e) };
      }
    };
    const finish = function* (index: number, b: Block): Generator<ProviderEvent> {
      if (b.kind === 'tool') {
        const { input, parseError } = parseArgs(b.args);
        b.raw.input = input;
        yield { type: 'tool-call-end', index, input, parseError };
      } else if (b.kind === 'server-tool') {
        const { input } = parseArgs(b.args);
        b.raw.input = input;
        yield { type: 'server-tool', id: String(b.raw.id), name: String(b.raw.name), query: queryOf(input), state: 'running' };
      } else if (b.kind === 'text' || b.kind === 'reasoning') yield { type: b.kind === 'text' ? 'text-end' : 'reasoning-end', index };
    };
    const closeAll = function* (): Generator<ProviderEvent> {
      for (const [index, b] of blocks) yield* finish(index, b);
      blocks.clear();
    };
    try {
      for await (const msg of parseSSE(res.body, req.signal)) {
        let d: any;
        try {
          d = JSON.parse(msg.data);
        } catch {
          continue;
        }
        switch (d?.type) {
          case 'message_start': {
            const u = d.message?.usage ?? {};
            const cached = (u.cache_read_input_tokens ?? 0) as number;
            usage = { ...usage, inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + cached, cachedInputTokens: cached, outputTokens: u.output_tokens ?? 0 };
            break;
          }
          case 'content_block_start': {
            const cb = structuredClone(d.content_block ?? {});
            const index = Number(d.index);
            content[index] = cb;
            if (cb.type === 'tool_use') {
              blocks.set(index, { kind: 'tool', args: '', raw: cb });
              yield { type: 'tool-call-start', index, toolCallId: String(cb.id), name: String(cb.name) };
            } else if (cb.type === 'server_tool_use') {
              usedServerTools = true;
              blocks.set(index, { kind: 'server-tool', args: '', raw: cb });
              yield { type: 'server-tool', id: String(cb.id), name: String(cb.name), state: 'running' };
            } else if (cb.type === 'web_search_tool_result') {
              usedServerTools = true;
              blocks.set(index, { kind: 'other', raw: cb });
              const id = String(cb.tool_use_id);
              if (Array.isArray(cb.content)) {
                for (const r of cb.content) if (r?.type === 'web_search_result' && typeof r.url === 'string') yield { type: 'source', url: r.url, title: r.title };
                yield { type: 'server-tool', id, name: 'web_search', state: 'done', resultCount: cb.content.length };
              } else yield { type: 'server-tool', id, name: 'web_search', state: 'error', error: String(cb.content?.error_code ?? 'error') };
            } else if (cb.type === 'thinking') {
              blocks.set(index, { kind: 'reasoning', raw: cb });
              yield { type: 'reasoning-start', index };
            } else if (cb.type === 'text') {
              blocks.set(index, { kind: 'text', raw: cb });
              yield { type: 'text-start', index };
              if (cb.text) yield { type: 'text-delta', index, delta: cb.text };
            } else blocks.set(index, { kind: 'other', raw: cb });
            break;
          }
          case 'content_block_delta': {
            const index = Number(d.index);
            const delta = d.delta ?? {};
            const b = blocks.get(index);
            if (!b) break;
            if (delta.type === 'text_delta' && delta.text) {
              b.raw.text = (b.raw.text ?? '') + delta.text;
              yield { type: 'text-delta', index, delta: delta.text };
            } else if (delta.type === 'thinking_delta' && delta.thinking) {
              b.raw.thinking = (b.raw.thinking ?? '') + delta.thinking;
              yield { type: 'reasoning-delta', index, delta: delta.thinking };
            } else if (delta.type === 'signature_delta' && delta.signature) b.raw.signature = (b.raw.signature ?? '') + delta.signature;
            else if (delta.type === 'citations_delta' && delta.citation) {
              const c = delta.citation;
              (b.raw.citations ??= []).push(c);
              if (typeof c.url === 'string') yield { type: 'source', url: c.url, title: c.title, snippet: c.cited_text };
            } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && (b.kind === 'tool' || b.kind === 'server-tool')) {
              b.args += delta.partial_json;
              if (b.kind === 'tool') yield { type: 'tool-call-delta', index, argsDelta: delta.partial_json };
            }
            break;
          }
          case 'content_block_stop': {
            const index = Number(d.index);
            const b = blocks.get(index);
            if (!b) break;
            blocks.delete(index);
            yield* finish(index, b);
            break;
          }
          case 'message_delta': {
            stop = d.delta?.stop_reason ?? stop;
            const u = d.usage ?? {};
            if (typeof u.output_tokens === 'number') usage.outputTokens = u.output_tokens;
            if (typeof u.server_tool_use?.web_search_requests === 'number') usage.webSearches = u.server_tool_use.web_search_requests;
            break;
          }
          case 'error': {
            yield* closeAll();
            const e = d.error ?? {};
            const kind = e.type === 'overloaded_error' ? 'server' : e.type === 'rate_limit_error' ? 'rate-limit' : 'server';
            yield { type: 'error', error: { ...classifyError(500, { error: e }), kind, message: tp('stream.error', { message: e.message ?? e.type ?? tp('stream.unknownError') }) } };
            return;
          }
        }
      }
    } catch (e) {
      yield* closeAll();
      yield isAbort(e) || req.signal.aborted
        ? { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } }
        : { type: 'error', error: { kind: 'network-or-cors', message: tp('stream.disconnected') } };
      return;
    }
    yield* closeAll();
    if (req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } };
      return;
    }
    // A step with server tools is sent back exactly as received while the turn runs
    if (usedServerTools) yield { type: 'provider-content', provider: 'anthropic', content: content.filter(Boolean) };
    yield {
      type: 'usage',
      usage: { inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens || undefined, outputTokens: usage.outputTokens, webSearches: usage.webSearches || undefined }
    };
    yield { type: 'done', reason: mapStop(stop) };
  }
};
