import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildRequestMessages, runAssistant } from './runner';
import { deepestLatestLeaf, pathToLeaf, resolveLeaf } from './tree';
import type { MessageRecord } from '../db/schema';
import { venicePreset } from '../providers/presets/venice';
import type { ProviderConfig, Transport } from '../providers/types';
import { exportAll, importAll, validate } from '../db/export';
import { putConversation, putMessage, listMessages, listConversations, deleteConversation } from '../db/repo';
import { providerConfigOf } from '../keys/accounts';

function rec(id: string, parentId: string | null, role: 'user' | 'assistant', text: string, t: number, extra: Partial<MessageRecord> = {}): MessageRecord {
  return { id, conversationId: 'c', parentId, role, parts: [{ type: 'text', text }], createdAt: t, status: 'done', ...extra };
}

describe('tree', () => {
  const all = [rec('u1', null, 'user', 'a', 1), rec('a1', 'u1', 'assistant', 'b', 2), rec('a2', 'u1', 'assistant', 'b2', 3), rec('u2', 'a2', 'user', 'c', 4)];
  const byId = new Map(all.map((m) => [m.id, m]));
  it('path and leaves', () => {
    expect(pathToLeaf(byId, 'u2').map((m) => m.id)).toEqual(['u1', 'a2', 'u2']);
    expect(deepestLatestLeaf(all, 'u1')).toBe('u2');
    expect(deepestLatestLeaf(all, 'a1')).toBe('a1');
  });
  it('repairs a leaf that points at a message that was never written', () => {
    expect(resolveLeaf(all, 'u2')).toBe('u2');
    // closed right after switching to a new reply that was never saved
    expect(resolveLeaf(all, 'missing-reply')).toBe('u2');
    expect(resolveLeaf(all, null)).toBe('u2');
    expect(resolveLeaf([], 'x')).toBeNull();
  });
});

describe('applyEvent', () => {
  it('builds parts per block and applies usage and done', () => {
    const m = rec('x', null, 'assistant', '', 0, { parts: [], status: 'streaming' });
    const b = {};
    applyEvent(m, { type: 'reasoning-start', index: 0 }, b);
    applyEvent(m, { type: 'reasoning-delta', index: 0, delta: 'r' }, b);
    applyEvent(m, { type: 'reasoning-end', index: 0 }, b);
    applyEvent(m, { type: 'text-start', index: 1 }, b);
    applyEvent(m, { type: 'text-delta', index: 1, delta: 'hi' }, b);
    applyEvent(m, { type: 'usage', usage: { inputTokens: 3 }, costUsd: 0.1 }, b);
    applyEvent(m, { type: 'done', reason: 'stop' }, b);
    expect(m.parts).toEqual([
      { type: 'reasoning', text: 'r', state: 'done' },
      { type: 'text', text: 'hi', state: 'streaming' }
    ]);
    expect(m.status).toBe('done');
    expect(m.meta?.costUsd).toBe(0.1);
  });
});

describe('buildRequestMessages', () => {
  it('sends neither reasoning nor vendorState from past turns', () => {
    const h = [
      rec('u1', null, 'user', 'q', 1),
      { ...rec('a1', 'u1', 'assistant', 'ans', 2), parts: [{ type: 'reasoning' as const, text: 'think' }, { type: 'text' as const, text: 'ans' }], vendorState: { reasoning_content: 'think' }, meta: { providerId: 'p', model: 'other' } }
    ];
    const out = buildRequestMessages(h, 'sys');
    expect(out[0].role).toBe('system');
    expect(out[2].parts).toEqual([{ type: 'text', text: 'ans' }]);
    expect(out[2].vendorState).toBeUndefined();
  });
});

describe('runAssistant', () => {
  const cfg: ProviderConfig = { ...providerConfigOf('venice')!, id: 'p' };
  const enc = new TextEncoder();
  it('applies the stream to the end and saves it', async () => {
    const t: Transport = {
      async fetch() {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"や"}}]}\n\n'));
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"あ"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
            c.close();
          }
        });
        return new Response(body, { status: 200 });
      }
    };
    const draft = rec('a', 'u', 'assistant', '', 0, { parts: [], status: 'streaming' });
    let persisted = 0;
    const out = await runAssistant({
      provider: cfg,
      preset: venicePreset,
      auth: undefined,
      transport: t,
      model: 'm',
      history: [rec('u', null, 'user', 'hi', 0)],
      systemPrompt: '',
      draft,
      signal: new AbortController().signal,
      onUpdate() {},
      async persist() {
        persisted++;
      }
    });
    expect(out.parts).toEqual([{ type: 'text', text: 'やあ', state: 'done' }]);
    expect(out.status).toBe('done');
    expect(persisted).toBeGreaterThan(0);
  });
});

