// Stored files tell listeners when they change (any write, delete, import or forget), so lists that show them reload
// no matter which code changed them (state/stored.ts turns this into a signal)
const listeners = new Set<() => void>();

export function onFilesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function filesChanged() {
  for (const fn of listeners) fn();
}
