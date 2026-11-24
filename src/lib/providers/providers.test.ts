import { describe, expect, it } from 'vitest';
import { parseSSE } from './sse';
import { ThinkSplitter } from './think-splitter';
import { openAICompatibleAdapter, toOpenAIMessages } from './openai-compatible';
import { venicePreset } from './presets/venice';
import { plainTransport } from './transport';
import { classifyError } from './errors';
import type { ProviderConfig, ProviderEvent, Transport } from './types';

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
  it('チャンク境界で分割されたイベントと CRLF、コメントを扱う', async () => {
    const msgs = await collect(parseSSE(streamOf(['data: {"a"', ':1}\r\n\r\n: keep-alive\n\nda', 'ta: [DONE]\n\n'])));
    expect(msgs.map((m) => m.data)).toEqual(['{"a":1}', '[DONE]']);
  });
  it('マルチバイト文字が分割されても壊れない', async () => {
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
  it('末尾に空行がなくても最後の data を出す', async () => {
    const msgs = await collect(parseSSE(streamOf(['data: x'])));
    expect(msgs[0].data).toBe('x');
  });
});

describe('ThinkSplitter', () => {
  it('タグが分割されても思考と本文を分離する', () => {
    const s = new ThinkSplitter();
    const segs = [...s.push('<thi'), ...s.push('nk>考え'), ...s.push('中</th'), ...s.push('ink>答え'), ...s.flush()];
    const merged: Record<string, string> = { text: '', reasoning: '' };
    for (const g of segs) merged[g.kind] += g.text;
    expect(merged).toEqual({ text: '答え', reasoning: '考え中' });
  });
  it('タグに似た文字列は本文として残す', () => {
    const s = new ThinkSplitter();
    const segs = [...s.push('a < b <th'), ...s.push('e end'), ...s.flush()];
    expect(segs.map((x) => x.text).join('')).toBe('a < b <the end');
    expect(segs.every((x) => x.kind === 'text')).toBe(true);
  });
});

const cfg: ProviderConfig = { id: 'p1', ...venicePreset.defaults, baseUrl: 'https://api.venice.ai/api/v1' };
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
  it('reasoning_content → content → usage(choices 空) を正しくイベント化する', async () => {
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

  it('<think> タグ方式の思考も分離する', async () => {
    const t = fakeTransport([sse({ choices: [{ delta: { content: '<think>ふむ</think>' } }] }), sse({ choices: [{ delta: { content: '結論' }, finish_reason: 'stop' }] })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const r = evs.filter((e) => e.type === 'reasoning-delta').map((e: any) => e.delta).join('');
    const x = evs.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('');
    expect(r).toBe('ふむ');
    expect(x).toBe('結論');
  });

  it('ストリーム内エラーを error イベントにする', async () => {
    const t = fakeTransport([sse({ choices: [{ delta: { content: 'a' } }] }), sse({ error: { message: 'overloaded', retry_after: 3 } })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const last = evs[evs.length - 1] as any;
    expect(last.type).toBe('error');
    expect(last.error.retryAfterMs).toBe(3000);
  });

  it('tool_calls の断片を蓄積して tool-call-end で JSON にする', async () => {
    const t = fakeTransport([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"q":' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"猫"}' } }] }, finish_reason: 'tool_calls' }] })
    ]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const end = evs.find((e) => e.type === 'tool-call-end') as any;
    expect(end.input).toEqual({ q: '猫' });
    expect(evs[evs.length - 1]).toEqual({ type: 'done', reason: 'tool-calls' });
  });

  it('HTTP 402 を insufficient-balance に分類する', async () => {
    const t = fakeTransport(() => new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 402 }));
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    expect((evs[0] as any).error.kind).toBe('insufficient-balance');
  });

  it('Venice の引用を source イベントにする（重複除去）', async () => {
    const cit = { venice_parameters: { web_search_citations: [{ title: 'A', url: 'https://a.example/', content: 'x' }, { url: 'javascript:alert(1)' }] } };
    const t = fakeTransport([sse(cit), sse(cit), sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]);
    const evs = await collect(openAICompatibleAdapter.chat(cfg, venicePreset, cred, { model: 'm', messages: [], signal: new AbortController().signal }, t));
    const sources = evs.filter((e) => e.type === 'source');
    expect(sources).toHaveLength(1);
  });
});

describe('キーを付ける通信', () => {
  it('キー金庫を通さない通信（plainTransport）はキーの指定を拒否する', async () => {
    await expect(plainTransport.fetch('https://api.venice.ai/api/v1/chat/completions', { method: 'POST' }, { keyId: 'venice' })).rejects.toThrow();
  });
  it('Adapter はキーの値を扱わず、どのキーを付けるかだけを Transport に渡す', async () => {
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
  it('model_spec を ModelInfo に写像する', () => {
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
  it('ツール結果を tool メッセージに変換する', () => {
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
  it('PRO_ONLY_MODEL を model-unavailable に', () => {
    expect(classifyError(401, { error: { code: 'PRO_ONLY_MODEL' } }).kind).toBe('model-unavailable');
  });
  it('429 の retry-after を読む', () => {
    expect(classifyError(429, null, '5').retryAfterMs).toBe(5000);
  });
});

describe('プロンプトキャッシュ', () => {
  it('Venice にはキャッシュキーを送り、キャッシュに当たったトークン数を読む', async () => {
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
