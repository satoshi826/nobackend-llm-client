// Stored images and files tell listeners when they change (any write, delete, import or forget), so lists that
// show them reload no matter which code changed them (state/stored.ts turns this into signals)
export type StoreName = 'images' | 'files';

const listeners = new Set<(store: StoreName) => void>();

export function onStoreChange(fn: (store: StoreName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function storeChanged(store: StoreName) {
  for (const fn of listeners) fn(store);
}
