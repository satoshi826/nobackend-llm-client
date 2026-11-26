// Native web search and image output: request shapes and stream parsing per provider
import { describe, expect, it } from 'vitest';
import { anthropicAdapter, buildAnthropicBody, toAnthropic } from './anthropic';
import { buildGeminiBody, geminiAdapter, toGemini } from './gemini';
import { anthropicPreset, geminiPreset, groqExtras, groqPreset } from './presets/more';
import { openrouterExtras, openrouterPreset } from './presets/openrouter';
import { buildChatBody } from './openai-compatible';
import { runAssistant } from '../chat/runner';
import type { MessageRecord } from '../db/schema';
import type { ChatMessage, ChatRequest, ProviderConfig, ProviderEvent, Transport } from './types';

const enc = new TextEncoder();
function sse(events: unknown[]): Response {
  const text = events.map((d) => `data: ${JSON.stringify(d)}\n\n`).join('');
  return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(text)), c.close()) }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const msg = (role: ChatMessage['role'], parts: ChatMessage['parts'], id: string = role): ChatMessage => ({ id, role, parts });
const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ model: 'm', messages: [msg('user', [{ type: 'text', text: 'q' }])], signal: new AbortController().signal, ...extra });
async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const once = (events: unknown[]): Transport => ({ fetch: async () => sse(events) });

// ---- Anthropic ----
const searchTurn = [
  { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"天気"}' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://a.example/', title: 'A', encrypted_content: 'E1' }] }
  },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '晴れ' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://a.example/', title: 'A', encrypted_index: 'I1', cited_text: '晴れ' } } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9, server_tool_use: { web_search_requests: 1 } } }
];

describe('Anthropic web search', () => {
  it('adds the server tool only when asked', () => {
    expect(buildAnthropicBody(req()).tools).toBeUndefined();
    expect(buildAnthropicBody(req({ webSearch: 'auto' })).tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  });
  it('turns server tool blocks and citations into events, and keeps the blocks verbatim', async () => {
    const cfg: ProviderConfig = { id: 'anthropic', ...anthropicPreset.defaults };
    const evs = await collect(anthropicAdapter.chat(cfg, anthropicPreset, undefined, req({ webSearch: 'auto' }), once(searchTurn)));
    expect(evs.filter((e) => e.type === 'server-tool').at(-1)).toMatchObject({ id: 'srv1', state: 'done', resultCount: 1 });
    expect(evs.find((e) => e.type === 'server-tool' && e.query)).toMatchObject({ query: '天気' });
    expect(evs.filter((e) => e.type === 'source')).toHaveLength(2); // result + citation (deduplicated later)
    const raw = evs.find((e) => e.type === 'provider-content') as Extract<ProviderEvent, { type: 'provider-content' }>;
    expect(raw.content).toHaveLength(3);
    expect(raw.content[0]).toMatchObject({ type: 'server_tool_use', input: { query: '天気' } });
    expect(raw.content[2]).toMatchObject({ type: 'text', text: '晴れ', citations: [{ encrypted_index: 'I1' }] });
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({ usage: { webSearches: 1 } });
  });
  it('maps pause_turn and sends a paused step back exactly as received', async () => {
    const paused = [...searchTurn.slice(0, -1), { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 3 } }];
    const evs = await collect(anthropicAdapter.chat({ id: 'anthropic', ...anthropicPreset.defaults }, anthropicPreset, undefined, req({ webSearch: 'auto' }), once(paused)));
    expect(evs.at(-1)).toEqual({ type: 'done', reason: 'pause' });
    const raw = (evs.find((e) => e.type === 'provider-content') as any).content;
    const r = toAnthropic([msg('user', [{ type: 'text', text: 'q' }]), { ...msg('assistant', [{ type: 'text', text: '晴れ' }]), vendorState: { providerContent: { provider: 'anthropic', content: raw } } }]);
    expect(r.messages[1].content).toEqual(raw);
  });
  it('the runner continues a paused turn and drops the raw blocks at the end', async () => {
    const bodies: any[] = [];
    const responses = [[...searchTurn.slice(0, -1), { type: 'message_delta', delta: { stop_reason: 'pause_turn' } }], [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '。以上です' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    ]];
    let n = 0;
    const t: Transport = {
      async fetch(_u, init) {
        bodies.push(JSON.parse(String(init.body)));
        return sse(responses[n++]);
      }
    };
    const draft = { id: 'a', conversationId: 'c', parentId: 'u', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' } as MessageRecord;
    const out = await runAssistant({
      provider: { id: 'anthropic', ...anthropicPreset.defaults },
      preset: anthropicPreset,
      auth: undefined,
      transport: t,
      model: 'claude-x',
      history: [{ id: 'u', conversationId: 'c', parentId: null, role: 'user', parts: [{ type: 'text', text: '天気は' }], createdAt: 0, status: 'done' }],
      systemPrompt: '',
      draft,
      webSearch: 'auto',
      signal: new AbortController().signal,
      onUpdate() {},
      async persist() {}
    });
    expect(bodies).toHaveLength(2);
    // The second request ends with the paused assistant content, unchanged, and the same tools
    expect(bodies[1].messages.at(-1).role).toBe('assistant');
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ type: 'server_tool_use', id: 'srv1' });
    expect(bodies[1].tools).toEqual(bodies[0].tools);
    expect(out.status).toBe('done');
    expect(out.parts.some((p) => p.type === 'provider-content')).toBe(false);
    expect(out.parts.filter((p) => p.type === 'source')).toHaveLength(1);
    expect(out.parts.find((p) => p.type === 'server-tool')).toMatchObject({ query: '天気', state: 'done' });
  });
});

