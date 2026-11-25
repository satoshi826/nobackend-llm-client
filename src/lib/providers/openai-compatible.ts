// OpenAI-compatible Chat Completions adapter (used by Venice / OpenRouter / Gemini / DeepSeek / Groq / Ollama, etc.)
import type {
  ChatMessage,
  ChatRequest,
  AuthRef,
  KeyedFetch,
  ModelInfo,
  ProviderAdapter,
  ProviderConfig,
  ProviderError,
  ProviderEvent,
  ProviderPreset,
  Transport
} from './types';
import { parseSSE } from './sse';
import { ThinkSplitter } from './think-splitter';
import { errorFromFetchFailure, errorFromResponse, isAbort, ProviderFailure } from './errors';

/** Key check: GET with the key; 2xx means valid */
export async function checkKey(url: string, fetchWithKey: KeyedFetch, corsHint?: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; error?: ProviderError }> {
  let res: Response;
  try {
    res = await fetchWithKey(url, { method: 'GET', headers: { Accept: 'application/json', ...headers } });
  } catch (e) {
    if (e instanceof ProviderFailure) return { ok: false, error: e.error };
    return { ok: false, error: errorFromFetchFailure(e, corsHint) };
  }
  if (!res.ok) return { ok: false, error: await errorFromResponse(res) };
  return { ok: true };
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function effectiveBase(cfg: ProviderConfig): string {
  // With a proxy, send to "proxy URL + path of the original base" (the proxy is expected to forward upstream)
  return cfg.proxyUrl ? cfg.proxyUrl : cfg.baseUrl;
}

/** Normalized messages → OpenAI format */
export function toOpenAIMessages(messages: ChatMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    if (m.role === 'assistant') {
      const toolParts = m.parts.filter((p) => p.type === 'tool') as Extract<ChatMessage['parts'][number], { type: 'tool' }>[];
      const msg: any = { role: 'assistant', content: text };
      if (typeof m.vendorState?.reasoning_content === 'string') msg.reasoning_content = m.vendorState.reasoning_content;
      if (toolParts.length > 0) {
        msg.tool_calls = toolParts.map((t) => ({
          id: t.toolCallId,
          type: 'function',
          function: { name: t.name, arguments: t.argsText || JSON.stringify(t.input ?? {}) }
        }));
      }
      out.push(msg);
      for (const t of toolParts) {
        if (t.state === 'output-available' || t.state === 'output-error' || t.state === 'output-denied') {
          const content =
            t.state === 'output-denied'
              ? `ユーザーがこのツールの実行を拒否しました。${t.approval?.reason ?? ''}`
              : t.state === 'output-error'
                ? `ツールの実行に失敗しました: ${t.error ?? ''}`
                : typeof t.modelOutput === 'string'
                  ? t.modelOutput
                  : JSON.stringify(t.modelOutput ?? null);
          out.push({ role: 'tool', tool_call_id: t.toolCallId, content });
        }
      }
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  return out;
}

/** Strip reasoning_content for APIs that do not accept reasoning being sent back */
function limitReasoning(msgs: any[], mode: 'always' | 'tool-turns' | 'never'): any[] {
  if (mode === 'always') return msgs;
  return msgs.map((m) => {
    if (m.role !== 'assistant' || m.reasoning_content === undefined) return m;
    if (mode === 'tool-turns' && m.tool_calls?.length) return m;
    const { reasoning_content: _r, ...rest } = m;
    return rest;
  });
}

export function buildChatBody(cfg: ProviderConfig, preset: ProviderPreset, req: ChatRequest): Record<string, any> {
  const p = req.params ?? {};
  let body: Record<string, any> = {
    ...(cfg.extraBody ?? {}),
    model: req.model,
    messages: limitReasoning(toOpenAIMessages(req.messages), preset.reasoningResend ?? 'always'),
    stream: true,
    stream_options: { include_usage: true }
  };
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.maxTokens !== undefined) body.max_completion_tokens = p.maxTokens;
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  if (p.stop?.length) body.stop = p.stop;
  if (p.seed !== undefined) body.seed = p.seed;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  if (preset.transformRequest) body = preset.transformRequest(body, req);
  return body;
}

export const openAICompatibleAdapter: ProviderAdapter = {
  async listModels(cfg, preset, transport, auth): Promise<ModelInfo[]> {
    const url = joinUrl(effectiveBase(cfg), preset.modelsPath ?? 'models');
    let res: Response;
    try {
      res = await transport.fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...(cfg.extraHeaders ?? {}) } }, auth);
    } catch (e) {
      if (e instanceof ProviderFailure) throw e;
      throw new ProviderFailure(errorFromFetchFailure(e, preset.corsHint));
    }
    if (!res.ok) throw new ProviderFailure(await errorFromResponse(res, preset.corsHint));
    const json = await res.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const mapped: ModelInfo[] = [];
    for (const raw of list) {
      const m = preset.mapModel ? preset.mapModel(raw, cfg.id) : defaultMapModel(raw, cfg.id);
      if (m) mapped.push(m);
    }
    return mapped;
  },

  chat(cfg, preset, auth, req, transport) {
    return streamChat(cfg, preset, auth, req, transport);
  }
};

