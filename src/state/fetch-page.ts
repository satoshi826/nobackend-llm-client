// Fetching from the web goes through the fetch page (fetch/), a separate page that alone may reach any https address
// and asks the user (or remembers a site they allowed). Both reading a page (fetch_url) and saving a file
// (fetch_file) ask here; the FetchDialog shows the page for the current request.
import { signal } from '@preact/signals';
import type { FetchMode, FetchVia } from '../lib/fetcher/protocol';

export interface Fetched {
  name: string;
  mime: string;
  data: ArrayBuffer;
  /** The address it came from (after redirects) */
  url: string;
  /** Straight from the site, through the user's relay, or as text from Jina Reader */
  via: FetchVia;
}

/** The address being fetched; the FetchDialog shows the fetch page for it */
export const fetchRequest = signal<{ url: string; mode: FetchMode; done(r: Fetched | null): void } | null>(null);

/** Ask the user (in the fetch page) and fetch. null when they cancel */
export function fetchFromWeb(url: string, mode: FetchMode): Promise<Fetched | null> {
  fetchRequest.value?.done(null);
  return new Promise((resolve) => {
    fetchRequest.value = {
      url,
      mode,
      done: (r) => {
        fetchRequest.value = null;
        resolve(r);
      }
    };
  });
}
