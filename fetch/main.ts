// The fetch page. The app opens it in a frame: ?url=<address>&mode=read|save&app=<app origin>&lang=..&theme=..
// It is the only page allowed to reach any https address (its own CSP), and it asks the user before every fetch,
// unless they chose not to be asked again for that site (kept in this page's storage).
// read: a page for a model to read. Straight from the site, then through the user's relay, and as text from Jina
// Reader when neither works or the HTML holds almost no text (a page drawn by scripts). save: a file, kept as it is.
// The question lives here, out of the app's reach: neither a prompt-injected model nor a script running in the
// app can fetch without the user (fully so when this page is on its own origin, VITE_FETCH_URL).
// No dependencies on the app. The DOM is built with createElement and textContent only (no innerHTML).
import { detectLang, formatNumber, getLang, setLang } from '../src/lib/i18n';
import { fetchableUrl, MAX_FETCH_BYTES, nameFor, type FetchVia, type FromFetcher } from '../src/lib/fetcher/protocol';
import '../vault/style.css';
import { t } from './messages';

const env = (import.meta as any).env ?? {};
// App origins allowed to embed us: the ones given at build time (separate-origin hosting) and our own
const APP_ORIGINS: string[] = [
  ...String(env.VITE_APP_ORIGIN || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  location.origin
];
/** Optional relay for sites that do not allow fetching from a browser (the user's own, e.g. relay/worker.js) */
const RELAY: string = env.VITE_FETCH_RELAY_URL || '';
/** Jina Reader, the fallback for reading (keyless; overridable for the mock server) */
const JINA: string = (env.VITE_JINA_BASE_URL || 'https://r.jina.ai').replace(/\/+$/, '');

const params = new URLSearchParams(location.search);
{
  const l = params.get('lang');
  setLang(l === 'ja' || l === 'en' || l === 'zh' ? l : detectLang());
  document.documentElement.lang = getLang();
}
document.documentElement.classList.toggle('dark', params.get('theme') !== 'light');

const appOrigin = params.get('app') ?? '';
const target = window.parent !== window && APP_ORIGINS.includes(appOrigin) ? appOrigin : null;
const url = fetchableUrl(params.get('url') ?? '');
const mode: 'read' | 'save' = params.get('mode') === 'read' ? 'read' : 'save';

// ---- sites the user chose not to be asked about again (this page's storage) ----
const ALLOWED_KEY = 'nbl-fetch-allowed-hosts';
function allowedHosts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ALLOWED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function setAllowedHosts(list: string[]) {
  try {
    localStorage.setItem(ALLOWED_KEY, JSON.stringify([...new Set(list)].sort()));
  } catch {
    /* storage unavailable: the user is simply asked each time */
  }
}
const MAX_MB = formatNumber(MAX_FETCH_BYTES / 1024 / 1024);

function post(msg: FromFetcher, transfer: Transferable[] = []) {
  if (target) window.parent.postMessage(msg, target, transfer);
}

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const size = (n: number) => (n < 1024 * 1024 ? `${formatNumber(Math.round(n / 1024))} KB` : `${formatNumber(n / 1024 / 1024, { maximumFractionDigits: 1 })} MB`);

/** Fetch directly; when the site does not allow it (or cannot be reached) and a relay is set, through the relay */
async function download(u: URL, onProgress: (bytes: number) => void): Promise<{ res: Response; body: ArrayBuffer; relayed: boolean }> {
  const init: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
  let res: Response;
  let relayed = false;
  try {
    res = await fetch(u, init);
  } catch {
    if (!RELAY) throw new Error(t('blocked', { host: u.host }));
    try {
      res = await fetch(`${RELAY}${RELAY.includes('?') ? '&' : '?'}url=${encodeURIComponent(u.href)}`, init);
      relayed = true;
    } catch {
      throw new Error(t('blockedRelay', { host: u.host }));
    }
  }
  if (!res.ok) throw new Error(t('status', { host: u.host, status: String(res.status) }));
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FETCH_BYTES) throw new Error(t('tooBig', { max: MAX_MB }));
  // Read with a running limit (the length header may be missing or wrong)
  const reader = res.body?.getReader();
  if (!reader) return { res, body: await res.arrayBuffer(), relayed };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      void reader.cancel();
      throw new Error(t('tooBig', { max: MAX_MB }));
    }
    chunks.push(value);
    onProgress(total);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return { res, body: body.buffer, relayed };
}

