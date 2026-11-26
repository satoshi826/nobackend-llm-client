// Recent errors, kept in memory only for the diagnostics text (Settings → 情報). Never stored or sent anywhere.
// Messages are cut short; callers pass error messages, never conversation content.

export interface ErrorEntry {
  at: number;
  /** Where it happened, e.g. 'chat', 'window', 'promise' */
  source: string;
  message: string;
  /** Provider error kind / HTTP status, when known */
  kind?: string;
  status?: number;
  provider?: string;
}

const MAX = 20;
const entries: ErrorEntry[] = [];

export function noteError(e: Omit<ErrorEntry, 'at' | 'message'> & { message: unknown }) {
  const message = String(e.message ?? '').replace(/\s+/g, ' ').slice(0, 300);
  entries.push({ ...e, message, at: Date.now() });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function recentErrors(): ErrorEntry[] {
  return entries.slice();
}

/** Uncaught errors and rejections of the page */
export function watchPageErrors(target: Pick<Window, 'addEventListener'>) {
  target.addEventListener('error', (ev) => noteError({ source: 'window', message: (ev as ErrorEvent).message || 'error' }));
  target.addEventListener('unhandledrejection', (ev) => {
    const r = (ev as PromiseRejectionEvent).reason;
    noteError({ source: 'promise', message: r instanceof Error ? `${r.name}: ${r.message}` : r });
  });
}
