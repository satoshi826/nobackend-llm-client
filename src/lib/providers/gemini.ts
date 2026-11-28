// Adapter for the native Gemini API (generateContent).
// The OpenAI-compatible endpoint cannot use Google Search grounding, so Gemini uses its own API:
// - key in the x-goog-api-key header (preset.keyHeader; attached by the key vault)
// - streamGenerateContent?alt=sse; parts: text, thought summaries (thought: true), functionCall, inlineData (images)
// - thoughtSignature: Gemini 3 requires the signed parts of the current turn back, so a step with function calls is
//   kept verbatim (provider-content) and sent back as is while the turn runs; earlier turns are sent as plain parts
// - Google Search grounding (tools: google_search) → sources; image output (responseModalities) → image events
import type { ChatMessage, ChatRequest, ModelInfo, Part, ProviderAdapter, ProviderEvent } from './types';
import { parseSSE } from './sse';
import { classifyError, failureOf, isAbort } from './errors';
import { send, toolFailureText } from './openai-compatible';
import { t as tp } from './messages';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** Models that think and can return thought summaries */
export const geminiThinks = (model: string) => /gemini-(2\.5|[3-9]|\d{2})/.test(model) && !/-image/.test(model);

function toolResult(t: ToolPart): unknown {
  const failure = toolFailureText(t);
  return failure !== undefined ? { error: failure } : { result: t.modelOutput ?? null };
}

/** Normalized messages → Gemini systemInstruction and contents (roles user / model, alternating) */
export function toGemini(messages: ChatMessage[]): { systemInstruction?: any; contents: any[] } {
  const system: string[] = [];
  const contents: any[] = [];
  const push = (role: 'user' | 'model', parts: any[]) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
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
      push('user', text.trim() ? [{ text }] : []);
      continue;
    }
    const tools = m.parts.filter((p): p is ToolPart => p.type === 'tool');
    const raw = (m.vendorState?.providerContent as { provider?: string; content?: unknown[] } | undefined);
    if (raw?.provider === 'gemini' && Array.isArray(raw.content) && raw.content.length) push('model', structuredClone(raw.content));
    else {
      const parts: any[] = text.trim() ? [{ text }] : [];
      for (const t of tools) parts.push({ functionCall: { name: t.name, args: t.input && typeof t.input === 'object' ? t.input : {} } });
      push('model', parts);
    }
    const results = tools
      .filter((t) => t.state === 'output-available' || t.state === 'output-error' || t.state === 'output-denied')
      .map((t) => ({ functionResponse: { ...(t.toolCallId.startsWith('gemini-') ? {} : { id: t.toolCallId }), name: t.name, response: toolResult(t) } }));
    push('user', results);
  }
  return { ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}), contents };
}

export function buildGeminiBody(req: ChatRequest): Record<string, any> {
  const { systemInstruction, contents } = toGemini(req.messages);
  const p = req.params ?? {};
  const generationConfig: Record<string, any> = {};
  if (p.temperature !== undefined) generationConfig.temperature = p.temperature;
  if (p.topP !== undefined) generationConfig.topP = p.topP;
  if (p.maxTokens !== undefined) generationConfig.maxOutputTokens = p.maxTokens;
  if (p.stop?.length) generationConfig.stopSequences = p.stop;
  if (geminiThinks(req.model)) generationConfig.thinkingConfig = { includeThoughts: true };
  if (req.imageOutput) generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  const tools: any[] = [];
  if (req.webSearch) tools.push({ google_search: {} });
  // JSON Schema as is (parametersJsonSchema), not the OpenAPI subset of "parameters"
  if (req.tools?.length) tools.push({ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) });
  return {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(tools.length ? { tools } : {})
  };
}

const FILTERED = /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII|IMAGE_(SAFETY|PROHIBITED|RECITATION|OTHER)|NO_IMAGE/;

function mapFinish(r: string | undefined, calledTools: boolean): 'stop' | 'length' | 'tool-calls' | 'content-filter' {
  if (calledTools) return 'tool-calls';
  if (r === 'MAX_TOKENS') return 'length';
  if (r && FILTERED.test(r)) return 'content-filter';
  return 'stop';
}