/** Roughly how much text an HTML page shows (scripts, styles and tags left out) */
function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** A page as Markdown from Jina Reader (it renders the page, so it also reads pages drawn by scripts) */
async function viaJina(u: URL): Promise<{ title: string; text: string }> {
  const res = await fetch(`${JINA}/${u.href}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(t('status', { host: new URL(JINA).host, status: String(res.status) }));
  const json = await res.json().catch(() => null);
  const text = typeof json?.data?.content === 'string' ? json.data.content : '';
  if (!text.trim()) throw new Error(t('jinaEmpty'));
  return { title: typeof json?.data?.title === 'string' ? json.data.title : '', text };
}

type Result = Extract<FromFetcher, { ok: true }>;

/** What to hand to the app: the file as fetched, or for reading, Jina's text when the site gave none */
async function fetchFor(u: URL, onProgress: (bytes: number) => void): Promise<Result> {
  const asText = (r: { title: string; text: string }): Result => {
    const data = new TextEncoder().encode(r.title ? `# ${r.title}\n\n${r.text}` : r.text).buffer as ArrayBuffer;
    return { type: 'fetch-result', ok: true, name: nameFor(u, null, 'text/markdown'), mime: 'text/markdown', data, url: u.href, via: 'jina' };
  };
  let got: Awaited<ReturnType<typeof download>>;
  try {
    got = await download(u, onProgress);
  } catch (e) {
    if (mode === 'read') return asText(await viaJina(u).catch(() => Promise.reject(e)));
    throw e;
  }
  const { res, body, relayed } = got;
  const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const finalUrl = fetchableUrl(relayed ? u.href : res.url || u.href) ?? u;
  const via: FetchVia = relayed ? 'relay' : 'direct';
  // A page drawn by scripts holds almost no text in its HTML: read it through Jina instead (when that works)
  if (mode === 'read' && mime === 'text/html' && visibleTextLength(new TextDecoder().decode(body)) < 400) {
    const r = await viaJina(finalUrl).catch(() => null);
    if (r) return asText(r);
  }
  return { type: 'fetch-result', ok: true, name: nameFor(finalUrl, res.headers.get('content-disposition'), mime), mime, data: body, url: finalUrl.href, via };
}

const root = document.getElementById('root')!;

function render() {
  if (!target) {
    root.replaceChildren(h('p', { class: 'muted' }, t('embedOnly')));
    return;
  }
  if (!url) {
    root.replaceChildren(
      h('div', { class: 'card stack' }, h('p', { role: 'alert' }, t('badUrl')), h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onClick: () => post({ type: 'fetch-result', ok: false, cancelled: true }) }, t('close'))))
    );
    return;
  }
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const cancel = h('button', { type: 'button', class: 'btn outline', onClick: () => post({ type: 'fetch-result', ok: false, cancelled: true }) }, t('cancel'));
  const go = h('button', { type: 'button', class: 'btn primary' }, t(mode === 'read' ? 'read' : 'fetch'));
  const remember = h('input', { type: 'checkbox' });
  const run = async () => {
    go.disabled = true;
    go.setAttribute('aria-busy', 'true');
    status.removeAttribute('role');
    status.className = 'muted';
    status.textContent = t('progress', { size: size(0) });
    try {
      const r = await fetchFor(url, (n) => (status.textContent = t('progress', { size: size(n) })));
      if (remember.checked) setAllowedHosts([...allowedHosts(), url.host]);
      post(r, [r.data]);
    } catch (e) {
      go.removeAttribute('aria-busy');
      go.disabled = false;
      status.setAttribute('role', 'alert');
      status.className = 'err';
      status.textContent = (e as Error).message;
    }
  };
  go.addEventListener('click', () => void run());
  const allowed = allowedHosts();
  const forget = h(
    'p',
    { class: 'muted' },
    t('allowedList', { hosts: allowed.join(', ') }),
    ' ',
    h('button', { type: 'button', class: 'link', onClick: () => (setAllowedHosts([]), forget.remove()) }, t('forgetAll'))
  );
  root.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, t(mode === 'read' ? 'titleRead' : 'title')),
      h('div', {}, h('span', { class: 'muted' }, `${t('from')}: `), h('strong', {}, url.host)),
      h('p', { class: 'mono secret' }, url.href),
      h('p', { class: 'muted' }, t('noteDirect', { host: url.host })),
      RELAY && h('p', { class: 'muted' }, t('noteRelay', { host: url.host, relay: new URL(RELAY).host })),
      mode === 'read' && h('p', { class: 'muted' }, t('noteJina', { jina: new URL(JINA).host })),
      mode === 'save' && h('p', { class: 'muted' }, t('limit', { max: MAX_MB })),
      h('label', { class: 'check' }, remember, t('remember', { host: url.host })),
      allowed.length > 0 && forget,
      status,
      h('div', { class: 'btns' }, cancel, go)
    )
  );
  // A site the user chose not to be asked about again: fetch right away (the request still shows while it runs)
  if (allowed.includes(url.host)) {
    remember.checked = true;
    void run();
    return;
  }
  // Fetching needs the user's own action; start on the button that does it (no focus on touch, like the vault)
  if (!matchMedia('(pointer: coarse)').matches) go.focus();
}

render();
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post({ type: 'fetch-result', ok: false, cancelled: true });
});
new ResizeObserver(() => post({ type: 'fetch-resize', height: root.scrollHeight })).observe(root);
