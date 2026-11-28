import { describe, expect, it } from 'vitest';
import { buildTranscript, estimateRequest, planCompaction, summarize, summaryInstruction, type CompactionPlan } from './compact';
import { estimateTokens } from './context';
import type { MessageRecord } from '../db/schema';
import type { Part, ProviderConfig, Transport } from '../providers/types';
import { venicePreset } from '../providers/presets/venice';
import { t as tp } from '../providers/messages';
import { providerConfigOf } from '../keys/accounts';

function rec(id: string, role: MessageRecord['role'], parts: Part[], extra: Partial<MessageRecord> = {}): MessageRecord {
  return { id, conversationId: 'c', parentId: null, role, parts, createdAt: 0, status: 'done', ...extra };
}
const text = (t: string): Part => ({ type: 'text', text: t });

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
function streamTransport(chunks: string[], capture: { body?: any } = {}): Transport {
  const enc = new TextEncoder();
  return {
    async fetch(_url, init) {
      capture.body = JSON.parse(String(init.body));
      return new Response(
        new ReadableStream({
          start(c) {
            for (const ch of chunks) c.enqueue(enc.encode(ch));
            c.close();
          }
        }),
        { status: 200 }
      );
    }
  };
}
const cfg: ProviderConfig = providerConfigOf('venice')!;
const opts = (transport: Transport, extra: object = {}) => ({ provider: cfg, preset: venicePreset, auth: undefined, transport, model: 'm', signal: new AbortController().signal, ...extra });

describe('planCompaction', () => {
  it('ignores messages without text, and does not compact when the kept part could not start with a user message', () => {
    const path = [
      rec('u1', 'user', [text('a')]),
      rec('a1', 'assistant', [{ type: 'reasoning', text: 'only reasoning' }]),
      rec('a2', 'assistant', [text('b')]),
      rec('a3', 'assistant', [text('c')]),
      rec('a4', 'assistant', [text('d')]),
      rec('a5', 'assistant', [text('e')])
    ];
    // candidates: u1 a2 a3 a4 a5; the cut walks back to u1 at index 0
    expect(planCompaction(path)).toBeNull();
  });

  it('honours a different number of kept messages', () => {
    const path = ['u1', 'a1', 'u2', 'a2'].map((id) => rec(id, id[0] === 'u' ? 'user' : 'assistant', [text(id)]));
    const plan = planCompaction(path, 2)!;
    expect(plan.toSummarize.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(plan).toMatchObject({ kept: 2, coversUntilId: 'a1', previousSummary: null });
  });
});

describe('buildTranscript', () => {
  const plan = (lines: string[], previousSummary: string | null = null): CompactionPlan => ({
    previousSummary,
    toSummarize: lines.map((t, i) => rec(`m${i}`, i % 2 ? 'assistant' : 'user', [text(t)])),
    kept: 2,
    coversUntilId: `m${lines.length - 1}`,
    parentId: null
  });

  it('labels each speaker and leaves the transcript whole when it fits', () => {
    const out = buildTranscript(plan(['question', 'answer']), 10_000);
    expect(out).toContain('question');
    expect(out).toContain('answer');
    expect(out).not.toContain('left out');
  });

  it('drops the oldest messages first when the transcript is over the limit, and says so', () => {
    const lines = ['oldest '.repeat(40), 'middle '.repeat(40), 'newest '.repeat(40)];
    const out = buildTranscript(plan(lines), 100);
    expect(out).toContain('left out');
    expect(out).not.toContain('oldest');
    expect(out).toContain('newest');
  });

  it('keeps at least the newest message even when it alone is over the limit', () => {
    const out = buildTranscript(plan(['a '.repeat(500), 'b '.repeat(500)]), 10);
    expect(out).toContain('b b');
    expect(out).not.toContain('a a');
  });

  it('puts the previous summary first when there is one', () => {
    const out = buildTranscript(plan(['q', 'a'], 'EARLIER'));
    expect(out.indexOf('EARLIER')).toBeLessThan(out.indexOf('q'));
  });
});

describe('estimateRequest', () => {
  it('splits the estimate by where the tokens come from, counting only what is sent after the summary', () => {
    const tool: Part = { type: 'tool', toolCallId: 't', name: 'x', argsText: '{"q":"abcd"}', state: 'output-available', modelOutput: 'result text' };
    const path = [
      rec('u1', 'user', [text('summarized away')]),
      rec('a1', 'assistant', [text('also away')]),
      rec('k', 'system', [text('S')], { compaction: { summary: 'the summary', coversUntilId: 'a1', count: 2 } }),
      rec('u2', 'user', [text('hello')]),
      rec('a2', 'assistant', [{ type: 'reasoning', text: 'not sent' }]),
      rec('a3', 'assistant', [text('done'), tool])
    ];
    const e = estimateRequest(path, 'instructions', 'notes');
    expect(e.count).toBe(2);
    expect(e.summary).toBe(estimateTokens('the summary'));
    expect(e.instructions).toBe(estimateTokens('instructions'));
    expect(e.notes).toBe(estimateTokens('notes'));
    expect(e.messages).toBe(estimateTokens('hello') + 4 + estimateTokens('done') + 4);
    expect(e.tools).toBe(estimateTokens('{"q":"abcd"}') + estimateTokens('result text'));
    expect(e.attachments).toBe(0);
    expect(e.total).toBe(e.instructions + e.notes + e.summary + e.messages + e.attachments + e.tools);
  });
});

describe('summarize', () => {
  const plan: CompactionPlan = { previousSummary: null, toSummarize: [rec('u', 'user', [text('what is 2+2')]), rec('a', 'assistant', [text('4')])], kept: 4, coversUntilId: 'a', parentId: null };

  it('asks with the summary instruction, keeps only the text of the reply, and reports usage', async () => {
    const capture: { body?: any } = {};
    const t = streamTransport(
      [
        sse({ choices: [{ delta: { reasoning_content: 'thinking' } }] }),
        sse({ choices: [{ delta: { content: '  Two plus ' } }] }),
        sse({ choices: [{ delta: { content: 'two.  ' }, finish_reason: 'stop' }] }),
        sse({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
        'data: [DONE]\n\n'
      ],
      capture
    );
    const usage: unknown[] = [];
    const out = await summarize(plan, opts(t, { onUsage: (u: unknown) => usage.push(u) }));
    expect(out).toBe('Two plus two.');
    expect(usage).toEqual([expect.objectContaining({ inputTokens: 7, outputTokens: 3 })]);
    expect(capture.body.messages[0]).toMatchObject({ role: 'system', content: summaryInstruction() });
    expect(capture.body.messages[1].content).toContain('what is 2+2');
    expect(capture.body).toMatchObject({ max_completion_tokens: 4096, temperature: 0.2 });
  });

  it('fails on an empty summary and on a provider error', async () => {
    await expect(summarize(plan, opts(streamTransport([sse({ choices: [{ delta: { content: '   ' }, finish_reason: 'stop' }] })])))).rejects.toThrow();
    await expect(summarize(plan, opts(streamTransport([sse({ error: { message: 'overloaded' } })])))).rejects.toThrow(tp('error.overloaded'));
  });
});
