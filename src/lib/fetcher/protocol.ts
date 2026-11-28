// Messages between the app and the fetch page (fetch/), a separate page that alone may reach any https address.
// The app opens it in a frame with the address to fetch; the page asks the user, fetches, and posts the result.

/** Largest file the fetch page passes on */
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/**
 * read: a page's text for a model to read (may fall back to Jina Reader); save: a file kept as it is; page: what a
 * page shown in the sandbox asks for (experimental, pagesReachWeb)
 */
export type FetchMode = 'read' | 'save' | 'page';
/** How it was fetched: straight from the site, through the user's relay, or as text from Jina Reader (read only) */
export type FetchVia = 'direct' | 'relay' | 'jina';

/** The fetch page's ways after the site itself: the user's relay (optional) and Jina Reader (reading only) */
export function fetchRoutes(env: Record<string, string | undefined>): { relay: string; jina: string } {
  return { relay: env.VITE_FETCH_RELAY_URL || '', jina: (env.VITE_JINA_BASE_URL || 'https://r.jina.ai').replace(/\/+$/, '') };
}

/**
 * Experimental, off unless the build sets VITE_EXPERIMENTAL_PAGE_API=1: pages the user shows from the sandbox may use
 * their site's files and the model (nbl.files, nbl.chat)
 */
export const pageApiOn = (env: Record<string, string | undefined>) => env.VITE_EXPERIMENTAL_PAGE_API === '1';
/** ...and fetch from the web (GET, through the fetch page), only with a relay: without one most sites refuse browsers */
export const pagesReachWeb = (env: Record<string, string | undefined>) => pageApiOn(env) && !!fetchRoutes(env).relay;

/** The app's proof that it framed the page (sent once the page has loaded); the page shows nothing until then */
export const FETCH_HELLO = { type: 'fetch-hello' } as const;

/** What was fetched */
export interface Fetched {
  name: string;
  mime: string;
  data: ArrayBuffer;
  /** The address it came from (after redirects) */
  url: string;
  via: FetchVia;
}

/** The app to a fetch page opened with mode=page, which stays open and takes the shown pages' requests in turn */
export type ToPageFetcher = { type: 'page-get'; id: string; url: string } | { type: 'page-cancel'; id: string };

export type FromFetcher =
  | { type: 'fetch-resize'; height: number }
  /** mode=page: it is asking the user (show it), or no longer (hide it) */
  | { type: 'page-asking'; asking: boolean }
  | ({ type: 'page-result'; id: string } & Fetched)
  | { type: 'page-error'; id: string; message: string }
  | ({ type: 'fetch-result' } & Fetched)
  /** Cancelled, or the settings view closed: nothing was fetched */
  | { type: 'fetch-close' };

/** Only https addresses are fetched (no http, no data:, no file:, no credentials in the address) */
export function fetchableUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

/** A file name for what was fetched: Content-Disposition first, then the last part of the address */
export function nameFor(url: URL, disposition: string | null, mime: string): string {
  const fromHeader = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let name = '';
  try {
    name = decodeURIComponent(fromHeader ?? url.pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    name = fromHeader ?? '';
  }
  // oxlint-disable-next-line no-control-regex -- control characters are what it removes
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim();
  // Named after the host when the address has no file name (the host's dots are not an extension)
  const fromHost = !name;
  if (fromHost) name = url.hostname;
  if (fromHost || !/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = EXT_FOR[mime];
    if (ext) name += `.${ext}`;
  }
  return name.slice(0, 120);
}

const EXT_FOR: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/json': 'json'
};