function defaultMapModel(raw: any, providerId: string): ModelInfo | null {
  if (!raw?.id) return null;
  return { providerId, id: String(raw.id), name: String(raw.name ?? raw.id), capabilities: {}, privacy: 'unknown', source: 'fetched' };
}

async function* streamChat(
  cfg: ProviderConfig,
  preset: ProviderPreset,
  auth: AuthRef | undefined,
  req: ChatRequest,
  transport: Transport
): AsyncGenerator<ProviderEvent> {
  const url = joinUrl(effectiveBase(cfg), 'chat/completions');
  const body = buildChatBody(cfg, preset, req);
  let res: Response;
  try {
    res = await transport.fetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(cfg.extraHeaders ?? {}) },
        body: JSON.stringify(body),
        signal: req.signal
      },
      auth
    );
  } catch (e) {
    if (e instanceof ProviderFailure) {
      yield { type: 'error', error: e.error };
      return;
    }
    yield { type: 'error', error: errorFromFetchFailure(e, preset.corsHint) };
    return;
  }
  if (!res.ok) {
    yield { type: 'error', error: await errorFromResponse(res, preset.corsHint) };
    return;
  }
  if (!res.body) {
    yield { type: 'error', error: { kind: 'server', message: '応答本文が空でした。' } };
    return;
  }

  yield { type: 'start' };
  if (preset.readHeaders) for (const ev of preset.readHeaders(res.headers)) yield ev;
  const state = new StreamState();
  const seenSources = new Set<string>();
  let finishReason: ProviderEvent & { type: 'done' } = { type: 'done', reason: 'stop' };
  let gotFinish = false;

  try {
    for await (const msg of parseSSE(res.body, req.signal)) {
      const data = msg.data.trim();
      if (data === '[DONE]') break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // ignore broken chunks
      }
      if (chunk?.error) {
        yield* state.closeAll();
        const e = chunk.error;
        yield {
          type: 'error',
          error: {
            kind: e?.code === 'rate_limit_exceeded' || e?.type === 'rate_limit' ? 'rate-limit' : 'server',
            message: `ストリームの途中でエラーが発生しました: ${typeof e === 'string' ? e : e?.message ?? '不明なエラー'}`,
            retryAfterMs: typeof e?.retry_after === 'number' ? e.retry_after * 1000 : undefined
          }
        };
        return;
      }
      if (preset.parseExtra) {
        for (const ev of preset.parseExtra(chunk, seenSources)) yield ev;
      }
      const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
      if (choice) {
        const delta = choice.delta ?? choice.message ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === 'string' && reasoning) yield* state.reasoning(reasoning);
        if (typeof delta.content === 'string' && delta.content) yield* state.content(delta.content);
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) yield* state.toolCall(tc);
        }
        if (choice.finish_reason) {
          gotFinish = true;
          finishReason = { type: 'done', reason: mapFinish(choice.finish_reason) };
        }
      }
      const usage = chunk?.usage ?? chunk?.x_groq?.usage;
      if (usage) {
        const u = usage;
        const cost = chunk.cost?.usd ?? u.cost?.usd ?? (typeof u.cost === 'number' ? u.cost : undefined);
        yield {
          type: 'usage',
          usage: {
            inputTokens: u.prompt_tokens,
            cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? undefined,
            outputTokens: u.completion_tokens,
            reasoningTokens: u.completion_tokens_details?.reasoning_tokens
          },
          costUsd: typeof cost === 'number' ? cost : undefined
        };
      }
    }
  } catch (e) {
    yield* state.closeAll();
    if (isAbort(e) || req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: '停止しました。' } };
    } else {
      yield { type: 'error', error: { kind: 'network-or-cors', message: '受信中に接続が切れました。' } };
    }
    return;
  }
  if (req.signal.aborted) {
    yield* state.closeAll();
    yield { type: 'error', error: { kind: 'aborted', message: '停止しました。' } };
    return;
  }
  yield* state.closeAll();
  if (state.reasoningText) yield { type: 'vendor-state', data: { reasoning_content: state.reasoningText } };
  if (!gotFinish && state.toolIndexMap.size > 0) finishReason = { type: 'done', reason: 'tool-calls' };
  yield finishReason;
}

