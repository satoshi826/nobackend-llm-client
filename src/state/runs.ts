// The run of each conversation (a chat reply, an image or video job, a compaction): what shows it busy, and what the stop button aborts
import { computed, signal } from '@preact/signals';
import { currentId } from './conversations';

/** Each conversation's running work, by conversation id */
export const runs = signal<ReadonlyMap<string, AbortController>>(new Map());
/** The open conversation has a run going */
export const isStreaming = computed(() => (currentId.value ? runs.value.has(currentId.value) : false));

/** Start a conversation's run: the stop button aborts it */
export function beginRun(convId: string): AbortController {
  const ctrl = new AbortController();
  runs.value = new Map(runs.value).set(convId, ctrl);
  return ctrl;
}

export function endRun(convId: string) {
  const next = new Map(runs.value);
  next.delete(convId);
  runs.value = next;
}

/** Stop a conversation's run (the open one by default) */
export function stopGeneration(convId = currentId.value) {
  if (convId) runs.peek().get(convId)?.abort();
}

export function stopAll() {
  for (const c of runs.peek().values()) c.abort();
}
