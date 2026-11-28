// The fetch page. The app opens it in a frame: #url=<address>&mode=read|save&app=<app origin>&lang=..&theme=..
// It is the only page allowed to reach any https address (its own CSP), and it asks the user before every fetch,
// unless they chose not to be asked again for that site and mode (kept in this page's storage). A redirect to another
// site is asked about the same way (redirect.ts).
// read: a page for a model to read. Straight from the site, then through the user's relay, and as text from Jina
// Reader when neither works or the HTML holds almost no text (a page drawn by scripts). save: a file, kept as it is.
// page (experimental, only in builds where pagesReachWeb): no address; it stays open, takes GET requests from the
// pages the user shows in the sandbox (ToPageFetcher), asks about each in turn, and answers each by its id.
// The question lives here, out of the app's reach: neither a prompt-injected model nor a script running in the
// app can fetch without the user (fully so when this page is on its own origin, VITE_FETCH_URL).
// No dependencies on the app. The DOM is built with createElement and textContent only (no innerHTML).
import { detectLang, formatNumber, getLang, setLang } from '../src/lib/i18n';
import { fetchableUrl, fetchRoutes, MAX_FETCH_BYTES, nameFor, pagesReachWeb, type FetchMode, type FromFetcher, type ToPageFetcher } from '../src/lib/fetcher/protocol';
import '../vault/style.css';
import { t } from './messages';
import { MAX_REDIRECTS, redirectStep } from './redirect';

const env = (import.meta as any).env ?? {};
// App origins allowed to embed us: the ones given at build time (separate-origin hosting) and our own
const APP_ORIGINS: string[] = [
  ...String(env.VITE_APP_ORIGIN || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  // Our own origin (same-origin hosting); never 'null', the origin of every sandboxed frame
  ...(location.origin !== 'null' ? [location.origin] : [])
];
// The user's relay for sites that refuse browsers (e.g. relay/worker.js), and Jina Reader, the keyless fallback for reading
const { relay: RELAY, jina: JINA } = fetchRoutes(env);

// In the fragment, so the address the model asked for never reaches the host's request logs
const params = new URLSearchParams(location.hash.slice(1));
{
  const l = params.get('lang');
  setLang(l === 'ja' || l === 'en' || l === 'zh' ? l : detectLang());
  document.documentElement.lang = getLang();
}
document.documentElement.classList.toggle('dark', params.get('theme') !== 'light');

const appOrigin = params.get('app') ?? '';
const target = window.parent !== window && APP_ORIGINS.includes(appOrigin) ? appOrigin : null;
const url = fetchableUrl(params.get('url') ?? '');
const mode: FetchMode = params.get('mode') === 'read' ? 'read' : params.get('mode') === 'page' ? 'page' : 'save';
/** Opened from the app's settings to manage what this page keeps, instead of to fetch */
const settingsView = params.get('view') === 'settings';

// ---- this page's storage: sites the user chose not to be asked about again, and the Jina Reader key ----
// (Kept here, not in the key vault: the app never reaches Jina, so the key is only of use to this page)
const ALLOWED_KEY = 'nbl-fetch-allowed-hosts';
const JINA_KEY = 'nbl-fetch-jina-key';
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: nothing is kept (the user is asked each time, Jina is used without a key) */
  }
}
/** Sites not asked about again, for reading pages, saving files and the shown pages' requests apart */
type Sites = Record<FetchMode, string[]>;
function allowedSites(): Sites {
  let v: unknown;
  try {
    v = JSON.parse(load(ALLOWED_KEY) ?? '[]');
  } catch {
    v = [];
  }
  const hosts = (x: unknown) => (Array.isArray(x) ? x.filter((h): h is string => typeof h === 'string') : []);
  // A plain list, kept before reading and saving were remembered apart: it stands for both
  if (Array.isArray(v)) return { read: hosts(v), save: hosts(v), page: [] };
  const o = (v ?? {}) as Partial<Sites>;
  return { read: hosts(o.read), save: hosts(o.save), page: hosts(o.page) };
}
function setAllowed(m: FetchMode, hosts: string[]) {
  const s = { ...allowedSites(), [m]: [...new Set(hosts)].sort() };
  store(ALLOWED_KEY, s.read.length || s.save.length || s.page.length ? JSON.stringify(s) : null);
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

/**
 * An address to fetch, with how many redirects led to it. from: the address that redirected to it (shown in the
 * question). blind: it redirects where the browser hides and no relay can tell; the user agreed to follow it anywhere
 */
interface Req {
  url: URL;
  hops: number;
  from?: URL;
  blind?: boolean;
}
interface Got {
  res: Response;
  body: ArrayBuffer;
  /** Where it came from, after the redirects followed */
  url: URL;
  relayed: boolean;
}

const relayUrl = (u: URL) => `${RELAY}${RELAY.includes('?') ? '&' : '?'}url=${encodeURIComponent(u.href)}`;

/**
 * One request, its redirect not followed: the response, or where the redirect leads (null: unknown). A direct fetch
 * cannot see where (the browser hides it), so a redirect goes through the relay, which tells; so does a site that
 * does not allow fetching directly (or cannot be reached).
 */
async function request(u: URL, blind: boolean): Promise<{ res: Response; relayed: boolean } | { location: string | null }> {
  const init: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: blind ? 'follow' : 'manual' };
  let redirected = false;
  try {
    const res = await fetch(u, init);
    if (res.type !== 'opaqueredirect') return { res, relayed: false };
    redirected = true;
  } catch {
    /* refused or unreachable: try the relay */
  }
  if (!RELAY) {
    if (redirected) return { location: null };
    throw new Error(t('blocked', { host: u.host }));
  }
  let res: Response;
  try {
    res = await fetch(relayUrl(u), init);
  } catch {
    throw new Error(t('blockedRelay', { host: u.host }));
  }
  const location = res.headers.get('x-redirect-to');
  return location === null ? { res, relayed: true } : { location };
}