function mapFinish(r: string): 'stop' | 'length' | 'tool-calls' | 'content-filter' {
  if (r === 'length') return 'length';
  if (r === 'tool_calls' || r === 'function_call') return 'tool-calls';
  if (r === 'content_filter') return 'content-filter';
  return 'stop';
}

/** State for converting chunks into block-level events */
class StreamState {
  private nextIndex = 0;
  private open: { kind: 'text' | 'reasoning'; index: number } | null = null;
  private splitter = new ThinkSplitter();
  reasoningText = '';
  toolIndexMap = new Map<number, { index: number; args: string; id: string; name: string }>();

  *reasoning(delta: string): Generator<ProviderEvent> {
    this.reasoningText += delta;
    yield* this.emit('reasoning', delta);
  }

  *content(delta: string): Generator<ProviderEvent> {
    for (const seg of this.splitter.push(delta)) yield* this.emit(seg.kind, seg.text);
  }

  *toolCall(tc: any): Generator<ProviderEvent> {
    const key = typeof tc.index === 'number' ? tc.index : this.toolIndexMap.size;
    let entry = this.toolIndexMap.get(key);
    if (!entry) {
      yield* this.closeOpen();
      entry = { index: this.nextIndex++, args: '', id: tc.id ?? `call_${key}_${Date.now()}`, name: tc.function?.name ?? '' };
      this.toolIndexMap.set(key, entry);
      yield { type: 'tool-call-start', index: entry.index, toolCallId: entry.id, name: entry.name };
    }
    const args = tc.function?.arguments;
    if (typeof args === 'string' && args) {
      entry.args += args;
      yield { type: 'tool-call-delta', index: entry.index, argsDelta: args };
    }
  }

  private *emit(kind: 'text' | 'reasoning', text: string): Generator<ProviderEvent> {
    if (!text) return;
    if (!this.open || this.open.kind !== kind) {
      yield* this.closeOpen();
      this.open = { kind, index: this.nextIndex++ };
      yield { type: kind === 'text' ? 'text-start' : 'reasoning-start', index: this.open.index };
    }
    yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: this.open.index, delta: text };
  }

  private *closeOpen(): Generator<ProviderEvent> {
    if (this.open) {
      yield { type: this.open.kind === 'text' ? 'text-end' : 'reasoning-end', index: this.open.index };
      this.open = null;
    }
  }

  *closeAll(): Generator<ProviderEvent> {
    for (const seg of this.splitter.flush()) yield* this.emit(seg.kind, seg.text);
    yield* this.closeOpen();
    for (const t of this.toolIndexMap.values()) {
      let input: unknown = {};
      let parseError: string | undefined;
      if (t.args) {
        try {
          input = JSON.parse(t.args);
        } catch (e) {
          parseError = String(e);
        }
      }
      yield { type: 'tool-call-end', index: t.index, input, parseError };
    }
    this.toolIndexMap.clear();
  }
}
