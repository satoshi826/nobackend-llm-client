// Data features load once the stored data can be read (at startup, after unlocking, after an import).
// Features register their loaders here so app startup and backup import do not need to know them.
const loaders: (() => Promise<void>)[] = [];

export function registerDataLoader(fn: () => Promise<void>) {
  if (!loaders.includes(fn)) loaders.push(fn);
}

export async function loadFeatureData() {
  for (const fn of loaders) await fn();
}