/**
 * Fetch an address, following redirects that need no question (redirect.ts); one that does stops the fetch and is
 * returned as the next address to ask about
 */
async function download(r: Req, onProgress: (bytes: number) => void): Promise<Got | { ask: Req }> {
  let u = r.url;
  for (let hops = r.hops; ; hops++) {
    const got = await request(u, !!r.blind);
    if ('res' in got) return { ...(await readBody(got.res, u, onProgress)), url: got.relayed ? u : (fetchableUrl(got.res.url) ?? u), relayed: got.relayed };
    if (hops >= MAX_REDIRECTS) throw new Error(t('tooManyRedirects', { host: u.host, max: formatNumber(MAX_REDIRECTS) }));
    const step = redirectStep(u, got.location, allowedSites()[mode]);
    if ('refuse' in step) throw new Error(t('badRedirect', { host: u.host }));
    if ('ask' in step) return { ask: step.ask ? { url: step.ask, hops: hops + 1, from: u } : { url: u, hops: hops + 1, blind: true } };
    u = step.follow;
  }
}

async function readBody(res: Response, u: URL, onProgress: (bytes: number) => void): Promise<{ res: Response; body: ArrayBuffer }> {
  if (!res.ok) throw new Error(t('status', { host: u.host, status: String(res.status) }));
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FETCH_BYTES) throw new Error(t('tooBig', { max: MAX_MB }));
  // Read with a running limit (the length header may be missing or wrong)
  const reader = res.body?.getReader();
  if (!reader) return { res, body: await res.arrayBuffer() };
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
  return { res, body: body.buffer };
}

/** Roughly how much text a page shows, from its first 2 MB, in one pass (a crafted page must not stall it) */
function visibleTextLength(html: string): number {
  const s = html.slice(0, 2_000_000);
  const lower = s.toLowerCase();
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      parts.push(s.slice(i));
      break;
    }
    parts.push(s.slice(i, lt), ' ');
    const hidden = /^<(script|style|noscript|template)\b/.exec(lower.slice(lt, lt + 10))?.[1];
    const close = hidden ? lower.indexOf(`</${hidden}`, lt) : lt;
    const gt = close < 0 ? -1 : s.indexOf('>', close);
    if (gt < 0) break;
    i = gt + 1;
  }
  return parts.join('').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, ' ').trim().length;
}

