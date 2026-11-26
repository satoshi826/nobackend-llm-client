import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToContext, inputBudget, messageTokens } from './context';
import type { ChatMessage, Part } from '../providers/types';

const m = (id: string, role: ChatMessage['role'], parts: Part[]): ChatMessage => ({ id, role, parts });
const text = (t: string): Part => ({ type: 'text', text: t });

describe('inputBudget', () => {
  it('is unknown without a context length', () => {
    expect(inputBudget(undefined)).toBeNull();
    expect(inputBudget(0)).toBeNull();
    expect(inputBudget(-5)).toBeNull();
  });

  it('reserves room for the output (at most 30% of the context) and keeps a 10% margin', () => {
    expect(inputBudget(100_000)).toBe(Math.floor((100_000 - 8192) * 0.9));
    expect(inputBudget(100_000, 1000)).toBe(Math.floor(99_000 * 0.9));
    expect(inputBudget(10_000, 50_000)).toBe(Math.floor(7000 * 0.9));
  });
});

describe('messageTokens', () => {
  it('counts text, tool arguments and tool results, plus a fixed overhead', () => {
    const tool: Part = { type: 'tool', toolCallId: 't', name: 'x', argsText: 'abcd', state: 'output-available', modelOutput: { ok: true } };
    expect(messageTokens(m('a', 'assistant', [text('abcdefgh'), tool, { type: 'reasoning', text: 'ignored' }]))).toBe(4 + 2 + 1 + estimateTokens(JSON.stringify({ ok: true })));
  });
});

describe('fitToContext', () => {
  it('drops assistant and tool turns that would lead the history, so it starts with a user message', () => {
    const long = 'x'.repeat(400);
    const msgs = [m('s', 'system', [text('sys')]), m('u1', 'user', [text(long)]), m('a1', 'assistant', [text(long)]), m('a2', 'assistant', [text('tool turn')]), m('u2', 'user', [text('last')])];
    const r = fitToContext(msgs, 120);
    expect(r.messages.map((x) => x.id)).toEqual(['s', 'u2']);
    expect(r.dropped).toBe(3);
  });

  it('keeps the last message even when it alone is over the budget', () => {
    const r = fitToContext([m('u1', 'user', [text('a')]), m('u2', 'user', [text('y'.repeat(4000))])], 10);
    expect(r.messages.map((x) => x.id)).toEqual(['u2']);
  });
});
