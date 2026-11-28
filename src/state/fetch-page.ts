// Fetching from the web goes through the fetch page (fetch/), a separate page that alone may reach any https address
// and asks the user (or remembers a site they allowed). Both reading a page (fetch_url) and saving a file
// (fetch_file) ask here; the FetchDialog shows the page for the current request.
import { signal } from '@preact/signals';
import type { Fetched } from '../lib/fetcher/protocol';

/** The fetch page's own settings are open (over the app's settings; the FetchDialog shows them) */
export const fetchSettingsOpen = signal(false);

/** The address being fetched; the FetchDialog shows the fetch page for it */
export const fetchRequest = signal<{ url: string; mode: 'read' | 'save'; done(r: Fetched | null): void } | null>(null);

/** Ask the user (in the fetch page) and fetch. null when they cancel or the reply is stopped (signal) */
export function fetchFromWeb(url: string, mode: 'read' | 'save', signal?: AbortSignal): Promise<Fetched | null> {
  fetchRequest.value?.done(null);
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const req = {
      url,
      mode,
      done: (r: Fetched | null) => {
        signal?.removeEventListener('abort', stop);
        if (fetchRequest.value === req) fetchRequest.value = null;
        resolve(r);
      }
    };
    const stop = () => req.done(null);
    signal?.addEventListener('abort', stop, { once: true });
    fetchRequest.value = req;
  });
}

// ---- the shown pages' requests (experimental, PAGE_WEB): one fetch page opened with mode=page takes them all ----

/** A page's GET, or why it did not happen */
export type PageFetched = Fetched | { error: string };

/** The fetch page for pages is open (while any request waits), and is asking the user (shown) */
export const pageFetcher = signal<{ asking: boolean } | null>(null);

const jobs = new Map<string, (r: PageFetched) => void>();
/** Requests made before the frame was ready; then its way to send them */
let queued: { id: string; url: string }[] = [];
let send: ((m: { type: 'page-get'; id: string; url: string } | { type: 'page-cancel'; id: string }) => void) | null = null;

/** The frame is ready (it got hello): what waited goes now */
export function pageFetcherReady(post: NonNullable<typeof send>) {
  send = post;
  for (const q of queued.splice(0)) post({ type: 'page-get', ...q });
}

/** An answer from the frame, by request id */
export function pageFetcherAnswer(id: string, r: PageFetched) {
  jobs.get(id)?.(r);
}

export function pageFetcherAsking(asking: boolean) {
  if (pageFetcher.value) pageFetcher.value = { asking };
}

/** Done with a request; the frame closes once nothing waits */
function settle(id: string) {
  jobs.delete(id);
  if (jobs.size) return;
  pageFetcher.value = null;
  send = null;
}

/** A shown page's GET of url, through the fetch page (which asks the user, or remembers a site they allowed) */
export function fetchForPage(url: string, signal?: AbortSignal): Promise<PageFetched> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ error: 'Aborted' });
    const id = crypto.randomUUID();
    const stop = () => {
      if (!jobs.has(id)) return;
      send?.({ type: 'page-cancel', id });
      queued = queued.filter((q) => q.id !== id);
      finish({ error: 'Aborted' });
    };
    const finish = (r: PageFetched) => {
      signal?.removeEventListener('abort', stop);
      settle(id);
      resolve(r);
    };
    jobs.set(id, finish);
    signal?.addEventListener('abort', stop, { once: true });
    pageFetcher.value ??= { asking: false };
    if (send) send({ type: 'page-get', id, url });
    else queued.push({ id, url });
  });
}
