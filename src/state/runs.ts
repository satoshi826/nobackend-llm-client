// Running work per conversation (chat replies, image jobs, compaction): streaming flags and the stop button
import { computed, signal } from '@preact/signals';
import { currentId } from './conversations';

// ---- Generation state ----
export const streamingConv = signal<Set<string>>(new Set());
export const isStreaming = computed(() => (currentId.value ? streamingConv.value.has(currentId.value) : false));
export const controllers = new Map<string, AbortController>();

export function setStreaming(convId: string, on: boolean) {
  const s = new Set(streamingConv.value);
  if (on) s.add(convId);
  else s.delete(convId);
  streamingConv.value = s;
}

/** Start a run for a conversation (shared by chat replies and image jobs): the stop button aborts it */
export function beginRun(convId: string): AbortController {
  const ctrl = new AbortController();
  controllers.set(convId, ctrl);
  setStreaming(convId, true);
  return ctrl;
}

export function endRun(convId: string) {
  controllers.delete(convId);
  setStreaming(convId, false);
}

export function stopGeneration(convId = currentId.value) {
  if (convId) controllers.get(convId)?.abort();
}

export function stopAll() {
  for (const c of controllers.values()) c.abort();
}

export function abortConversation(id: string) {
  controllers.get(id)?.abort();
}