/** A page as Markdown from Jina Reader (it renders the page, so it also reads pages drawn by scripts); with the user's key when set */
async function viaJina(u: URL): Promise<{ title: string; text: string }> {
  const key = load(JINA_KEY);
  const headers: Record<string, string> = { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const res = await fetch(`${JINA}/${u.href}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers });
  if (!res.ok) throw new Error(t('status', { host: new URL(JINA).host, status: String(res.status) }));
  const json = await res.json().catch(() => null);
  const text = typeof json?.data?.content === 'string' ? json.data.content : '';
  if (!text.trim()) throw new Error(t('jinaEmpty'));
  return { title: typeof json?.data?.title === 'string' ? json.data.title : '', text };
}

type Result = Extract<FromFetcher, { type: 'fetch-result' }>;

/**
 * What to hand to the app: the file as fetched, or for reading, Jina's text when the site gave none; or a redirect to
 * ask about first
 */
async function fetchFor(r: Req, onProgress: (bytes: number) => void): Promise<Result | { ask: Req }> {
  const asText = (j: { title: string; text: string }, at: URL): Result => {
    const data = new TextEncoder().encode(j.title ? `# ${j.title}\n\n${j.text}` : j.text).buffer as ArrayBuffer;
    return { type: 'fetch-result', name: nameFor(at, null, 'text/markdown'), mime: 'text/markdown', data, url: at.href, via: 'jina' };
  };
  let got: Awaited<ReturnType<typeof download>>;
  try {
    got = await download(r, onProgress);
  } catch (e) {
    if (mode === 'read') return asText(await viaJina(r.url).catch(() => Promise.reject(e)), r.url);
    throw e;
  }
  if ('ask' in got) return got;
  const { res, body, url: finalUrl, relayed } = got;
  const mime = mimeOf(res);
  // A page drawn by scripts holds almost no text in its HTML: read it through Jina instead (when that works)
  if (mode === 'read' && mime === 'text/html' && visibleTextLength(new TextDecoder().decode(body)) < 400) {
    const j = await viaJina(finalUrl).catch(() => null);
    if (j) return asText(j, finalUrl);
  }
  return { type: 'fetch-result', name: nameFor(finalUrl, res.headers.get('content-disposition'), mime), mime, data: body, url: finalUrl.href, via: relayed ? 'relay' : 'direct' };
}

const mimeOf = (res: Response) => (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();

const root = document.getElementById('root')!;
/** Cancelled, or the settings closed */
const close = () => post({ type: 'fetch-close' });

/** Deleting the key waits for a second press (no confirm()) */
let confirmingKey = false;

/** The settings view: the Jina Reader key and the remembered sites */
function renderSettings() {
  const key = load(JINA_KEY);
  let jina: Child;
  if (!key) {
    const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const form = h(
      'form',
      { class: 'stack' },
      h('label', {}, t('jinaKeyLabel'), input),
      h('div', { class: 'btns' }, h('button', { type: 'submit', class: 'btn primary' }, t('save')))
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return input.focus();
      store(JINA_KEY, input.value.trim());
      renderSettings();
    });
    jina = form;
  } else if (!confirmingKey) {
    const del = h('button', { type: 'button', class: 'btn danger', onClick: () => ((confirmingKey = true), renderSettings()) }, t('delete'));
    jina = h('div', { class: 'card row' }, h('div', { class: 'fill' }, t('jinaKeySet', { tail: key.slice(-4) })), h('div', { class: 'btns' }, del));
  } else {
    const yes = h('button', { type: 'button', class: 'btn danger', onClick: () => ((confirmingKey = false), store(JINA_KEY, null), renderSettings()) }, t('delete'));
    const no = h('button', { type: 'button', class: 'btn outline', onClick: () => ((confirmingKey = false), renderSettings()) }, t('cancel'));
    jina = h('div', { class: 'card stack', role: 'alert' }, h('p', {}, t('jinaKeyDeleteWarning')), h('div', { class: 'btns' }, yes, no));
  }
  const allowed = allowedSites();
  const rows = (['read', 'save', 'page'] as const).flatMap((m) =>
    allowed[m].map((host) =>
      h(
        'div',
        { class: 'card row' },
        h('div', { class: 'fill' }, h('div', { class: 'mono' }, host), h('div', { class: 'muted' }, t(m === 'read' ? 'siteRead' : m === 'save' ? 'siteSave' : 'sitePage'))),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onClick: () => (setAllowed(m, allowedSites()[m].filter((x) => x !== host)), renderSettings()) }, t('forget')))
      )
    )
  );
  const sites = rows.length ? rows : [h('p', { class: 'muted' }, t('noSites'))];
  root.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'strong' }, 'Jina Reader'),
      h('p', { class: 'muted' }, t('jinaKeyDesc', { jina: new URL(JINA).host })),
      jina,
      h('hr', {}),
      h('div', { class: 'strong' }, t('sitesTitle')),
      h('p', { class: 'muted' }, t('sitesDesc')),
      ...sites,
      h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onClick: close }, t('close')))
    )
  );
}

