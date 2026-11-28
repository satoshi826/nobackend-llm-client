import { describe, expect, it } from 'vitest';
import { PRESETS } from './registry';
import { parseSSE } from './sse';
import { ThinkSplitter } from './think-splitter';
import { openAICompatibleAdapter, toOpenAIMessages } from './openai-compatible';
import { flexTier } from './presets/define';
import { estimateCost } from '../usage';
import { venicePreset } from './presets/venice';
import { plainTransport } from './transport';
import { classifyError } from './errors';
import type { ProviderConfig, ProviderEvent, Transport } from './types';
import { providerConfigOf } from '../keys/accounts';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    }
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('parseSSE', () => {
  it('handles events split across chunk boundaries, CRLF and comments', async () => {
    const msgs = await collect(parseSSE(streamOf(['data: {"a"', ':1}\r\n\r\n: keep-alive\n\nda', 'ta: [DONE]\n\n'])));
    expect(msgs.map((m) => m.data)).toEqual(['{"a":1}', '[DONE]']);
  });
  it('does not break multibyte characters that are split', async () => {
    const bytes = new TextEncoder().encode('data: こんにちは\n\n');
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8));
        c.close();
      }
    });
    const msgs = await collect(parseSSE(s));
    expect(msgs[0].data).toBe('こんにちは');
  });
  it('emits the last data even without a trailing blank line', async () => {
    const msgs = await collect(parseSSE(streamOf(['data: x'])));
    expect(msgs[0].data).toBe('x');
  });
  it('reads event and id fields and joins multi-line data with newlines', async () => {
    const msgs = await collect(parseSSE(streamOf(['event: delta\nid: 7\ndata: a\ndata:b\n\nevent: ping\n\ndata: c\n\n'])));
    expect(msgs).toEqual([
      { event: 'delta', data: 'a\nb', id: '7' },
      { event: undefined, data: 'c', id: '7' }
    ]);
  });
  it('accepts bare CR line endings, and a CR at the end of a chunk followed by LF counts as one break', async () => {
    expect((await collect(parseSSE(streamOf(['data: a\r\rdata: b\r\r'])))).map((m) => m.data)).toEqual(['a', 'b']);
    expect((await collect(parseSSE(streamOf(['data: a\r', '\ndata: b\r\n\r\n'])))).map((m) => m.data)).toEqual(['a\nb']);
  });
});

describe('ThinkSplitter', () => {
  it('separates reasoning and text even when tags are split', () => {
    const s = new ThinkSplitter();
    const segs = [...s.push('<thi'), ...s.push('nk>考え'), ...s.push('中</th'), ...s.push('ink>答え'), ...s.flush()];
    const merged: Record<string, string> = { text: '', reasoning: '' };
    for (const g of segs) merged[g.kind] += g.text;
    expect(merged).toEqual({ text: '答え', reasoning: '考え中' });
  });
  it('keeps tag-like strings as text', () => {
    const s = new ThinkSplitter();
    const segs = [...s.push('a < b <th'), ...s.push('e end'), ...s.flush()];
    expect(segs.map((x) => x.text).join('')).toBe('a < b <the end');
    expect(segs.every((x) => x.kind === 'text')).toBe(true);
  });
  it('flushes an unclosed block as reasoning and a held-back partial tag as text', () => {
    const open = new ThinkSplitter();
    expect([...open.push('<think>still thinking'), ...open.flush()]).toEqual([{ kind: 'reasoning', text: 'still thinking' }]);
    const partial = new ThinkSplitter();
    expect(partial.push('answer <thi')).toEqual([{ kind: 'text', text: 'answer ' }]);
    expect(partial.flush()).toEqual([{ kind: 'text', text: '<thi' }]);
  });
  it('handles several blocks in one chunk', () => {
    const s = new ThinkSplitter();
    expect(s.push('a<think>r1</think>b<think>r2</think>c')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'reasoning', text: 'r1' },
      { kind: 'text', text: 'b' },
      { kind: 'reasoning', text: 'r2' },
      { kind: 'text', text: 'c' }
    ]);
  });
});

const cfg: ProviderConfig = { ...providerConfigOf('venice')!, id: 'p1', baseUrl: 'https://api.venice.ai/api/v1' };
const cred = { keyId: 'venice' };

