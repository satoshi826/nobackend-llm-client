import { describe, expect, it } from 'vitest';
import { afterCompaction, buildRequestMessages, joinedText, registerMessageTransform, requestMessage, turnMessages } from './request';
import type { MessageRecord } from '../db/schema';
import type { Part } from '../providers/types';

function rec(id: string, role: MessageRecord['role'], parts: Part[], extra: Partial<MessageRecord> = {}): MessageRecord {
  return { id, conversationId: 'c', parentId: null, role, parts, createdAt: 0, status: 'done', ...extra };
}
const text = (t: string): Part => ({ type: 'text', text: t });
const compaction = (id: string, coversUntilId: string, summary: string) => rec(id, 'system', [text(summary)], { compaction: { summary, coversUntilId, count: 2 } });

describe('afterCompaction', () => {
  it('uses the last compaction on the path and keeps what comes after the range it covers', () => {
    const path = [rec('u1', 'user', [text('a')]), rec('a1', 'assistant', [text('b')]), compaction('k1', 'a1', 'first'), rec('u2', 'user', [text('c')]), rec('a2', 'assistant', [text('d')]), compaction('k2', 'a2', 'second'), rec('u3', 'user', [text('e')])];
    const { summary, rest } = afterCompaction(path);
    expect(summary).toBe('second');
    expect(rest.map((m) => m.id)).toEqual(['k2', 'u3']);
  });

  it('keeps everything when there is no compaction', () => {
    const path = [rec('u1', 'user', [text('a')])];
    expect(afterCompaction(path)).toEqual({ summary: null, rest: path });
  });
});

describe('buildRequestMessages with a summary', () => {
  it('appends the summary to the system prompt and drops what it covers', () => {
    const path = [rec('u1', 'user', [text('old')]), rec('a1', 'assistant', [text('old answer')]), compaction('k', 'a1', 'SUMMARY'), rec('u2', 'user', [text('new')])];
    const out = buildRequestMessages(path, '  Be brief.  ');
    expect(out.map((m) => m.role)).toEqual(['system', 'user']);
    const sys = (out[0].parts[0] as { text: string }).text;
    expect(sys.startsWith('Be brief.\n\n')).toBe(true);
    expect(sys).toContain('SUMMARY');
    expect(out[1].id).toBe('u2');
  });

  it('makes the summary the whole system prompt when there is none, and sends no system message otherwise', () => {
    const path = [rec('u1', 'user', [text('a')]), rec('a1', 'assistant', [text('b')]), compaction('k', 'a1', 'S'), rec('u2', 'user', [text('c')])];
    const out = buildRequestMessages(path, '   ');
    expect((out[0].parts[0] as { text: string }).text).toContain('S');
    expect(buildRequestMessages([rec('u1', 'user', [text('a')])], ' ').map((m) => m.role)).toEqual(['user']);
  });
});

describe('requestMessage', () => {
  it('sends only text and tool parts', () => {
    const tool: Part = { type: 'tool', toolCallId: 't', name: 'x', argsText: '{}', state: 'output-available', modelOutput: 'ok' };
    const m = rec('a', 'assistant', [{ type: 'reasoning', text: 'r' }, text('hi'), tool, { type: 'source', url: 'https://x.example' }, { type: 'file', fileId: 'b', name: 'i.png', mimeType: 'image/png' }]);
    expect(requestMessage(m)?.parts).toEqual([text('hi'), tool]);
  });

  it('sends nothing for compaction nodes, reasoning-only answers and failed answers without text', () => {
    expect(requestMessage(compaction('k', 'x', 's'))).toBeNull();
    expect(requestMessage(rec('a', 'assistant', [{ type: 'reasoning', text: 'r' }]))).toBeNull();
    expect(requestMessage(rec('a', 'assistant', [text('')], { status: 'error' }))).toBeNull();
    expect(requestMessage(rec('a', 'assistant', [text('partial')], { status: 'error' }))?.parts).toEqual([text('partial')]);
  });

  it('sends vendor state back only when asked and only for the same provider and model', () => {
    const m = rec('a', 'assistant', [text('x')], { vendorState: { reasoning_content: 'r' }, meta: { providerId: 'p', model: 'm' } });
    expect(requestMessage(m, { resendReasoning: true, providerId: 'p', model: 'm' })?.vendorState).toEqual({ reasoning_content: 'r' });
    expect(requestMessage(m, { resendReasoning: true, providerId: 'q', model: 'm' })?.vendorState).toBeUndefined();
    expect(requestMessage(m, { resendReasoning: false, providerId: 'p', model: 'm' })?.vendorState).toBeUndefined();
    expect(requestMessage(m, { resendReasoning: true })?.vendorState).toBeUndefined();
  });

  it('runs registered transforms once each, in registration order, and drops a message they empty', () => {
    const calls: string[] = [];
    const first = (m: MessageRecord, parts: Part[]) => {
      calls.push('first');
      return m.id === 'drop' ? [] : [text(`[${joinedText(parts)}]`)];
    };
    const second = (_m: MessageRecord, parts: Part[]) => {
      calls.push('second');
      return parts.map((p) => (p.type === 'text' ? { ...p, text: p.text + '!' } : p));
    };
    registerMessageTransform(first);
    registerMessageTransform(second);
    registerMessageTransform(first);
    expect(requestMessage(rec('u', 'user', [text('a'), text('b')]))?.parts).toEqual([text('[ab]!')]);
    expect(calls).toEqual(['first', 'second']);
    expect(requestMessage(rec('drop', 'user', [text('a')]))).toBeNull();
  });
});

describe('turnMessages', () => {
  it('turns each step with a tool call into an assistant message, carrying that step’s reasoning and raw content', () => {
    const tool = (id: string): Part => ({ type: 'tool', toolCallId: id, name: 'x', argsText: '{}', state: 'output-available', modelOutput: 'r' });
    const raw: Part = { type: 'provider-content', provider: 'anthropic', content: [{ type: 'text' }] };
    const msg = rec('a', 'assistant', [
      { type: 'step-start' },
      { type: 'reasoning', text: 'think ' },
      { type: 'reasoning', text: 'more' },
      text('looking'),
      tool('t1'),
      { type: 'step-start' },
      raw,
      tool('t2'),
      { type: 'step-start' },
      text('final answer')
    ]);
    const out = turnMessages(msg);
    expect(out).toEqual([
      { id: 'a-s0', role: 'assistant', parts: [text('looking'), tool('t1')], vendorState: { reasoning_content: 'think more' } },
      { id: 'a-s1', role: 'assistant', parts: [tool('t2')], vendorState: { providerContent: raw } }
    ]);
  });

  it('returns nothing for a turn without tool calls', () => {
    expect(turnMessages(rec('a', 'assistant', [{ type: 'step-start' }, text('hi')]))).toEqual([]);
  });
});
