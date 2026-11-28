// OpenAI-compatible Chat Completions adapter (used by Venice / OpenRouter / Gemini / DeepSeek / Groq / Ollama, etc.)
import type {
  ChatMessage,
  ChatRequest,
  AuthRef,
  ModelInfo,
  ProviderAdapter,
  ProviderConfig,
  ProviderEvent,
  ProviderPreset,
  Part,
  Transport
} from './types';
import { parseSSE } from './sse';
import { ThinkSplitter } from './think-splitter';
import { classifyError, failureOf, isAbort, ProviderFailure, sendOrFail } from './errors';
import { t as tp } from './messages';

/** A number from a JSON number or numeric string */
export function numberOf(x: unknown): number | undefined {
  const n = typeof x === 'string' ? parseFloat(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * What the model reads for a tool call that failed or was denied (undefined for one that ran): in English, whatever
 * the UI language. The app's own texts come as modelError; a tool's raw error and the user's reason as they are
 */
export function toolFailureText(t: Extract<Part, { type: 'tool' }>): string | undefined {
  if (t.state === 'output-denied') {
    const reason = t.modelError ?? t.approval?.reason;
    return reason ? `The user denied running this tool. ${reason}` : 'The user denied running this tool.';
  }
  if (t.state === 'output-error') return `The tool failed: ${t.modelError ?? t.error ?? ''}`;
  return undefined;
}

export function joinUrl(base: string, path: string): string {
  // "../x" climbs out of the base path (e.g. a model list kept beside /v1)
  if (path.startsWith('../')) return new URL(path, base.replace(/\/+$/, '') + '/').toString();
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

/**
 * Send a request to a provider (its connection's headers added). Not reaching it, or an error answer, throws a
 * ProviderFailure with the common error
 */
export function send(cfg: ProviderConfig, preset: ProviderPreset, transport: Transport, auth: AuthRef | undefined, path: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  return sendOrFail(() => transport.fetch(joinUrl(cfg.baseUrl, path), { ...init, headers: { ...init.headers, ...cfg.headers } }, auth), preset.corsHint);
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
          const content = toolFailureText(t) ?? (typeof t.modelOutput === 'string' ? t.modelOutput : JSON.stringify(t.modelOutput ?? null));
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

export function buildChatBody(preset: ProviderPreset, req: ChatRequest): Record<string, any> {
  const p = req.params ?? {};
  let body: Record<string, any> = {
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
  if (preset.flex && req.providerOptions?.[preset.id]?.service_tier === 'flex') body.service_tier = 'flex';
  if (preset.transformRequest) body = preset.transformRequest(body, req);
  return body;
}

export const openAICompatibleAdapter: ProviderAdapter = {
  async listModels(cfg, preset, transport, auth): Promise<ModelInfo[]> {
    const res = await send(cfg, preset, transport, auth, preset.modelsPath ?? 'models', { method: 'GET', headers: { Accept: 'application/json' } });
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
  const body = buildChatBody(preset, req);
  const post = (b: Record<string, any>) =>
    send(cfg, preset, transport, auth, 'chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(b), signal: req.signal });
  let res: Response;
  try {
    res = await post(body).catch((e) => {
      // The flex tier can refuse a request (busy, or not offered for this model): once more in the standard tier
      const status = e instanceof ProviderFailure ? e.error.status : undefined;
      if (body.service_tier !== 'flex' || status === undefined || status === 401 || status === 403) throw e;
      const { service_tier: _flex, ...standard } = body;
      return post(standard);
    });
  } catch (e) {
    yield { type: 'error', error: failureOf(e, preset.corsHint) };
    return;
  }
  if (!res.body) {
    yield { type: 'error', error: { kind: 'server', message: tp('stream.emptyBody') } };
    return;
  }

  yield { type: 'start' };
  if (preset.readHeaders) for (const ev of preset.readHeaders(res.headers)) yield ev;
  const state = new StreamState();
  const seenSources = new Set<string>();
  let finishReason: ProviderEvent & { type: 'done' } = { type: 'done', reason: 'stop' };
  let gotFinish = false;
  // The tier that served the answer, as the response says (priced lower when it was flex)
  let tier: string | undefined;

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
        // Sent after the answer started (OpenRouter, NanoGPT, LiteLLM): the status, when given, is in the error's code or status
        const e = chunk.error;
        yield { type: 'error', error: classifyError(numberOf(e?.code) ?? numberOf(e?.status), chunk) };
        return;
      }
      if (preset.parseExtra) {
        for (const ev of preset.parseExtra(chunk, seenSources)) yield ev;
      }
      if (typeof chunk?.service_tier === 'string') tier = chunk.service_tier;
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
            reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
            ...(tier === 'flex' && preset.flex ? { priceFactor: preset.flex.priceFactor } : {})
          },
          costUsd: typeof cost === 'number' ? cost : undefined
        };
      }
    }
  } catch (e) {
    yield* state.closeAll();
    if (isAbort(e) || req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } };
    } else {
      yield { type: 'error', error: { kind: 'network-or-cors', message: tp('stream.disconnected') } };
    }
    return;
  }
  if (req.signal.aborted) {
    yield* state.closeAll();
    yield { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } };
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