function fakeTransport(body: string[] | (() => Response), capture?: { url?: string; init?: RequestInit }): Transport {
  return {
    async fetch(url, init) {
      if (capture) {
        capture.url = url;
        capture.init = init;
      }
      if (typeof body === 'function') return body();
      return new Response(streamOf(body), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
  };
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe('openAICompatibleAdapter.chat', () => {
  it('turns reasoning_content → content → usage (empty choices) into the right events', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const t = fakeTransport(
      [
        sse({ choices: [{ delta: { reasoning_content: '考え' } }] }),
        sse({ choices: [{ delta: { reasoning_content: '中' } }] }),
        sse({ choices: [{ delta: { content: 'こん' } }] }),
        sse({ choices: [{ delta: { content: 'にちは' }, finish_reason: 'stop' }] }),
        sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 }, cost: { usd: 0.0012 } }),
        'data: [DONE]\n\n'
      ],
      capture
    );
    const ctrl = new AbortController();
    const evs = await collect(
      openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }], signal: ctrl.signal }, t)
    );
    const types = evs.map((e) => e.type);
    expect(types).toEqual(['start', 'reasoning-start', 'reasoning-delta', 'reasoning-delta', 'reasoning-end', 'text-start', 'text-delta', 'text-delta', 'usage', 'text-end', 'vendor-state', 'done']);
    const usage = evs.find((e) => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>;
    expect(usage.costUsd).toBe(0.0012);
    const body = JSON.parse(String(capture.init!.body));
    expect(body.venice_parameters.include_venice_system_prompt).toBe(false);
    expect(body.stream).toBe(true);
    expect(capture.url).toBe('https://api.venice.ai/api/v1/chat/completions');
  });

  it('also separates <think>-tag reasoning', async () => {
    const t = fakeTransport([sse({ choices: [{ delta: { content: '<think>ふむ</think>' } }] }), sse({ choices: [{ delta: { content: '結論' }, finish_reason: 'stop' }] })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const r = evs.filter((e) => e.type === 'reasoning-delta').map((e: any) => e.delta).join('');
    const x = evs.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('');
    expect(r).toBe('ふむ');
    expect(x).toBe('結論');
  });

  it('turns in-stream errors into error events', async () => {
    const t = fakeTransport([sse({ choices: [{ delta: { content: 'a' } }] }), sse({ error: { message: 'overloaded', retry_after: 3 } })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const last = evs[evs.length - 1] as any;
    expect(last.type).toBe('error');
    expect(last.error.retryAfterMs).toBe(3000);
  });

  it('accumulates tool_calls fragments and parses JSON at tool-call-end', async () => {
    const t = fakeTransport([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"q":' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"猫"}' } }] }, finish_reason: 'tool_calls' }] })
    ]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const end = evs.find((e) => e.type === 'tool-call-end') as any;
    expect(end.input).toEqual({ q: '猫' });
    expect(evs[evs.length - 1]).toEqual({ type: 'done', reason: 'tool-calls' });
  });

  it('classifies HTTP 402 as insufficient-balance', async () => {
    const t = fakeTransport(() => new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 402 }));
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    expect((evs[0] as any).error.kind).toBe('insufficient-balance');
  });

  it('turns Venice citations into source events (deduplicated)', async () => {
    const cit = { venice_parameters: { web_search_citations: [{ title: 'A', url: 'https://a.example/', content: 'x' }, { url: 'javascript:alert(1)' }] } };
    const t = fakeTransport([sse(cit), sse(cit), sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const sources = evs.filter((e) => e.type === 'source');
    expect(sources).toHaveLength(1);
  });
});

describe('requests with keys', () => {
  it('requests not going through the key vault (plainTransport) reject a key reference', async () => {
    await expect(plainTransport.fetch('https://api.venice.ai/api/v1/chat/completions', { method: 'POST' }, { keyId: 'venice' })).rejects.toThrow();
  });
  it('the Adapter never handles key values and only tells the Transport which key to attach', async () => {
    let seen: unknown;
    const t: Transport = {
      async fetch(_url, _init, auth) {
        seen = auth;
        return new Response(streamOf([sse({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] })]), { status: 200 });
      }
    };
    await collect(openAICompatibleAdapter.chat(cfg, venicePreset, { keyId: 'venice' }, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    expect(seen).toEqual({ keyId: 'venice' });
  });
});

describe('Venice mapModel', () => {
  it('maps model_spec to ModelInfo', () => {
    const m = venicePreset.mapModel!(
      {
        id: 'venice-uncensored',
        model_spec: {
          name: 'Venice Uncensored',
          availableContextTokens: 128000,
          privacy: 'private',
          traits: ['most_uncensored'],
          pricing: { input: { usd: 0.2 }, output: { usd: 0.9 } },
          capabilities: { supportsFunctionCalling: true, supportsVision: false, supportsWebSearch: true }
        }
      },
      'p1'
    )!;
    expect(m.privacy).toBe('private');
    expect(m.capabilities.tools).toBe(true);
    expect(m.pricing?.outputPerMTok).toBe(0.9);
  });
});

describe('toOpenAIMessages', () => {
  it('converts tool results into tool messages', () => {
    const out = toOpenAIMessages([
      {
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'tool', toolCallId: 'c1', name: 'x', argsText: '{}', state: 'output-available', modelOutput: 'R' }]
      }
    ]);
    expect(out[0].tool_calls[0].id).toBe('c1');
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'R' });
  });
});