describe('repo + export', () => {
  it('temporary chats are not written to IndexedDB nor included in exports', async () => {
    const base = { title: 't', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off' as const, pinned: 0 as const, tags: [] };
    await putConversation({ id: 'perm', ...base });
    await putConversation({ id: 'temp', ...base, temporary: true });
    await putMessage({ ...rec('m1', null, 'user', 'x', 1), conversationId: 'temp' });
    await putMessage({ ...rec('m2', null, 'user', 'y', 1), conversationId: 'perm' });
    expect((await listConversations()).map((c) => c.id).sort()).toEqual(['perm', 'temp']);
    expect((await listMessages('temp')).length).toBe(1);
    const ex = await exportAll();
    expect(ex.conversations.map((c) => c.id)).toEqual(['perm']);
    await deleteConversation('perm');
    const r = await importAll(ex);
    expect(r.conversations).toBe(1);
    expect(r.messages).toBe(1);
  });
  it('rejects invalid files and drops dangerous parts', () => {
    expect(() => validate({ format: 'x' })).toThrow();
    const v = validate({
      format: 'nobackend-llm-client/export',
      version: 1,
      conversations: [{ id: 'c', title: 't', createdAt: 1, updatedAt: 1 }],
      messages: [{ id: 'm', conversationId: 'c', role: 'user', parts: [{ type: 'text', text: 'ok' }, { type: 'file', blobId: 'x' }] }],
      prompts: []
    });
    expect(v.messages[0].parts).toEqual([{ type: 'text', text: 'ok', state: 'done' }]);
  });
});

import { estimateTokens, fitToContext, inputBudget } from './context';
describe('context length management', () => {
  const msg = (role: 'system' | 'user' | 'assistant', text: string, id = Math.random().toString()) => ({ id, role, parts: [{ type: 'text' as const, text }] });
  it('estimates about 1 token per Japanese char and about 1 token per 4 ASCII chars', () => {
    expect(estimateTokens('あいう')).toBe(3);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
  it('drops nothing when within the limit', () => {
    const r = fitToContext([msg('user', 'こんにちは')], 1000);
    expect(r.dropped).toBe(0);
  });
  it('drops the oldest first, keeps system and the last message, and starts with a user message', () => {
    const long = 'あ'.repeat(400);
    const all = [msg('system', 'S'), msg('user', long, 'u1'), msg('assistant', long, 'a1'), msg('user', long, 'u2'), msg('assistant', long, 'a2'), msg('user', 'Q', 'u3')];
    const r = fitToContext(all, 900);
    expect(r.messages[0].role).toBe('system');
    expect(r.messages[1].role).toBe('user');
    expect(r.messages[r.messages.length - 1].id).toBe('u3');
    expect(r.dropped).toBeGreaterThan(0);
  });
  it('drops nothing when the context length is unknown', () => {
    expect(inputBudget(undefined)).toBeNull();
    expect(inputBudget(100000, 8192)).toBeLessThan(100000);
  });
});

import { searchMessages } from '../db/repo';
describe('full-text search', () => {
  it('returns conversations whose text matches, with surrounding context', async () => {
    const base = { title: '無関係なタイトル', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off' as const, pinned: 0 as const, tags: [] };
    await putConversation({ id: 'search-c', ...base });
    await putMessage({ ...rec('sm1', null, 'user', 'Rust の所有権について教えてください', 5), conversationId: 'search-c' });
    const hits = await searchMessages('所有権');
    const h = hits.find((x) => x.conversationId === 'search-c');
    expect(h?.snippet).toContain('所有権');
    expect(await searchMessages('存在しない語句xyz')).toEqual([]);
  });
});

import { buildTranscript, planCompaction } from './compact';
describe('compaction', () => {
  const path = () => {
    const out: MessageRecord[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 10; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const m = rec(`m${i}`, parent, role, `発言${i}`, i);
      out.push(m);
      parent = m.id;
    }
    return out;
  };
  it('keeps the last 4 messages and picks a range so the kept part starts with a user message', () => {
    const plan = planCompaction(path())!;
    expect(plan.toSummarize.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    expect(plan.coversUntilId).toBe('m5');
    expect(plan.previousSummary).toBeNull();
  });
  it('does not compact short conversations', () => {
    expect(planCompaction(path().slice(0, 4))).toBeNull();
  });
  it('replaces the summarized range with the summary when sending and does not send the compaction node itself', () => {
    const p = path();
    const node: MessageRecord = { ...rec('c1', 'm9', 'assistant', 'S', 20), role: 'system', compaction: { summary: '要約本文', coversUntilId: 'm5', count: 6 } };
    const after = rec('m10', 'c1', 'user', '続き', 21);
    const out = buildRequestMessages([...p, node, after], 'あなたは助手です');
    expect(out[0].role).toBe('system');
    expect((out[0].parts[0] as any).text).toContain('要約本文');
    expect((out[0].parts[0] as any).text).toContain('あなたは助手です');
    expect(out.slice(1).map((m) => m.id)).toEqual(['m6', 'm7', 'm8', 'm9', 'm10']);
  });
  it('a second compaction re-summarizes including the previous summary', () => {
    const p = path();
    const node: MessageRecord = { ...rec('c1', 'm9', 'assistant', 'S', 20), role: 'system', compaction: { summary: '前回の要約', coversUntilId: 'm5', count: 6 } };
    const more = [rec('m10', 'c1', 'user', 'a', 21), rec('m11', 'm10', 'assistant', 'b', 22), rec('m12', 'm11', 'user', 'c', 23), rec('m13', 'm12', 'assistant', 'd', 24)];
    const plan = planCompaction([...p, node, ...more])!;
    expect(plan.previousSummary).toBe('前回の要約');
    expect(plan.toSummarize[0].id).toBe('m6');
    expect(buildTranscript(plan)).toContain('前回の要約');
  });
});

describe('resending reasoning', () => {
  const h = [
    rec('u1', null, 'user', 'q', 1),
    { ...rec('a1', 'u1', 'assistant', 'ans', 2), vendorState: { reasoning_content: 'think' }, meta: { providerId: 'p', model: 'm' } }
  ];
  it('does not send by default (off)', () => {
    expect(buildRequestMessages(h, '', { providerId: 'p', model: 'm' })[1].vendorState).toBeUndefined();
  });
  it('when on, sends for the same model but not for a different one', () => {
    expect(buildRequestMessages(h, '', { resendReasoning: true, providerId: 'p', model: 'm' })[1].vendorState).toEqual({ reasoning_content: 'think' });
    expect(buildRequestMessages(h, '', { resendReasoning: true, providerId: 'p', model: 'other' })[1].vendorState).toBeUndefined();
  });
});

import type { Tool } from '../tools/types';
describe('tool execution loop', () => {
  const cfg: ProviderConfig = { ...providerConfigOf('venice')!, id: 'p' };
  const enc = new TextEncoder();
  const sseBody = (chunks: unknown[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        }
      }),
      { status: 200 }
    );
  const toolCall = (q: string) => [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c-' + q, function: { name: 'echo', arguments: JSON.stringify({ q }) } }] }, finish_reason: 'tool_calls' }] }];
  const answer = (t: string) => [{ choices: [{ delta: { content: t }, finish_reason: 'stop' }] }];
  const echo: Tool<{ q: string }> = {
    name: 'echo',
    label: 'echo',
    description: 'echo',
    parameters: { type: 'object' },
    risk: 'read',
    summarize: (i) => i.q,
    prepare: (raw: any) => ({ q: String(raw?.q ?? '') }),
    execute: async (i) => ({ content: `結果:${i.q}`, sources: [{ url: 'https://example.com/' + i.q, title: i.q }] })
  };
  const run = async (responses: unknown[][], opts: Partial<Parameters<typeof runAssistant>[0]> = {}) => {
    const bodies: any[] = [];
    let n = 0;
    const t: Transport = {
      async fetch(_u, init) {
        bodies.push(JSON.parse(String(init.body)));
        return sseBody(responses[Math.min(n++, responses.length - 1)]);
      }
    };
    const draft = rec('a', 'u', 'assistant', '', 0, { parts: [], status: 'streaming' });
    const out = await runAssistant({
      provider: cfg,
      preset: venicePreset,
      auth: undefined,
      transport: t,
      model: 'm',
      history: [rec('u', null, 'user', '調べて', 0)],
      systemPrompt: '',
      draft,
      signal: new AbortController().signal,
      onUpdate() {},
      async persist() {},
      tools: [echo],
      toolContext: { transport: t, authFor: () => undefined },
      permissionFor: () => 'allow',
      ...opts
    });
    return { out, bodies };
  };

  it('tool call → execute → final answer with the result (2 steps)', async () => {
    const { out, bodies } = await run([toolCall('猫'), answer('猫は可愛い[1]')]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].tools[0].function.name).toBe('echo');
    // The second request contains the assistant's tool_calls and the tool result
    const msgs = bodies[1].messages;
    expect(msgs.some((m: any) => m.role === 'assistant' && m.tool_calls?.[0]?.function?.name === 'echo')).toBe(true);
    expect(msgs.find((m: any) => m.role === 'tool').content).toBe('結果:猫');
    expect(out.status).toBe('done');
    expect(out.parts.some((p) => p.type === 'source' && p.url === 'https://example.com/猫')).toBe(true);
    expect(out.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('')).toBe('猫は可愛い[1]');
  });

  it('dynamicTools: adds tools from the next step based on the result of the previous step', async () => {
    const extra: Tool = { ...echo, name: 'extra', label: 'extra' };
    const { bodies } = await run([toolCall('a'), answer('ok')], {
      dynamicTools: (turn) => (turn.parts.some((p) => p.type === 'tool' && p.state === 'output-available') ? [extra] : [])
    });
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(['echo']);
    expect(bodies[1].tools.map((t: any) => t.function.name)).toEqual(['echo', 'extra']);
  });

  it('returns output-denied to the model and continues when approval is denied', async () => {
    const { out, bodies } = await run([toolCall('犬'), answer('検索できませんでした')], {
      permissionFor: () => 'ask',
      requestApproval: async () => ({ approved: false, reason: '不要' })
    });
    const tool = out.parts.find((p) => p.type === 'tool') as any;
    expect(tool.state).toBe('output-denied');
    expect(bodies[1].messages.find((m: any) => m.role === 'tool').content).toContain('拒否');
  });

  it('stops when the same call repeats', async () => {
    const { out, bodies } = await run([toolCall('同じ')]);
    expect(bodies.length).toBeLessThanOrEqual(3);
    const tools = out.parts.filter((p) => p.type === 'tool') as any[];
    expect(tools[tools.length - 1].error).toContain('繰り返され');
  });

  it('counts the same call again after a change, since reading or trying it again is then progress', async () => {
    const save: Tool<{ q: string }> = { ...echo, name: 'save', label: 'save', risk: 'write' };
    const saveCall = [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c-s', function: { name: 'save', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }] }];
    // check, save, check, save, check: the third check is not a repeat
    const { out } = await run([toolCall('同じ'), saveCall, toolCall('同じ'), saveCall, toolCall('同じ'), answer('ok')], { tools: [echo, save] });
    const tools = out.parts.filter((p) => p.type === 'tool') as any[];
    expect(tools).toHaveLength(5);
    expect(tools.every((p) => p.state === 'output-available')).toBe(true);
  });
});

import { makeFetchUrlTool, webSearchTool } from '../../features/web/tools';
describe('web tool argument validation', () => {
  it('rejects an empty query and clamps the count to 1–10', () => {
    expect(() => webSearchTool.prepare({ query: ' ' })).toThrow();
    expect(webSearchTool.prepare({ query: 'a', max_results: 99 }).max_results).toBe(10);
  });
  it('reads only plain https URLs, and only with a prompt', () => {
    const fetchUrl = makeFetchUrlTool(async () => ({ content: '' }));
    expect(() => fetchUrl.prepare({ url: 'file:///etc/passwd', prompt: 'x' })).toThrow();
    expect(() => fetchUrl.prepare({ url: 'http://example.com/', prompt: 'x' })).toThrow();
    expect(() => fetchUrl.prepare({ url: 'https://u:p@example.com/', prompt: 'x' })).toThrow();
    expect(() => fetchUrl.prepare({ url: 'https://example.com/a', prompt: ' ' })).toThrow();
    expect(fetchUrl.prepare({ url: 'https://example.com/a', prompt: 'the price' })).toEqual({ url: 'https://example.com/a', prompt: 'the price' });
    expect(fetchUrl.confirmsItself).toBe(true);
  });
});
