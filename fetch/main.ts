// The fetch page. The app opens it in a frame: ?url=<address>&app=<app origin>&lang=..&theme=..
// It is the only page allowed to reach any https address (its own CSP), and it asks the user before every fetch.
// The question lives here, out of the app's reach: neither a prompt-injected model nor a script running in the
// app can fetch without the user (fully so when this page is on its own origin, VITE_FETCH_URL).
// No dependencies on the app. The DOM is built with createElement and textContent only (no innerHTML).
import { detectLang, formatNumber, getLang, setLang } from '../src/lib/i18n';
import { fetchableUrl, MAX_FETCH_BYTES, nameFor, type FromFetcher } from '../src/lib/fetcher/protocol';
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
  const go = h('button', { type: 'button', class: 'btn primary' }, t('fetch'));
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.setAttribute('aria-busy', 'true');
    status.textContent = t('progress', { size: size(0) });
    try {
      const { res, body, relayed } = await download(url, (n) => (status.textContent = t('progress', { size: size(n) })));
      const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const finalUrl = fetchableUrl(relayed ? url.href : res.url || url.href) ?? url;
      post({ type: 'fetch-result', ok: true, name: nameFor(finalUrl, res.headers.get('content-disposition'), mime), mime, data: body, url: finalUrl.href, relayed }, [body]);
    } catch (e) {
      go.removeAttribute('aria-busy');
      go.disabled = false;
      status.setAttribute('role', 'alert');
      status.className = 'err';
      status.textContent = (e as Error).message;
    }
  });
  root.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, t('title')),
      h('div', {}, h('span', { class: 'muted' }, `${t('from')}: `), h('strong', {}, url.host)),
      h('p', { class: 'mono secret' }, url.href),
      h('p', { class: 'muted' }, t('noteDirect', { host: url.host })),
      RELAY && h('p', { class: 'muted' }, t('noteRelay', { host: url.host, relay: new URL(RELAY).host })),
      h('p', { class: 'muted' }, t('limit', { max: MAX_MB })),
      status,
      h('div', { class: 'btns' }, cancel, go)
    )
  );
  // Fetching needs the user's own action; start on the button that does it (no focus on touch, like the vault)
  if (!matchMedia('(pointer: coarse)').matches) go.focus();
}

render();
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post({ type: 'fetch-result', ok: false, cancelled: true });
});
new ResizeObserver(() => post({ type: 'fetch-resize', height: root.scrollHeight })).observe(root);