/** Why a redirected address is asked about: where it came from, or that where it leads is unknown */
const redirectNote = (r: Req): Child =>
  r.blind ? h('p', { class: 'muted' }, t('redirectHidden', { host: r.url.host })) : r.from && h('p', { class: 'muted' }, t('redirected', { from: r.from.host }));

// ---- mode=page: the shown pages' requests, asked about one at a time, fetched at most PAGE_PARALLEL at once ----
const PAGE_FETCH = pagesReachWeb(env);
const PAGE_PARALLEL = 4;
type Job = Req & { id: string };
/** Waiting for the user, in order; the one asked about now */
const toAsk: Job[] = [];
let asking: Job | null = null;
/** Allowed, waiting for a free place; how many run */
const toRun: Job[] = [];
let running = 0;

const fail = (id: string, message: string) => post({ type: 'page-error', id, message });

function allow(job: Job) {
  toRun.push(job);
  pump();
}
function pump() {
  while (running < PAGE_PARALLEL && toRun.length) {
    const j = toRun.shift()!;
    running++;
    download(j, () => {})
      .then((got) => {
        if ('ask' in got) return ask({ ...got.ask, id: j.id });
        const { res, body, url: finalUrl, relayed } = got;
        const mime = mimeOf(res);
        post({ type: 'page-result', id: j.id, name: nameFor(finalUrl, res.headers.get('content-disposition'), mime), mime, data: body, url: finalUrl.href, via: relayed ? 'relay' : 'direct' }, [body]);
      })
      .catch((e: Error) => fail(j.id, e.message))
      .finally(() => {
        running--;
        pump();
      });
  }
}

function onPageRequest(d: ToPageFetcher) {
  if (d.type === 'page-cancel') {
    const i = toAsk.findIndex((j) => j.id === d.id);
    if (i >= 0) toAsk.splice(i, 1);
    if (asking?.id === d.id) {
      asking = null;
      askNext();
    }
    return;
  }
  if (!PAGE_FETCH) return fail(d.id, t('pageOff'));
  const u = fetchableUrl(d.url);
  if (!u) return fail(d.id, t('badUrl'));
  const job = { id: d.id, url: u, hops: 0 };
  if (allowedSites().page.includes(u.host)) return allow(job);
  ask(job);
}

function ask(job: Job) {
  toAsk.push(job);
  if (!asking) askNext();
}

/** The user answered about the job asked now: remembering its site lets the others waiting for that site go too */
function answer(yes: boolean, remember: boolean) {
  const job = asking;
  if (!job) return;
  asking = null;
  if (yes && remember) {
    setAllowed('page', [...allowedSites().page, job.url.host]);
    for (let i = toAsk.length - 1; i >= 0; i--) if (toAsk[i].url.host === job.url.host && !toAsk[i].blind) allow(toAsk.splice(i, 1)[0]);
  }
  if (yes) allow(job);
  else fail(job.id, t('declined'));
  askNext();
}

function askNext() {
  asking = toAsk.shift() ?? null;
  post({ type: 'page-asking', asking: !!asking });
  if (!asking) return root.replaceChildren();
  const u = asking.url;
  const remember = h('input', { type: 'checkbox' });
  const go = h('button', { type: 'button', class: 'btn primary', onClick: () => answer(true, remember.checked) }, t('fetch'));
  root.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, t('titlePage')),
      h('div', {}, h('span', { class: 'muted' }, `${t('from')}: `), h('strong', {}, u.host)),
      h('p', { class: 'mono secret' }, u.href),
      redirectNote(asking),
      h('p', { class: 'muted' }, t('noteDirect', { host: u.host })),
      RELAY && h('p', { class: 'muted' }, t('noteRelay', { host: u.host, relay: new URL(RELAY).host })),
      !asking.blind && h('label', { class: 'check' }, remember, t('rememberPage', { host: u.host })),
      !asking.blind && h('p', { class: 'muted' }, t('rememberPageNote', { host: u.host })),
      toAsk.length > 0 && h('p', { class: 'muted' }, t('moreWaiting', { n: formatNumber(toAsk.length) })),
      h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onClick: () => answer(false, false) }, t('cancel')), go)
    )
  );
  if (!matchMedia('(pointer: coarse)').matches) go.focus();
}

function startPageMode() {
  addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== target) return;
    const d = e.data as ToPageFetcher | null;
    if ((d?.type === 'page-get' && typeof d.url === 'string' && typeof d.id === 'string') || (d?.type === 'page-cancel' && typeof d.id === 'string')) onPageRequest(d);
  });
}

