// Anthropic Messages API の Adapter（OpenAI 互換ではないので別実装）。
// - キーは金庫が x-api-key ヘッダで付ける（preset.keyHeader）
// - ブラウザから直接呼ぶため anthropic-dangerous-direct-browser-access ヘッダが要る（preset の extraHeaders）
// - 拡張思考（extended thinking）は使わない（ツール呼び出しと組み合わせると、署名付きの思考ブロックを送り返す必要があるため）
import type { ChatMessage, ChatRequest, ModelInfo, ProviderAdapter, ProviderEvent, Part } from './types';
import { parseSSE } from './sse';
import { classifyError, errorFromFetchFailure, errorFromResponse, isAbort, ProviderFailure } from './errors';
import { joinUrl } from './openai-compatible';

type ToolPart = Extract<Part, { type: 'tool' }>;
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

function toolResultText(t: ToolPart): string {
  if (t.state === 'output-denied') return `ユーザーがこのツールの実行を拒否しました。${t.approval?.reason ?? ''}`;
  if (t.state === 'output-error') return `ツールの実行に失敗しました: ${t.error ?? ''}`;
  return typeof t.modelOutput === 'string' ? t.modelOutput : JSON.stringify(t.modelOutput ?? null);
}

/** 正規化メッセージ → Anthropic の system と messages */
export function toAnthropic(messages: ChatMessage[]): { system: string; messages: any[] } {
  const system: string[] = [];
  const out: any[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    // 同じ役割が続いたら 1 つにまとめる
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
    const blocks: any[] = text.trim() ? [{ type: 'text', text }] : [];
    for (const t of tools) blocks.push({ type: 'tool_use', id: t.toolCallId, name: t.name, input: t.input && typeof t.input === 'object' ? t.input : {} });
    push('assistant', blocks);
    const results = tools
      .filter((t) => t.state === 'output-available' || t.state === 'output-error' || t.state === 'output-denied')
      .map((t) => ({ type: 'tool_result', tool_use_id: t.toolCallId, content: toolResultText(t), ...(t.state !== 'output-available' ? { is_error: true } : {}) }));
    push('user', results);
  }
  return { system: system.join('\n\n'), messages: out };
}

export function buildAnthropicBody(req: ChatRequest): Record<string, any> {
  const { system, messages } = toAnthropic(req.messages);
  const p = req.params ?? {};
  // プロンプトキャッシュ: システムプロンプトと、最後のメッセージの末尾に区切りを置く
  const last = messages[messages.length - 1];
  if (last?.content?.length) last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: { type: 'ephemeral' } };
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
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return body;
}

function mapStop(r: string | undefined): 'stop' | 'length' | 'tool-calls' | 'content-filter' {
  if (r === 'max_tokens') return 'length';
  if (r === 'tool_use') return 'tool-calls';
  if (r === 'refusal') return 'content-filter';
  return 'stop';
}

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
      yield { type: 'error', error: { kind: 'server', message: '応答本文が空でした。' } };
      return;
    }
    yield { type: 'start' };
    // ブロックの番号（Anthropic の index）→ このアプリのブロック
    const blocks = new Map<number, { kind: 'text' | 'reasoning' | 'tool'; args: string }>();
    let usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let stop: string | undefined;
    const closeAll = function* (): Generator<ProviderEvent> {
      for (const [index, b] of blocks) {
        if (b.kind === 'tool') {
          let input: unknown = {};
          let parseError: string | undefined;
          try {
            input = b.args ? JSON.parse(b.args) : {};
          } catch (e) {
            parseError = String(e);
          }
          yield { type: 'tool-call-end', index, input, parseError };
        } else yield { type: b.kind === 'text' ? 'text-end' : 'reasoning-end', index };
      }
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
            usage = { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + cached, cachedInputTokens: cached, outputTokens: u.output_tokens ?? 0 };
            break;
          }
          case 'content_block_start': {
            const cb = d.content_block ?? {};
            const index = Number(d.index);
            if (cb.type === 'tool_use') {
              blocks.set(index, { kind: 'tool', args: '' });
              yield { type: 'tool-call-start', index, toolCallId: String(cb.id), name: String(cb.name) };
            } else if (cb.type === 'thinking') {
              blocks.set(index, { kind: 'reasoning', args: '' });
              yield { type: 'reasoning-start', index };
            } else if (cb.type === 'text') {
              blocks.set(index, { kind: 'text', args: '' });
              yield { type: 'text-start', index };
              if (cb.text) yield { type: 'text-delta', index, delta: cb.text };
            }
            break;
          }
          case 'content_block_delta': {
            const index = Number(d.index);
            const delta = d.delta ?? {};
            const b = blocks.get(index);
            if (!b) break;
            if (delta.type === 'text_delta' && delta.text) yield { type: 'text-delta', index, delta: delta.text };
            else if (delta.type === 'thinking_delta' && delta.thinking) yield { type: 'reasoning-delta', index, delta: delta.thinking };
            else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              b.args += delta.partial_json;
              yield { type: 'tool-call-delta', index, argsDelta: delta.partial_json };
            }
            break;
          }
          case 'content_block_stop': {
            const index = Number(d.index);
            const b = blocks.get(index);
            if (!b) break;
            blocks.delete(index);
            if (b.kind === 'tool') {
              let input: unknown = {};
              let parseError: string | undefined;
              try {
                input = b.args ? JSON.parse(b.args) : {};
              } catch (e) {
                parseError = String(e);
              }
              yield { type: 'tool-call-end', index, input, parseError };
            } else yield { type: b.kind === 'text' ? 'text-end' : 'reasoning-end', index };
            break;
          }
          case 'message_delta':
            stop = d.delta?.stop_reason ?? stop;
            if (typeof d.usage?.output_tokens === 'number') usage.outputTokens = d.usage.output_tokens;
            break;
          case 'error': {
            yield* closeAll();
            const e = d.error ?? {};
            const kind = e.type === 'overloaded_error' ? 'server' : e.type === 'rate_limit_error' ? 'rate-limit' : 'server';
            yield { type: 'error', error: { ...classifyError(500, { error: e }), kind, message: `ストリームの途中でエラーが発生しました: ${e.message ?? e.type ?? '不明なエラー'}` } };
            return;
          }
        }
      }
    } catch (e) {
      yield* closeAll();
      yield isAbort(e) || req.signal.aborted
        ? { type: 'error', error: { kind: 'aborted', message: '停止しました。' } }
        : { type: 'error', error: { kind: 'network-or-cors', message: '受信中に接続が切れました。' } };
      return;
    }
    yield* closeAll();
    if (req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: '停止しました。' } };
      return;
    }
    yield { type: 'usage', usage: { inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens || undefined, outputTokens: usage.outputTokens } };
    yield { type: 'done', reason: mapStop(stop) };
  }
};