// ---- Gemini ----
describe('Gemini native adapter', () => {
  const cfg: ProviderConfig = { id: 'gemini', ...geminiPreset.defaults };
  it('uses the native API with the key in x-goog-api-key', () => {
    expect(cfg.kind).toBe('gemini');
    expect(cfg.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(geminiPreset.keyHeader).toEqual({ name: 'x-goog-api-key' });
  });
  it('builds contents, system instruction, tools, search and image output', () => {
    const b = buildGeminiBody(
      req({
        model: 'gemini-3-pro',
        messages: [msg('system', [{ type: 'text', text: 'sys' }]), msg('user', [{ type: 'text', text: 'q' }])],
        tools: [{ name: 'echo', description: 'd', parameters: { type: 'object', additionalProperties: false } }],
        webSearch: 'auto',
        params: { temperature: 0.5 }
      })
    );
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(b.contents).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
    expect(b.tools).toEqual([{ google_search: {} }, { functionDeclarations: [{ name: 'echo', description: 'd', parametersJsonSchema: { type: 'object', additionalProperties: false } }] }]);
    expect(b.generationConfig).toEqual({ temperature: 0.5, thinkingConfig: { includeThoughts: true } });
    expect(buildGeminiBody(req({ model: 'gemini-2.5-flash-image', imageOutput: true })).generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'] });
  });
  it('streams thoughts, text, function calls (with signatures kept), grounding, images and usage', async () => {
    let url = '';
    const t: Transport = {
      async fetch(u) {
        url = u;
        return sse([
          { candidates: [{ content: { role: 'model', parts: [{ text: '考え', thought: true }] } }] },
          { candidates: [{ content: { role: 'model', parts: [{ text: '答え' }] } }] },
          { candidates: [{ content: { role: 'model', parts: [{ text: 'です' }] } }] },
          { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'fc1', name: 'echo', args: { q: 'x' } }, thoughtSignature: 'SIG' }] } }] },
          { candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBO' } }] } }] },
          {
            candidates: [{ finishReason: 'STOP', groundingMetadata: { webSearchQueries: ['天気'], groundingChunks: [{ web: { uri: 'https://g.example/', title: 'G' } }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, cachedContentTokenCount: 4 }
          }
        ]);
      }
    };
    const evs = await collect(geminiAdapter.chat(cfg, geminiPreset, { keyId: 'gemini' }, req({ model: 'gemini-3-pro' }), t));
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse');
    expect(evs.filter((e) => e.type === 'reasoning-delta').map((e: any) => e.delta).join('')).toBe('考え');
    expect(evs.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('')).toBe('答えです');
    expect(evs.find((e) => e.type === 'tool-call-start')).toMatchObject({ toolCallId: 'fc1', name: 'echo' });
    expect(evs.find((e) => e.type === 'tool-call-end')).toMatchObject({ input: { q: 'x' } });
    expect(evs.find((e) => e.type === 'image')).toEqual({ type: 'image', data: 'iVBO', mimeType: 'image/png' });
    expect(evs.find((e) => e.type === 'source')).toMatchObject({ url: 'https://g.example/' });
    expect(evs.find((e) => e.type === 'server-tool')).toMatchObject({ query: '天気', state: 'done' });
    const raw = (evs.find((e) => e.type === 'provider-content') as any).content;
    expect(raw).toEqual([
      { text: '考え', thought: true },
      { text: '答えです' },
      { functionCall: { id: 'fc1', name: 'echo', args: { q: 'x' } }, thoughtSignature: 'SIG' },
      { inlineData: { mimeType: 'image/png', data: 'iVBO' } }
    ]);
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 10, outputTokens: 8, reasoningTokens: 3, cachedInputTokens: 4, webSearches: 1 } });
    expect(evs.at(-1)).toEqual({ type: 'done', reason: 'tool-calls' });
  });
  it('sends signed parts back verbatim within the turn, and function responses with their ids', () => {
    const raw = [{ functionCall: { id: 'fc1', name: 'echo', args: {} }, thoughtSignature: 'SIG' }];
    const tool = { type: 'tool' as const, toolCallId: 'fc1', name: 'echo', argsText: '{}', input: {}, state: 'output-available' as const, modelOutput: 'ok' };
    const r = toGemini([msg('user', [{ type: 'text', text: 'q' }]), { ...msg('assistant', [tool]), vendorState: { providerContent: { provider: 'gemini', content: raw } } }]);
    expect(r.contents[1]).toEqual({ role: 'model', parts: raw });
    expect(r.contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { id: 'fc1', name: 'echo', response: { result: 'ok' } } }] });
  });
  it('maps models: image output, search on Gemini 3+, no embeddings', () => {
    const m = (name: string, extra = {}) => geminiPreset.mapModel!({ name: `models/${name}`, displayName: name, inputTokenLimit: 1000, supportedGenerationMethods: ['generateContent'], ...extra }, 'gemini');
    expect(m('gemini-3-pro')?.capabilities).toMatchObject({ tools: true, webSearch: true, imageOutput: false });
    expect(m('gemini-2.5-flash')?.capabilities.webSearch).toBe(false);
    expect(m('gemini-2.5-flash-image')?.capabilities).toMatchObject({ imageOutput: true, tools: false });
    expect(m('text-embedding-004')).toBeNull();
    expect(m('gemini-x', { supportedGenerationMethods: ['embedContent'] })).toBeNull();
    expect(geminiPreset.nativeWebSearch?.supports('gemini-3-flash')).toBe(true);
    expect(geminiPreset.nativeWebSearch?.supports('gemini-2.5-pro')).toBe(false);
  });
});