function render() {
  if (!target) {
    root.replaceChildren(h('p', { class: 'muted' }, t('embedOnly')));
    return;
  }
  if (settingsView) return renderSettings();
  if (mode === 'page') return startPageMode();
  if (!url) {
    root.replaceChildren(
      h('div', { class: 'card stack' }, h('p', { role: 'alert' }, t('badUrl')), h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onClick: close }, t('close'))))
    );
    return;
  }
  question({ url, hops: 0 });
}

/** Sites ticked "without asking" during this fetch (the address asked first and any redirect asked about): kept once it succeeds */
const toRemember: string[] = [];

/** The question for one address (read or save); a redirect to a site that is not allowed asks again about where it leads */
function question(r: Req) {
  const u = r.url;
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const cancel = h('button', { type: 'button', class: 'btn outline', onClick: close }, t('cancel'));
  const go = h('button', { type: 'button', class: 'btn primary' }, t(mode === 'read' ? 'read' : 'fetch'));
  const remember = h('input', { type: 'checkbox' });
  const run = async () => {
    go.disabled = true;
    go.setAttribute('aria-busy', 'true');
    status.removeAttribute('role');
    status.className = 'muted';
    status.textContent = t('progress', { size: size(0) });
    try {
      const got = await fetchFor(r, (n) => (status.textContent = t('progress', { size: size(n) })));
      if (remember.checked) toRemember.push(u.host);
      if ('ask' in got) return question(got.ask);
      if (toRemember.length) setAllowed(mode, [...allowedSites()[mode], ...toRemember]);
      post(got, [got.data]);
    } catch (e) {
      go.removeAttribute('aria-busy');
      go.disabled = false;
      status.setAttribute('role', 'alert');
      status.className = 'err';
      status.textContent = (e as Error).message;
    }
  };
  go.addEventListener('click', () => void run());
  const allowed = allowedSites()[mode];
  const forget = h(
    'p',
    { class: 'muted' },
    t('allowedList', { hosts: allowed.join(', ') }),
    ' ',
    h('button', { type: 'button', class: 'link', onClick: () => (setAllowed(mode, []), forget.remove()) }, t('forgetAll'))
  );
  root.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, t(mode === 'read' ? 'titleRead' : 'title')),
      h('div', {}, h('span', { class: 'muted' }, `${t('from')}: `), h('strong', {}, u.host)),
      h('p', { class: 'mono secret' }, u.href),
      redirectNote(r),
      h('p', { class: 'muted' }, t('noteDirect', { host: u.host })),
      RELAY && h('p', { class: 'muted' }, t('noteRelay', { host: u.host, relay: new URL(RELAY).host })),
      mode === 'read' && h('p', { class: 'muted' }, t('noteJina', { jina: new URL(JINA).host })),
      mode === 'save' && h('p', { class: 'muted' }, t('limit', { max: MAX_MB })),
      !r.blind && h('label', { class: 'check' }, remember, t(mode === 'read' ? 'rememberRead' : 'rememberSave', { host: u.host })),
      !r.blind && h('p', { class: 'muted' }, t('rememberNote', { host: u.host })),
      allowed.length > 0 && forget,
      status,
      h('div', { class: 'btns' }, cancel, go)
    )
  );
  // A site the user chose not to be asked about again (for this mode): fetch right away (the request still shows while it
  // runs). Never so for a hidden redirect: where it leads is not that site
  if (!r.blind && allowed.includes(u.host)) {
    remember.checked = true;
    void run();
    return;
  }
  // Fetching needs the user's own action; start on the button that does it (no focus on touch, like the vault)
  if (!matchMedia('(pointer: coarse)').matches) go.focus();
}

// Nothing is shown until the frame's parent proves it is the app it claims to be (it says hello once this page has
// loaded): the app parameter is only a claim, and on hosts that cannot send frame-ancestors any site could frame this
// page to trick clicks out of the user
if (!target) render();
else
  addEventListener('message', function onHello(e) {
    if (e.source !== window.parent || e.origin !== target || (e.data as { type?: string } | null)?.type !== 'fetch-hello') return;
    removeEventListener('message', onHello);
    render();
  });
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (mode === 'page') answer(false, false);
  else close();
});
new ResizeObserver(() => post({ type: 'fetch-resize', height: root.scrollHeight })).observe(root);
