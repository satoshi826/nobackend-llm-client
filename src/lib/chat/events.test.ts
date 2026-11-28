import { describe, expect, it } from 'vitest';
import { applyEvent, type BlockMap } from './events';
import type { MessageRecord } from '../db/schema';
import type { ProviderEvent } from '../providers/types';
import { recentErrors } from '../error-log';

function draft(): MessageRecord {
  return { id: 'a', conversationId: 'c', parentId: 'u', role: 'assistant', parts: [], createdAt: 0, status: 'streaming', meta: { providerId: 'venice', model: 'm' } };
}

function applyAll(m: MessageRecord, events: ProviderEvent[], blocks: BlockMap = {}) {
  for (const ev of events) applyEvent(m, ev, blocks);
  return m;
}

describe('applyEvent', () => {
  it('builds a tool call from its fragments and marks it ready to run', () => {
    const m = applyAll(draft(), [
      { type: 'text-start', index: 0 },
      { type: 'text-delta', index: 0, delta: 'Searching' },
      { type: 'text-end', index: 0 },
      { type: 'tool-call-start', index: 1, toolCallId: 't1', name: 'web_search' },
      { type: 'tool-call-delta', index: 1, argsDelta: '{"query":' },
      { type: 'tool-call-delta', index: 1, argsDelta: '"cats"}' },
      { type: 'tool-call-end', index: 1, input: { query: 'cats' } }
    ]);
    expect(m.parts).toEqual([
      { type: 'text', text: 'Searching', state: 'done' },
      { type: 'tool', toolCallId: 't1', name: 'web_search', argsText: '{"query":"cats"}', input: { query: 'cats' }, state: 'input-available' }
    ]);
  });

  it('turns tool arguments that could not be parsed into a tool error', () => {
    const m = applyAll(draft(), [
      { type: 'tool-call-start', index: 0, toolCallId: 't1', name: 'x' },
      { type: 'tool-call-end', index: 0, input: undefined, parseError: 'Unexpected end' }
    ]);
    const p = m.parts[0];
    expect(p.type === 'tool' && p.state).toBe('output-error');
    expect(p.type === 'tool' && p.error).toContain('Unexpected end');
  });

  it('ignores deltas for blocks that never started', () => {
    const m = applyAll(draft(), [
      { type: 'text-delta', index: 5, delta: 'lost' },
      { type: 'tool-call-delta', index: 6, argsDelta: '{}' },
      { type: 'text-end', index: 5 }
    ]);
    expect(m.parts).toEqual([]);
  });

  it('keeps one source per address', () => {
    const m = applyAll(draft(), [
      { type: 'source', url: 'https://a.example', title: 'A' },
      { type: 'source', url: 'https://a.example', title: 'A again' },
      { type: 'source', url: 'https://b.example' }
    ]);
    expect(m.parts.map((p) => p.type === 'source' && p.title)).toEqual(['A', undefined]);
    expect(m.parts).toHaveLength(2);
  });

  it('updates a provider-side tool in place by its id', () => {
    const m = applyAll(draft(), [
      { type: 'server-tool', id: 's1', name: 'web_search', query: 'q', state: 'running' },
      { type: 'server-tool', id: 's2', name: 'web_search', state: 'running' },
      { type: 'server-tool', id: 's1', name: 'web_search', query: 'q', state: 'done', resultCount: 4 }
    ]);
    expect(m.parts).toEqual([
      { type: 'server-tool', id: 's1', name: 'web_search', query: 'q', state: 'done', resultCount: 4 },
      { type: 'server-tool', id: 's2', name: 'web_search', state: 'running' }
    ]);
  });

  it('keeps an earlier cost when a later usage event has none, and merges vendor state', () => {
    const m = applyAll(draft(), [
      { type: 'usage', usage: { inputTokens: 1 }, costUsd: 0.02 },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 9 } },
      { type: 'vendor-state', data: { a: 1 } },
      { type: 'vendor-state', data: { b: 2 } },
      { type: 'done', reason: 'length' }
    ]);
    expect(m.meta).toMatchObject({ providerId: 'venice', usage: { inputTokens: 1, outputTokens: 9 }, costUsd: 0.02, finishReason: 'length' });
    expect(m.vendorState).toEqual({ a: 1, b: 2 });
    expect(m.status).toBe('done');
  });

  it('records a provider error on the message and in the error log', () => {
    const before = recentErrors().length;
    const m = applyAll(draft(), [{ type: 'error', error: { kind: 'rate-limit', status: 429, message: 'slow down', hint: 'h', detail: 'raw' } }]);
    expect(m.status).toBe('error');
    expect(m.error).toEqual({ kind: 'rate-limit', message: 'slow down', hint: 'h', detail: 'raw', status: 429 });
    const logged = recentErrors();
    expect(logged).toHaveLength(before + 1);
    expect(logged.at(-1)).toMatchObject({ source: 'chat', kind: 'rate-limit', status: 429, provider: 'venice', message: 'slow down' });
  });

  it('treats a stop by the user as aborted, not as an error', () => {
    const before = recentErrors().length;
    const m = applyAll(draft(), [{ type: 'error', error: { kind: 'aborted', message: 'stopped' } }]);
    expect(m.status).toBe('aborted');
    expect(m.error).toBeUndefined();
    expect(recentErrors()).toHaveLength(before);
  });

  it('leaves events the runner handles alone', () => {
    const m = applyAll(draft(), [
      { type: 'start', responseId: 'r' },
      { type: 'account', balanceUsd: 3 },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' }
    ]);
    expect(m.parts).toEqual([]);
    expect(m.status).toBe('streaming');
  });
});
