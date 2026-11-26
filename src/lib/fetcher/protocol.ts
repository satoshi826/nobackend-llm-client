// Messages between the app and the fetch page (fetch/), a separate page that alone may reach any https address.
// The app opens it in a frame with the address to fetch; the page asks the user, fetches, and posts the result.

/** Largest file the fetch page passes on */
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/** read: a page's text for a model to read (may fall back to Jina Reader); save: a file kept as it is */
export type FetchMode = 'read' | 'save';
/** How it was fetched: straight from the site, through the user's relay, or as text from Jina Reader (read only) */
export type FetchVia = 'direct' | 'relay' | 'jina';

/** The fetch page's ways after the site itself: the user's relay (optional) and Jina Reader (reading only) */
export function fetchRoutes(env: Record<string, string | undefined>): { relay: string; jina: string } {
  return { relay: env.VITE_FETCH_RELAY_URL || '', jina: (env.VITE_JINA_BASE_URL || 'https://r.jina.ai').replace(/\/+$/, '') };
}

export type FromFetcher =
  | { type: 'fetch-resize'; height: number }
  | { type: 'fetch-result'; ok: true; name: string; mime: string; data: ArrayBuffer; url: string; via: FetchVia }
  | { type: 'fetch-result'; ok: false; cancelled: boolean; message?: string };

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