// ---- OpenRouter ----
describe('OpenRouter web search and image output', () => {
  const cfg: ProviderConfig = { id: 'openrouter', ...openrouterPreset.defaults };
  it('adds the server tool and image modalities when asked', () => {
    const b = buildChatBody(cfg, openrouterPreset, req({ webSearch: 'auto', imageOutput: true, tools: [{ name: 'echo', description: 'd', parameters: {} }] }));
    expect(b.tools.at(-1)).toEqual({ type: 'openrouter:web_search', parameters: { max_results: 5 } });
    expect(b.tools[0].function.name).toBe('echo');
    expect(b.modalities).toEqual(['image', 'text']);
    expect(buildChatBody(cfg, openrouterPreset, req()).modalities).toBeUndefined();
  });
  it('reads citations, images and search counts', () => {
    const seen = new Set<string>();
    const evs = openrouterExtras(
      {
        choices: [{ message: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://o.example/', title: 'O', content: 'body' } }], images: [{ image_url: { url: 'data:image/png;base64,AAAA' } }] } }],
        usage: { server_tool_use_details: { web_search_requests: 2 } }
      },
      seen
    );
    expect(evs).toEqual([
      { type: 'server-tool', id: 'openrouter-search', name: 'web_search', state: 'done' },
      { type: 'source', url: 'https://o.example/', title: 'O', snippet: 'body' },
      { type: 'image', data: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
      { type: 'usage', usage: { webSearches: 2 } }
    ]);
    // The same citation and image in a later chunk are not repeated
    expect(openrouterExtras({ choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://o.example/' } }], images: [{ image_url: { url: 'data:image/png;base64,AAAA' } }] } }] }, seen)).toEqual([]);
  });
  it('marks image-output and search-capable models', () => {
    const m = openrouterPreset.mapModel!({ id: 'g/img', architecture: { output_modalities: ['image', 'text'] }, supported_parameters: ['tools'] }, 'openrouter');
    expect(m?.capabilities).toMatchObject({ imageOutput: true, webSearch: true, tools: true });
    expect(openrouterPreset.mapModel!({ id: 'only/img', architecture: { output_modalities: ['image'] } }, 'openrouter')).toBeNull();
  });
});

// ---- Groq ----
describe('Groq browser search', () => {
  const cfg: ProviderConfig = { id: 'groq', ...groqPreset.defaults };
  it('adds browser_search only for gpt-oss models', () => {
    expect(buildChatBody(cfg, groqPreset, req({ model: 'openai/gpt-oss-120b', webSearch: 'auto' })).tools).toEqual([{ type: 'browser_search' }]);
    expect(buildChatBody(cfg, groqPreset, req({ model: 'llama-3.3-70b', webSearch: 'auto' })).tools).toBeUndefined();
    expect(groqPreset.nativeWebSearch?.supports('openai/gpt-oss-20b')).toBe(true);
    expect(groqPreset.mapModel!({ id: 'groq/compound' }, 'groq')).toBeNull();
  });
  it('reads sources from executed_tools', () => {
    const evs = groqExtras({ choices: [{ message: { executed_tools: [{ index: 0, type: 'browser_search', arguments: '{"query":"q"}', search_results: { results: [{ url: 'https://q.example/', title: 'Q' }] } }] } }] }, new Set());
    expect(evs).toEqual([
      { type: 'server-tool', id: 'groq-search-0', name: 'web_search', query: 'q', state: 'done', resultCount: 1 },
      { type: 'source', url: 'https://q.example/', title: 'Q' }
    ]);
  });
});

// ---- images in replies (runner) ----
describe('images in replies', () => {
  it('stores image events through saveImage and adds file parts', async () => {
    const saved: string[] = [];
    const out = await runAssistant({
      provider: { id: 'gemini', ...geminiPreset.defaults },
      preset: geminiPreset,
      auth: undefined,
      transport: once([{ candidates: [{ content: { parts: [{ text: 'どうぞ' }, { inlineData: { mimeType: 'image/png', data: 'iVBO' } }] }, finishReason: 'STOP' }] }]),
      model: 'gemini-2.5-flash-image',
      history: [{ id: 'u', conversationId: 'c', parentId: null, role: 'user', parts: [{ type: 'text', text: '猫の絵' }], createdAt: 0, status: 'done' }],
      systemPrompt: '',
      draft: { id: 'a', conversationId: 'c', parentId: 'u', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' } as MessageRecord,
      imageOutput: true,
      saveImage: async (data, mimeType) => {
        saved.push(data);
        return { type: 'file', blobId: 'b1', name: 'image-1.png', mimeType };
      },
      signal: new AbortController().signal,
      onUpdate() {},
      async persist() {}
    });
    expect(saved).toEqual(['iVBO']);
    expect(out.parts.find((p) => p.type === 'file')).toMatchObject({ blobId: 'b1' });
    expect(out.parts.find((p) => p.type === 'text')).toMatchObject({ text: 'どうぞ' });
  });
});
