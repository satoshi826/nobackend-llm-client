// Where an address the model asks to fetch came from. Addresses it may fetch as they are: ones that appeared in the
// conversation (the user's messages, search results, links on pages fetched) and library files on the CDNs at an
// exact version. Any other was put together by the model: the fetch page asks about it even on a site not asked
// about, marks the parts that appeared nowhere, and warns when those parts hold text of the conversation (the request
// itself would carry it out, in the site's logs).
import type { FetchCheck, LeakPlace } from './protocol';
import { MAX_MATCH_CHARS } from './protocol';

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

// ---- text of the conversation in an address ----

/** A text of the conversation the model could put into an address, and where it is */
export interface Content {
  place: LeakPlace;
  text: string;
}

/** Shortest run of characters counted as found */
export const MIN_RUN = 8;

/** Text as compared: Unicode-normalized (NFKC), case-folded, each run of white space one space */
// (The pattern matches only runs that are not already one space: much faster on long texts than \s+)
export const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\S ]\s*| \s+/g, ' ');

/** Repeated percent-decoding (an address may be encoded twice), stopping at a broken escape */
function unescapeAll(s: string): string {
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i++) {
    try {
      s = decodeURIComponent(s);
    } catch {
      break;
    }
  }
  return s;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** A base64 or base64url token as text, when it decodes to text (no control characters but line ends and tabs) */
function fromBase64(token: string): string | null {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (b64.length % 4 === 1) return null;
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const text = utf8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    // oxlint-disable-next-line no-control-regex -- control characters are what rules a token out
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

/**
 * The texts an address's put-together parts may carry: each path segment and query key and value decoded, and its
 * long base64 tokens decoded. Not the host: a site named earlier in the conversation is no leak, and a host name
 * holds only letters, digits and hyphens, so text would be in it encoded
 */
function candidates(href: string, parts: Piece[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind === 'host') continue;
    const raw = href.slice(p.start, p.end);
    const texts = p.kind === 'query' ? raw.replace(/\+/g, ' ').split('=') : [raw];
    for (const t of texts.map(unescapeAll)) {
      out.push(t);
      for (const m of t.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) {
        const d = fromBase64(m[0]);
        if (d) out.push(d);
      }
    }
  }
  return out.map(fold).filter((t) => t.length >= MIN_RUN);
}

// A polynomial rolling hash of MIN_RUN characters (mod 2^32)
const BASE = 0x01000193;
let TOP = 1;
for (let i = 1; i < MIN_RUN; i++) TOP = Math.imul(TOP, BASE);

/**
 * Calls hit(i, hash) for each run of MIN_RUN characters of s (i its first character), or with a filter only for
 * those whose hash may be in it (a bit per hash's top 20 bits: most runs of a long text end there, cheaply)
 */
function eachRun(s: string, hit: (i: number, h: number) => void, filter?: Uint32Array) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    if (i >= MIN_RUN) h = (h - Math.imul(s.charCodeAt(i - MIN_RUN), TOP)) | 0;
    h = (Math.imul(h, BASE) + s.charCodeAt(i)) | 0;
    if (i < MIN_RUN - 1) continue;
    const b = h >>> 12;
    if (!filter || filter[b >>> 5] & (1 << (b & 31))) hit(i - MIN_RUN + 1, h);
  }
}

function filterOf(hashes: Iterable<number>): Uint32Array {
  const f = new Uint32Array(1 << 15);
  for (const h of hashes) {
    const b = h >>> 12;
    f[b >>> 5] |= 1 << (b & 31);
  }
  return f;
}

const sameRun = (a: string, i: number, b: string, j: number) => {
  for (let k = 0; k < MIN_RUN; k++) if (a.charCodeAt(i + k) !== b.charCodeAt(j + k)) return false;
  return true;
};

/**
 * The longest run of at least MIN_RUN characters of an address's put-together parts (decoded) that also occurs in
 * the conversation's content, and where. Runs that occur in the user's latest request do not count: a search built
 * from its words is what the user asked for. One pass over each text, with a rolling hash of the address's runs
 */
export function contentIn(href: string, parts: Piece[], request: string, content: Iterable<Content>): FetchCheck['match'] {
  const cands = candidates(href, parts);
  /** The address's runs by hash: [candidate, offset] */
  const runs = new Map<number, [number, number][]>();
  cands.forEach((c, ci) => eachRun(c, (i, h) => runs.set(h, [...(runs.get(h) ?? []), [ci, i]])));
  if (!runs.size) return undefined;
  const filter = filterOf(runs.keys());
  const req = fold(request);
  eachRun(
    req,
    (i, h) => {
      const at = runs.get(h);
      if (!at) return;
      const rest = at.filter(([ci, j]) => !sameRun(req, i, cands[ci], j));
      if (rest.length) runs.set(h, rest);
      else runs.delete(h);
    },
    filter
  );
  let best: { place: LeakPlace; text: string } | undefined;
  for (const { place, text } of content) {
    const s = fold(text);
    eachRun(s, (i, h) => {
      for (const [ci, j] of runs.get(h) ?? []) {
        const c = cands[ci];
        if (!sameRun(s, i, c, j)) continue;
        let n = MIN_RUN;
        while (j + n < c.length && i + n < s.length && s.charCodeAt(i + n) === c.charCodeAt(j + n)) n++;
        if (!best || n > best.text.length) best = { place, text: c.slice(j, j + n) };
      }
    }, filter);
  }
  return best && { place: best.place, text: best.text.slice(0, MAX_MATCH_CHARS) };
}

/**
 * What the fetch page is told about an address: undefined when it may be fetched as it is; else its put-together
 * parts, and text of the conversation found in them. content is read only for such an address
 */
export async function checkAddress(u: URL, seen: Seen, request: string, content: () => Promise<Iterable<Content>>): Promise<FetchCheck | undefined> {
  const parts = composedParts(u, seen);
  if (!parts) return undefined;
  const match = parts.some((p) => p.kind !== 'host') ? contentIn(u.href, parts, request, await content()) : undefined;
  return { composed: parts.map((p) => [p.start, p.end]), ...(match ? { match } : {}) };
}
