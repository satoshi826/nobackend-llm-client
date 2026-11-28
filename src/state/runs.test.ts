import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { beginRun, endRun, isStreaming, runs, stopAll, stopGeneration } from './runs';
import { currentId } from './conversations';

afterEach(() => {
  for (const id of runs.value.keys()) endRun(id);
  currentId.value = null;
});

describe('runs per conversation', () => {
  it('marks a conversation as running while a run is going, and the stop button follows the open one', () => {
    beginRun('a');
    beginRun('b');
    expect([...runs.value.keys()].sort()).toEqual(['a', 'b']);
    currentId.value = 'a';
    expect(isStreaming.value).toBe(true);
    endRun('a');
    expect(isStreaming.value).toBe(false);
    expect(runs.value.has('b')).toBe(true);
    expect(runs.value.has('a')).toBe(false);
  });

  it('stops only the open conversation, a named one, or all of them', () => {
    const a = beginRun('a');
    const b = beginRun('b');
    const c = beginRun('c');
    currentId.value = 'a';
    stopGeneration();
    expect([a.signal.aborted, b.signal.aborted, c.signal.aborted]).toEqual([true, false, false]);
    stopGeneration('b');
    expect(b.signal.aborted).toBe(true);
    expect(c.signal.aborted).toBe(false);
    stopAll();
    expect(c.signal.aborted).toBe(true);
  });

  it('does nothing when stopping in a draft', () => {
    const a = beginRun('a');
    currentId.value = null;
    stopGeneration();
    expect(a.signal.aborted).toBe(false);
  });
});
