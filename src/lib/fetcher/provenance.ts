// Where an address the model asks to fetch came from. Addresses it may fetch as they are: ones that appeared in the
// conversation (the user's messages, search results, links on pages fetched) and library files on the CDNs at an
// exact version. Any other was put together by the model, and the request itself could carry the conversation out
// (in the site's logs): the fetch page asks about it even on a site not asked about, and marks the parts that
// appeared nowhere.
import type { FetchCheck } from './protocol';

/** Most links kept of one fetched page */
export const MAX_LINKS = 2000;

/** Percent-escapes as compared: an unreserved character's decoded, the rest in upper case */
const escapes = (s: string) =>
  s.replace(/%[0-9a-f]{2}/gi, (m) => {
    const c = String.fromCharCode(parseInt(m.slice(1), 16));
    return /[\w.~-]/.test(c) ? c : m.toUpperCase();
  });

/**
 * An http(s) address as compared (null when it is not one): scheme and host in lower case and the default port
 * dropped (the URL parser does both), percent-escapes normalized, the fragment dropped (it is never sent)
 */
export function normalizeUrl(raw: string | URL): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  return `${u.protocol}//${u.host}${escapes(u.pathname)}${escapes(u.search)}`;
}

/**
 * http(s) addresses written in a text (a message, Markdown, a page's text), normalized. One that runs into
 * non-ASCII text without a space ("https://a.example/x を") is taken both whole and up to that text
 */
export function urlsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`{}|\\^[\]]+/gi)) {
    const whole = trimEnd(m[0]);
    const ascii = trimEnd(/^[\x21-\x7e]+/.exec(whole)?.[0] ?? '');
    for (const s of ascii === whole ? [whole] : [whole, ascii]) {
      const n = normalizeUrl(s);
      if (n) out.add(n);
    }
  }
  return [...out];
}

/** Punctuation after an address in running text, and a closing bracket it does not open */
function trimEnd(s: string): string {
  for (;;) {
    const t = s.replace(/[.,;:!?'"*_]+$/, '');
    const unopened = t.endsWith(')') && t.split('(').length < t.split(')').length;
    s = unopened ? t.slice(0, -1) : t;
    if (s === t) return s;
  }
}

const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?`;
const NPM = String.raw`(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@${VERSION}(?:\/[^?#]*)?`;
/** A library's file on a CDN at an exact version (three@0.170.0, not @latest), with no query */
const CDN: Record<string, RegExp> = {
  'cdn.jsdelivr.net': new RegExp(`^/npm/${NPM}$`, 'i'),
  'unpkg.com': new RegExp(`^/${NPM}$`, 'i'),
  'cdnjs.cloudflare.com': new RegExp(String.raw`^/ajax/libs/[\w.-]+/${VERSION}(?:/[^?#]*)?$`, 'i')
};
export const isLibraryFile = (u: URL) => u.protocol === 'https:' && !u.search && !!CDN[u.host]?.test(u.pathname);

/** A part of an address: its host, one path segment, or one query parameter; start and end are offsets in its href */
interface Piece {
  kind: 'host' | 'path' | 'query';
  start: number;
  end: number;
}

/** The pieces of an address, in order */
function pieces(u: URL): Piece[] {
  const out: Piece[] = [];
  let at = u.protocol.length + 2;
  out.push({ kind: 'host', start: at, end: at + u.host.length });
  at += u.host.length;
  for (const seg of u.pathname.split('/')) {
    if (seg) out.push({ kind: 'path', start: at, end: at + seg.length });
    at += seg.length + 1;
  }
  at = u.protocol.length + 2 + u.host.length + u.pathname.length + 1;
  for (const p of u.search.slice(1).split('&')) {
    if (p) out.push({ kind: 'query', start: at, end: at + p.length });
    at += p.length + 1;
  }
  return out;
}

/** Addresses seen in a conversation, for telling what the model put together */
export interface Seen {
  exact: Set<string>;
  /** By host: the path segments ("p" + segment) and query parameters ("q" + parameter) its addresses have */
  byHost: Map<string, Set<string>>;
}

const pieceKey = (href: string, p: Piece) => (p.kind === 'path' ? 'p' : 'q') + escapes(href.slice(p.start, p.end));

export function seenFrom(urls: Iterable<string>): Seen {
  const seen: Seen = { exact: new Set(), byHost: new Map() };
  for (const raw of urls) {
    const n = normalizeUrl(raw);
    if (!n || seen.exact.has(n)) continue;
    seen.exact.add(n);
    const u = new URL(n);
    const keys = seen.byHost.get(u.host) ?? new Set<string>();
    seen.byHost.set(u.host, keys);
    for (const p of pieces(u)) if (p.kind !== 'host') keys.add(pieceKey(u.href, p));
  }
  return seen;
}

/**
 * The parts of an address the model put together that appeared in no address seen on its site (the host too, when
 * none was seen there). null: it may be fetched as it is (seen exactly, or a library file)
 */
export function composedParts(u: URL, seen: Seen): Piece[] | null {
  const n = normalizeUrl(u);
  if (!n || seen.exact.has(n) || isLibraryFile(u)) return null;
  const keys = seen.byHost.get(u.host);
  return pieces(u).filter((p) => (p.kind === 'host' ? !keys : !keys?.has(pieceKey(u.href, p))));
}

/** A fetched page's links as kept with its result: normalized, each once, at most MAX_LINKS */
export function keptLinks(hrefs: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const h of hrefs) {
    const n = normalizeUrl(h);
    if (n) out.add(n);
    if (out.size >= MAX_LINKS) break;
  }
  return [...out];
}

/** What the fetch page is told about an address: undefined when it may be fetched as it is, else its put-together parts */
export function checkAddress(u: URL, seen: Seen): FetchCheck | undefined {
  const parts = composedParts(u, seen);
  return parts ? { composed: parts.map((p) => [p.start, p.end]) } : undefined;
}