export const geminiAdapter: ProviderAdapter = {
  async listModels(cfg, preset, transport, auth): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let token = '';
    for (let page = 0; page < 5; page++) {
      const path = (preset.modelsPath ?? 'models?pageSize=200') + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
      const res = await send(cfg, preset, transport, auth, path, { method: 'GET', headers: { Accept: 'application/json' } });
      const json = await res.json();
      for (const raw of Array.isArray(json?.models) ? json.models : []) {
        const m = preset.mapModel?.(raw, cfg.id);
        if (m) out.push(m);
      }
      token = typeof json?.nextPageToken === 'string' ? json.nextPageToken : '';
      if (!token) break;
    }
    return out;
  },

  async *chat(cfg, preset, auth, req, transport): AsyncGenerator<ProviderEvent> {
    let res: Response;
    try {
      res = await send(cfg, preset, transport, auth, `models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(buildGeminiBody(req)),
        signal: req.signal
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
    let next = 0;
    let open: { kind: 'text' | 'reasoning'; index: number } | null = null;
    let calls = 0;
    let finish: string | undefined;
    let blocked: string | undefined;
    const raw: any[] = [];
    const seenSources = new Set<string>();
    const seenQueries = new Set<string>();
    let usage: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number } = {};
    const closeOpen = function* (): Generator<ProviderEvent> {
      if (open) yield { type: open.kind === 'text' ? 'text-end' : 'reasoning-end', index: open.index };
      open = null;
    };
    const emit = function* (kind: 'text' | 'reasoning', text: string): Generator<ProviderEvent> {
      if (!open || open.kind !== kind) {
        yield* closeOpen();
        open = { kind, index: next++ };
        yield { type: kind === 'text' ? 'text-start' : 'reasoning-start', index: open.index };
      }
      yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: open.index, delta: text };
    };
    /** Keep the parts as received; plain text pieces are joined, signed parts stay on their own */
    const keep = (part: any) => {
      const last = raw[raw.length - 1];
      const plain = (p: any) => typeof p?.text === 'string' && !p.thoughtSignature && Object.keys(p).every((k) => k === 'text' || k === 'thought');
      if (plain(part) && plain(last) && !!last.thought === !!part.thought) last.text += part.text;
      else raw.push(structuredClone(part));
    };
    try {
      for await (const msg of parseSSE(res.body, req.signal)) {
        let d: any;
        try {
          d = JSON.parse(msg.data);
        } catch {
          continue;
        }
        if (d?.error) {
          yield* closeOpen();
          yield { type: 'error', error: classifyError(typeof d.error.code === 'number' ? d.error.code : undefined, d) };
          return;
        }
        if (d?.promptFeedback?.blockReason) blocked = String(d.promptFeedback.blockReason);
        const cand = Array.isArray(d?.candidates) ? d.candidates[0] : undefined;
        for (const part of Array.isArray(cand?.content?.parts) ? cand.content.parts : []) {
          keep(part);
          if (typeof part.text === 'string' && part.text) yield* emit(part.thought ? 'reasoning' : 'text', part.text);
          else if (part.functionCall) {
            yield* closeOpen();
            const index = next++;
            const id = typeof part.functionCall.id === 'string' && part.functionCall.id ? part.functionCall.id : `gemini-${Date.now().toString(36)}-${index}`;
            const args = part.functionCall.args ?? {};
            calls++;
            yield { type: 'tool-call-start', index, toolCallId: id, name: String(part.functionCall.name ?? '') };
            yield { type: 'tool-call-delta', index, argsDelta: JSON.stringify(args) };
            yield { type: 'tool-call-end', index, input: args };
          } else if (part.inlineData?.data && !part.thought && String(part.inlineData.mimeType ?? '').startsWith('image/')) {
            yield { type: 'image', data: String(part.inlineData.data), mimeType: String(part.inlineData.mimeType) };
          }
        }
        const g = cand?.groundingMetadata;
        if (g) {
          for (const q of Array.isArray(g.webSearchQueries) ? g.webSearchQueries : []) {
            if (typeof q !== 'string' || seenQueries.has(q)) continue;
            seenQueries.add(q);
            yield { type: 'server-tool', id: `google-search-${seenQueries.size}`, name: 'web_search', query: q, state: 'done' };
          }
          for (const c of Array.isArray(g.groundingChunks) ? g.groundingChunks : []) {
            const uri = c?.web?.uri;
            if (typeof uri !== 'string' || seenSources.has(uri)) continue;
            seenSources.add(uri);
            yield { type: 'source', url: uri, title: typeof c.web.title === 'string' ? c.web.title : undefined };
          }
        }
        if (cand?.finishReason) finish = String(cand.finishReason);
        const u = d?.usageMetadata;
        if (u) {
          const thoughts = typeof u.thoughtsTokenCount === 'number' ? u.thoughtsTokenCount : 0;
          usage = {
            inputTokens: u.promptTokenCount,
            cachedInputTokens: u.cachedContentTokenCount || undefined,
            outputTokens: (u.candidatesTokenCount ?? 0) + thoughts,
            reasoningTokens: thoughts || undefined
          };
        }
      }
    } catch (e) {
      yield* closeOpen();
      yield isAbort(e) || req.signal.aborted
        ? { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } }
        : { type: 'error', error: { kind: 'network-or-cors', message: tp('stream.disconnected') } };
      return;
    }
    yield* closeOpen();
    if (req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: tp('stream.stopped') } };
      return;
    }
    if (blocked && !raw.length) {
      yield { type: 'error', error: { kind: 'content-policy', message: tp('error.policy'), detail: `promptFeedback.blockReason: ${blocked}` } };
      return;
    }
    // Signed parts of a step with function calls go back as they came (thoughtSignature)
    if (calls > 0) yield { type: 'provider-content', provider: 'gemini', content: raw };
    yield { type: 'usage', usage: { ...usage, webSearches: seenQueries.size || undefined } };
    yield { type: 'done', reason: mapFinish(finish, calls > 0) };
  }
};
