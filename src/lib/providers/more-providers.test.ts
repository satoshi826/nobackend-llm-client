import { describe, expect, it } from 'vitest';
import { anthropicAdapter, buildAnthropicBody, toAnthropic } from './anthropic';
import { anthropicPreset, customPreset, deepseekPreset, geminiPreset, groqPreset } from './presets/more';
import { buildChatBody } from './openai-compatible';
import { appDirectOrigins, keyedProviderOrigins, parseCustomProviders } from './endpoints';
import { appCsp, vaultCsp } from '../../../csp.config';
import type { ChatMessage, ProviderConfig, ProviderEvent, Transport } from './types';
import { accountById, providerConfigOf } from '../keys/accounts';

const enc = new TextEncoder();
function sse(events: { event?: string; data: unknown }[]): Response {
  const text = events.map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`).join('');
  return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(text)), c.close()) }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const msg = (role: ChatMessage['role'], parts: ChatMessage['parts'], id: string = role): ChatMessage => ({ id, role, parts });

describe('Anthropic adapter', () => {
  it('converts system, tool calls and tool results to the Messages API shape', () => {
    const r = toAnthropic([
      msg('system', [{ type: 'text', text: 'be brief' }]),
      msg('user', [{ type: 'text', text: 'weather?' }]),
      msg('assistant', [
        { type: 'text', text: 'checking' },
        { type: 'tool', toolCallId: 't1', name: 'web_search', argsText: '{"query":"x"}', input: { query: 'x' }, state: 'output-available', modelOutput: 'sunny' }
      ]),
      msg('assistant', [{ type: 'tool', toolCallId: 't2', name: 'fetch_url', argsText: '', input: { url: 'u' }, state: 'output-denied', approval: { approved: false, auto: false } }], 'a2')
    ]);
    expect(r.system).toBe('be brief');
    expect(r.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'weather?' }] });
    expect(r.messages[1].content[1]).toEqual({ type: 'tool_use', id: 't1', name: 'web_search', input: { query: 'x' } });
    expect(r.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'sunny' });
    // Consecutive assistant / user messages are each merged into one
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(r.messages[4].content[0]).toMatchObject({ tool_use_id: 't2', is_error: true });
  });

  it('builds a request with max_tokens, cache breakpoints and tools', () => {
    const b = buildAnthropicBody({
      model: 'claude-x',
      messages: [msg('system', [{ type: 'text', text: 'sys' }]), msg('user', [{ type: 'text', text: 'hi' }])],
      tools: [{ name: 'echo', description: 'd', parameters: { type: 'object' } }],
      params: { temperature: 1.5 },
      signal: new AbortController().signal
    });
    expect(b.max_tokens).toBeGreaterThan(0);
    expect(b.temperature).toBe(1);
    expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(b.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(b.tools[0]).toEqual({ name: 'echo', description: 'd', input_schema: { type: 'object' } });
  });

  it('streams text, tool calls and usage', async () => {
    let sent: { url: string; init: RequestInit; auth?: unknown } | null = null;
    const t: Transport = {
      async fetch(url, init, auth) {
        sent = { url, init, auth };
        return sse([
          { data: { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 } } } },
          { data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
          { data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } },
          { data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } },
          { data: { type: 'content_block_stop', index: 0 } },
          { data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'echo', input: {} } } },
          { data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } } },
          { data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a"}' } } },
          { data: { type: 'content_block_stop', index: 1 } },
          { data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } } },
          { data: { type: 'message_stop' } }
        ]);
      }
    };
    const cfg: ProviderConfig = providerConfigOf('anthropic')!;
    const evs: ProviderEvent[] = [];
    for await (const ev of anthropicAdapter.chat(cfg, anthropicPreset, { keyId: 'anthropic' }, { model: 'm', messages: [msg('user', [{ type: 'text', text: 'x' }])], signal: new AbortController().signal }, t)) evs.push(ev);
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages');
    expect((sent!.init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(sent!.auth).toEqual({ keyId: 'anthropic' });
    expect(evs.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('')).toBe('Hello');
    expect(evs.find((e) => e.type === 'tool-call-end')).toMatchObject({ input: { q: 'a' } });
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 100, cachedInputTokens: 90, outputTokens: 20 } });
    expect(evs[evs.length - 1]).toEqual({ type: 'done', reason: 'tool-calls' });
  });

  it('sends the key as x-api-key', () => {
    expect(accountById('anthropic')!.keyHeader).toEqual({ name: 'x-api-key', prefix: '' });
    expect(anthropicPreset.modelsNeedKey).toBe(true);
  });
});

describe('OpenAI-compatible presets', () => {
  const withReasoning = [
    msg('user', [{ type: 'text', text: 'q' }]),
    { ...msg('assistant', [{ type: 'text', text: 'a' }]), vendorState: { reasoning_content: 'thought' } },
    { ...msg('assistant', [{ type: 'tool', toolCallId: 't', name: 'x', argsText: '{}', input: {}, state: 'output-available', modelOutput: 'r' }], 'a2'), vendorState: { reasoning_content: 'tool thought' } }
  ];
  const req = { model: 'm', messages: withReasoning, signal: new AbortController().signal };
  it('DeepSeek keeps reasoning only for tool-call turns; Groq never resends it', () => {
    const ds = buildChatBody(deepseekPreset, req).messages;
    expect(ds[1].reasoning_content).toBeUndefined();
    expect(ds[2].reasoning_content).toBe('tool thought');
    expect(buildChatBody(groqPreset, req).messages.some((m: any) => 'reasoning_content' in m)).toBe(false);
  });
  it('map only chat models', () => {
    expect(geminiPreset.mapModel!({ id: 'models/gemini-2.5-flash' }, 'gemini')?.id).toBe('gemini-2.5-flash');
    expect(geminiPreset.mapModel!({ id: 'models/text-embedding-004' }, 'gemini')).toBeNull();
    expect(groqPreset.mapModel!({ id: 'whisper-large-v3' }, 'groq')).toBeNull();
    expect(groqPreset.mapModel!({ id: 'llama-3.3-70b-versatile', context_window: 131072 }, 'groq')?.contextLength).toBe(131072);
  });
});

describe('build-time custom providers', () => {
  const json = JSON.stringify([{ id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1/', keyOptional: true }, { id: 'lab', baseUrl: 'https://llm.example.com/v1' }]);
  it('parses and validates', () => {
    const list = parseCustomProviders(json);
    expect(list).toEqual([
      { id: 'ollama', label: 'Ollama', name: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', keyOptional: true, publicModels: true },
      { id: 'lab', label: 'lab', name: 'lab', kind: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', keyOptional: false, publicModels: false, keyCheck: 'models' }
    ]);
    expect(() => parseCustomProviders('[{"id":"venice","baseUrl":"https://x"}]')).toThrow();
    expect(() => parseCustomProviders('[{"id":"x","baseUrl":"http://evil.example.com"}]')).toThrow();
    expect(() => parseCustomProviders('[{"id":"x","baseUrl":"https://u:p@x.example.com"}]')).toThrow();
    expect(() => parseCustomProviders('not json')).toThrow();
  });
  it('flows into the CSP of the app and the vault', () => {
    const env = { VITE_CUSTOM_PROVIDERS: json };
    expect(appDirectOrigins(env)).toContain('http://localhost:11434');
    expect(appDirectOrigins(env)).not.toContain('https://llm.example.com');
    expect(keyedProviderOrigins(env)).toEqual(expect.arrayContaining(['https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://llm.example.com', 'http://localhost:11434']));
    expect(appCsp(env)).toContain('http://localhost:11434');
    expect(appCsp(env)).not.toContain('api.anthropic.com');
    expect(vaultCsp(env, ["'self'"])).toContain('https://api.groq.com');
  });
  it('makes a key-optional preset, whose key is not checked', () => {
    const [ollama, lab] = parseCustomProviders(json);
    expect(customPreset(ollama).modelsNeedKey).toBe(false);
    expect(customPreset(lab).modelsNeedKey).toBe(true);
    expect(ollama.keyCheck).toBeUndefined();
  });
});

describe('provider order', () => {
  it('lists providers alphabetically by label', async () => {
    const { PRESET_ORDER, PRESETS } = await import('./registry');
    const labels = PRESET_ORDER.map((id) => PRESETS[id].label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(PRESET_ORDER[0]).toBe('anthropic');
  });
});