describe('classifyError', () => {
  it('maps PRO_ONLY_MODEL to model-unavailable', () => {
    expect(classifyError(401, { error: { code: 'PRO_ONLY_MODEL' } }).kind).toBe('model-unavailable');
  });
  it('reads retry-after on 429', () => {
    expect(classifyError(429, null, '5').retryAfterMs).toBe(5000);
  });
});

describe('prompt cache', () => {
  it('sends a cache key to Venice and reads the cached token count', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const t = fakeTransport(
      [sse({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }), sse({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 80 } } })],
      capture
    );
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], cacheKey: 'conv-1', signal: new AbortController().signal }, t));
    expect(JSON.parse(String(capture.init!.body)).prompt_cache_key).toBe('conv-1');
    expect((evs.find((e) => e.type === 'usage') as any).usage.cachedInputTokens).toBe(80);
  });
});

describe('balance APIs', () => {
  // Response shapes from each provider's docs (2026-11-26)
  it('read the USD balance, or this key’s limit left on OpenRouter', () => {
    expect(PRESETS.venice.balanceApi!.read({ data: { balances: { USD: 12.5, DIEM: 3 } } })).toBe(12.5);
    expect(PRESETS.openrouter.balanceApi!.read({ data: { limit: 10, limit_remaining: 7.25 } })).toBe(7.25);
    expect(PRESETS.openrouter.balanceApi!.read({ data: { limit: null, limit_remaining: null } })).toBeUndefined();
    expect(PRESETS.deepseek.balanceApi!.read({ balance_infos: [{ currency: 'CNY', total_balance: '50' }, { currency: 'USD', total_balance: '4.20' }] })).toBe(4.2);
    expect(PRESETS.deepseek.balanceApi!.read({ balance_infos: [{ currency: 'CNY', total_balance: '50' }] })).toBeUndefined();
    expect(PRESETS.nanogpt.balanceApi!.read({ usd_balance: '1.75', nano_balance: '9' })).toBe(1.75);
  });
});

describe('flex tier', () => {
  const flexPreset = { ...venicePreset, id: 'flexy', transformRequest: undefined, ...flexTier(0.5) };
  const flexCfg: ProviderConfig = { ...cfg, preset: 'flexy' };
  const ask = (t: Transport, flex: boolean) =>
    collect(
      openAICompatibleAdapter.chat(
        flexCfg,
        flexPreset,
        cred,
        {
          model: 'm',
          messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
          providerOptions: { flexy: flexPreset.requestOptions!({ purpose: 'chat', webSearch: 'off', settings: { flex: flex } }) ?? {} },
          signal: new AbortController().signal
        },
        t
      )
    );
  const answer = (tier: string) => [
    sse({ service_tier: tier, choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }),
    sse({ service_tier: tier, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    'data: [DONE]\n\n'
  ];

  it('asks for flex only when the setting is on, and prices an answer flex served at its share', async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async fetch(_url, init) {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(streamOf(answer('flex')), { status: 200 });
      }
    };
    const evs = await ask(t, true);
    expect(bodies[0].service_tier).toBe('flex');
    const usage = evs.find((e) => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>;
    expect(usage.usage.priceFactor).toBe(0.5);
    expect(estimateCost(usage.usage, { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' })).toBeCloseTo((10 * 1 + 5 * 2) / 2 / 1e6);
    await ask(t, false);
    expect(bodies[1].service_tier).toBeUndefined();
  });

  it('sends a request flex refuses again in the standard tier, priced in full', async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async fetch(_url, init) {
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1
          ? new Response(JSON.stringify({ error: { message: 'Resource unavailable' } }), { status: 429 })
          : new Response(streamOf(answer('default')), { status: 200 });
      }
    };
    const evs = await ask(t, true);
    expect(bodies.map((b) => b.service_tier)).toEqual(['flex', undefined]);
    expect(evs.some((e) => e.type === 'error')).toBe(false);
    const usage = evs.find((e) => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>;
    expect(usage.usage.priceFactor).toBeUndefined();
  });
});
