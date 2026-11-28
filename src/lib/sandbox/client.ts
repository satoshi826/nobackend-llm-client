// The app's side of the sandbox (sandbox/sandbox.html): an <iframe sandbox="allow-scripts allow-forms"> with no origin of
// its own and a CSP that blocks every request. The page announces itself once on the window; from then on the app talks to
// it over a private MessagePort, so whatever the shown HTML posts on the window is never listened to.

export const SANDBOX_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}sandbox/`;
/**
 * Scripts may run, and forms may be submitted so that their submit handlers run (without allow-forms the browser drops a
 * submission before its submit event; the CSP's form-action 'none' still stops it from going anywhere). No same-origin
 * access, popups, top navigation or downloads
 */
export const SANDBOX_FLAGS = 'allow-scripts allow-forms';
/** A shown page that does not answer for this long is stuck (an endless loop) and is removed */
const STUCK_MS = 5_000;
/** The sandbox page that has not announced itself after this long will not (it failed to load) */
const CONNECT_MS = 10_000;

export interface RunResult {
  logs: string[];
  /** The value the code returned, as text */
  result?: string;
  error?: string;
}

/** Wait for the sandbox page in a frame to announce itself, then hand it a private port */
function connect(frame: HTMLIFrameElement, signal?: AbortSignal): Promise<MessagePort> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || (e.data as { type?: string })?.type !== 'sandbox-ready') return;
      window.removeEventListener('message', onMessage);
      const ch = new MessageChannel();
      frame.contentWindow!.postMessage({ type: 'connect' }, '*', [ch.port2]);
      resolve(ch.port1);
    };
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', () => window.removeEventListener('message', onMessage), { once: true });
  });
}

/** A page of a site: its own path in the site ('index.html') and the site's files it may use, by path ('css/a.css') */
export interface SandboxPage {
  path: string;
  /** Text, or a Blob (images, media) */
  files: Record<string, string | Blob>;
  /** Its localStorage: the items it starts with (asked at each showing), and where its changes go (checked: STORAGE_LIMIT) */
  storage?: { items(): Record<string, string>; save(items: Record<string, string>): void };
  /** Experimental: what it may ask the app for (only a page the user shows; the page gets each as nbl.* or fetch) */
  api?: PageApi;
}

/**
 * Experimental (VITE_EXPERIMENTAL_PAGE_API): what a shown page may ask the app for. Each throws an Error whose
 * message the page gets. paths are inside the page's site ('data/a.json')
 */
export interface PageApi {
  /** A GET of an https address, through the fetch page (fetch(url) on the page) */
  fetch?(url: string, signal: AbortSignal): Promise<{ url: string; mime: string; data: ArrayBuffer }>;
  files?: {
    list(): Promise<string[]>;
    /** Text, a Blob for an image, null when there is no such file */
    read(path: string): Promise<string | Blob | null>;
    write(path: string, text: string): Promise<void>;
  };
  /** One answer of a model, with no tools */
  chat?(prompt: string, system: string | undefined, signal: AbortSignal): Promise<string>;
}

/** The calls a page with this api gets (sandbox/sandbox.html builds nbl from them) */
const apiNames = (api: PageApi) => [...(api.fetch ? ['fetch'] : []), ...(api.files ? ['files.list', 'files.read', 'files.write'] : []), ...(api.chat ? ['chat'] : [])];

/** Answer a page's call, checking what it sent before using it */
async function answerCall(port: MessagePort, api: PageApi, d: { id: number; name?: unknown; args?: unknown }, signal: AbortSignal) {
  const args = (d.args && typeof d.args === 'object' ? d.args : {}) as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof args[k] !== 'string') throw new Error(`${k} must be a string`);
    return args[k] as string;
  };
  try {
    if (d.name === 'fetch' && api.fetch) {
      const r = await api.fetch(str('url'), signal);
      return port.postMessage({ type: 'callResult', id: d.id, value: r }, [r.data]);
    }
    let value: unknown;
    if (d.name === 'files.list' && api.files) value = await api.files.list();
    else if (d.name === 'files.read' && api.files) value = await api.files.read(str('path'));
    else if (d.name === 'files.write' && api.files) value = await api.files.write(str('path'), str('text'));
    else if (d.name === 'chat' && api.chat) value = await api.chat(str('prompt'), typeof args.system === 'string' ? args.system : undefined, signal);
    else throw new Error(`${String(d.name)} is not available to this page`);
    port.postMessage({ type: 'callResult', id: d.id, value });
  } catch (e) {
    port.postMessage({ type: 'callResult', id: d.id, error: (e as Error).message || String(e) });
  }
}

/** A line of a shown page's console, or something that went wrong on it (sandbox/sandbox.html, watchPage) */
export interface PageLog {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'exception' | 'resource' | 'csp';
  text: string;
}
const LOG_LEVELS = new Set<string>(['log', 'info', 'warn', 'error', 'debug', 'exception', 'resource', 'csp']);

/** Log entries as the sandbox sent them, in their own shape only */
function cleanLogs(raw: unknown): PageLog[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => (e && LOG_LEVELS.has(e.level) && typeof e.text === 'string' ? [{ level: e.level, text: e.text.slice(0, 1000) }] : []));
}

/** Whether a log entry says something went wrong (shown to the user as an error) */
export const isProblem = (l: PageLog) => l.level === 'error' || l.level === 'exception' || l.level === 'resource' || l.level === 'csp';

/** Characters a page may keep in its localStorage (keys and values together): within a file's limit once saved as JSON */
export const STORAGE_LIMIT = 1_500_000;

/** A page's localStorage items as it sent them: strings only and within STORAGE_LIMIT, else null */
export function cleanStorage(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let chars = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') return null;
    chars += k.length + v.length;
    if (chars > STORAGE_LIMIT) return null;
  }
  return raw as Record<string, string>;
}

/**
 * Show html in a sandbox frame (call when the frame is created) and keep checking that the page answers; onStuck runs
 * when it stops answering, so the caller can remove the frame. With page, the html's references to the site's files
 * use those files (sandbox/rewrite.js), and its localStorage is the page's own. onLog gets its console output and
 * errors as they come. Returns a cleanup function
 */
export function renderInFrame(frame: HTMLIFrameElement, html: string, onStuck: () => void, page?: SandboxPage, onLog?: (logs: PageLog[]) => void): () => void {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  // A sandbox page that never announces itself (it failed to load) counts as stuck, rather than a blank frame
  const waiting = setTimeout(() => {
    ctrl.abort();
    onStuck();
  }, CONNECT_MS);
  void connect(frame, ctrl.signal).then((port) => {
    clearTimeout(waiting);
    if (ctrl.signal.aborted) return port.close();
    let last = Date.now();
    let n = 0;
    port.onmessage = (e) => {
      const d = e.data as { type?: string; items?: unknown; entries?: unknown; id?: unknown };
      if (d?.type === 'pong') last = Date.now();
      else if (d?.type === 'call' && typeof d.id === 'number' && page?.api) void answerCall(port, page.api, d as { id: number }, ctrl.signal);
      else if (d?.type === 'log') onLog?.(cleanLogs(d.entries));
      else if (d?.type === 'storage' && page?.storage) {
        // What the shown page sent: kept only in the shape storage has
        const items = cleanStorage(d.items);
        if (items) page.storage.save(items);
      }
    };
    // With page: path and files (Blobs go across without copying their bytes), the localStorage it starts with, and
    // the calls it may make
    port.postMessage({ type: 'render', html, ...(page ? { path: page.path, files: page.files, storage: page.storage?.items(), api: page.api && apiNames(page.api) } : {}) });
    timer = setInterval(() => {
      if (Date.now() - last <= STUCK_MS) return port.postMessage({ type: 'ping', n: ++n });
      clearInterval(timer);
      port.close();
      onStuck();
    }, 1000);
    // On the way out the page sends what it had not saved yet: the port stays open for that a moment
    ctrl.signal.addEventListener('abort', () => (clearInterval(timer), setTimeout(() => port.close(), 300)), { once: true });
  });
  return () => {
    clearTimeout(waiting);
    ctrl.abort();
  };
}

// ---- trying a page: shown in a hidden frame, its log and text read back ----
export interface PageInspection {
  logs: PageLog[];
  /** The text the page shows (document.body.innerText), cut at INSPECT_TEXT */
  text: string;
  /** What the script given returned, or the error it threw */
  scriptResult?: string;
  scriptError?: string;
  /** The page stopped answering (an endless loop, say) */
  stuck?: boolean;
  /** Where its key elements are, when asked for */
  layout?: PageLayout;
}
/** Characters of a tried page's text given back */
export const INSPECT_TEXT = 4000;

/** The size of a tried page's view: a desktop window */
export const INSPECT_VIEW = { width: 1024, height: 768 };

/** Where a tried page's key elements are, in CSS pixels of its view (scrolled to the top) */
export interface PageLayout {
  /** The whole page, scrolled or not */
  page: { width: number; height: number };
  boxes: LayoutBox[];
  /** Key elements past LAYOUT_BOXES, not listed */
  more: number;
}
export interface LayoutBox {
  /** The element's tag, with its id ('button#start') */
  name: string;
  /** Its text, alt text or image file, shortened; a canvas's drawing size */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Not drawn (display, visibility, opacity, no size), or drawn outside the view */
  hidden?: 'hidden' | 'outside';
}
/** Key elements listed at most */
const LAYOUT_BOXES = 30;

/**
 * Run on a tried page: its key elements (headings, buttons, form fields, images, canvases, those with an id), in
 * document order, with their boxes
 */
const LAYOUT_CODE = `const all = [...document.querySelectorAll('[id], h1, h2, h3, h4, h5, h6, button, input, select, textarea, img, canvas, video, svg')].filter((el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg');
const short = (s) => { s = String(s || '').replace(/\\s+/g, ' ').trim(); return s.length > 40 ? s.slice(0, 40) + '…' : s; };
const boxes = all.slice(0, ${LAYOUT_BOXES}).map((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const tag = el.tagName.toLowerCase();
  const label = tag === 'img' ? el.getAttribute('alt') || el.getAttribute('src') : tag === 'canvas' ? el.width + '×' + el.height + ' px drawing' : tag === 'input' || tag === 'select' || tag === 'textarea' ? el.getAttribute('placeholder') || el.value || el.type : el.innerText || el.getAttribute('aria-label');
  const hidden = !r.width || !r.height || cs.visibility !== 'visible' || Number(cs.opacity) === 0 ? 'hidden' : r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight ? 'outside' : undefined;
  return { name: tag + (el.id ? '#' + el.id : ''), label: short(label), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), hidden };
});
const root = document.scrollingElement || document.documentElement;
return { page: { width: root.scrollWidth, height: root.scrollHeight }, boxes, more: Math.max(0, all.length - boxes.length) };`;

/** A layout as the page sent it, in its own shape only (the page may have changed anything it runs with) */
function cleanLayout(raw: string | undefined): PageLayout | undefined {
  try {
    const v = JSON.parse(raw ?? '') as { page?: { width?: unknown; height?: unknown }; boxes?: unknown; more?: unknown };
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
    const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, 60) : '');
    const boxes = (Array.isArray(v.boxes) ? v.boxes.slice(0, LAYOUT_BOXES) : []).map((b: Record<string, unknown>): LayoutBox => ({
      name: str(b?.name),
      label: str(b?.label),
      x: num(b?.x),
      y: num(b?.y),
      width: num(b?.width),
      height: num(b?.height),
      ...(b?.hidden === 'hidden' || b?.hidden === 'outside' ? { hidden: b.hidden } : {})
    }));
    return { page: { width: num(v.page?.width), height: num(v.page?.height) }, boxes, more: num(v.more) };
  } catch {
    return undefined;
  }
}

/**
 * Show a page in a hidden sandbox frame (its localStorage only in memory, nothing saved), wait `waitMs`, run `script`
 * on it if given, and read back its log, the text it shows and, with layout, where its key elements are. The frame is
 * removed afterwards
 */
export async function inspectPage(
  html: string,
  page: SandboxPage | undefined,
  { waitMs, script, layout, signal }: { waitMs: number; script?: string; layout?: boolean; signal?: AbortSignal }
): Promise<PageInspection> {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX_FLAGS);
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  // Laid out at a desktop size, out of sight: what the page shows depends on its size
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${INSPECT_VIEW.width}px;height:${INSPECT_VIEW.height}px;border:0;visibility:hidden`;
  const giveUp = new AbortController();
  const ports = connect(f, giveUp.signal);
  f.src = SANDBOX_URL;
  document.body.append(f);
  const logs: PageLog[] = [];
  const answers = new Map<string, (r: { result?: string; error?: string }) => void>();
  try {
    const port = await Promise.race([ports, sleep(RUN_TIMEOUT_MS, signal).then(() => null)]);
    if (!port) {
      giveUp.abort();
      return { logs, text: '', stuck: true };
    }
    port.onmessage = (e) => {
      const d = e.data as { type?: string; id?: string; entries?: unknown; result?: unknown; error?: unknown };
      if (d?.type === 'log') logs.push(...cleanLogs(d.entries));
      else if (d?.type === 'evalResult' && typeof d.id === 'string')
        answers.get(d.id)?.({ result: typeof d.result === 'string' ? d.result : undefined, error: typeof d.error === 'string' ? d.error : undefined });
    };
    /** Run code on the page; null when it does not answer within `ms` (the page is stuck) */
    const evalIn = (code: string, ms: number) =>
      Promise.race([
        new Promise<{ result?: string; error?: string }>((resolve) => {
          const id = crypto.randomUUID();
          answers.set(id, resolve);
          port.postMessage({ type: 'eval', id, code });
        }),
        sleep(ms).then(() => null)
      ]);
    port.postMessage({ type: 'render', html, ...(page ? { path: page.path, files: page.files, storage: page.storage?.items() } : {}) });
    await sleep(waitMs, signal);
    const ran = script ? await evalIn(script, 5000) : undefined;
    if (ran === null) return { logs, text: '', stuck: true };
    // Changes the script made, and logs it caused, have a moment to show
    if (script) await sleep(300);
    const shown = await evalIn('return document.body ? document.body.innerText : ""', 2000);
    if (shown === null) return { logs, text: '', stuck: true, scriptResult: ran?.result, scriptError: ran?.error };
    const boxes = layout ? await evalIn(LAYOUT_CODE, 2000) : undefined;
    // The last logs go out at most 0.2 s after they happen
    await sleep(250);
    return { logs, text: (shown.result ?? '').slice(0, INSPECT_TEXT), scriptResult: ran?.result, scriptError: ran?.error, ...(boxes ? { layout: cleanLayout(boxes.result) } : {}) };
  } finally {
    f.remove();
  }
}

/** Wait ms (a stop given ends the wait at once) */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    const timer = setTimeout(r, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), r()), { once: true });
  });

// ---- running code: hidden sandbox frames, jobs answered by id over their ports ----
// Worker runs share one frame (each worker is stopped after its run). A run on the page itself (dom) gets a frame of
// its own that is removed afterwards: code there could change the page for every later run
interface Hidden {
  frame: HTMLIFrameElement;
  port: Promise<MessagePort>;
}
let shared: Hidden | null = null;
const pending = new Map<string, (r: RunResult) => void>();

/** Drop the shared frame (stuck past its time limit); the next run makes a fresh one */
function resetShared() {
  shared?.frame.remove();
  shared = null;
}

function hiddenFrame(): Hidden {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX_FLAGS);
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  const port = connect(f).then((port) => {
    port.onmessage = (e) => {
      const d = e.data as { type?: string; id?: string } & RunResult;
      if (d?.type !== 'result' || typeof d.id !== 'string') return;
      pending.get(d.id)?.({
        logs: Array.isArray(d.logs) ? d.logs.map(String) : [],
        result: typeof d.result === 'string' ? d.result : undefined,
        error: typeof d.error === 'string' ? d.error : undefined
      });
      pending.delete(d.id);
    };
    return port;
  });
  f.src = SANDBOX_URL;
  document.body.append(f);
  return { frame: f, port };
}

export const RUN_TIMEOUT_MS = 10_000;

export interface RunOptions {
  /** Text files the code reads as `files` ({ name: text }) */
  files?: Record<string, string>;
  /** Run on the sandbox page instead of a worker, so the code has DOMParser (stopped by removing the frame) */
  dom?: boolean;
}

/** Run JavaScript in the sandbox: no requests, no access to the app, stopped after RUN_TIMEOUT_MS */
export async function runJavaScript(code: string, { files = {}, dom = false }: RunOptions = {}): Promise<RunResult> {
  const own = dom ? hiddenFrame() : null;
  const h = own ?? (shared ??= hiddenFrame());
  const port = await h.port;
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    // A worker is stopped by the sandbox itself; code on the page (dom) is stopped by dropping the frame
    const limit = dom ? RUN_TIMEOUT_MS : RUN_TIMEOUT_MS + 2000;
    const guard = setTimeout(() => {
      pending.delete(id);
      if (own) own.frame.remove();
      else resetShared();
      resolve({ logs: [], error: `Stopped: no answer within ${limit} ms.` });
    }, limit);
    pending.set(id, (r) => {
      clearTimeout(guard);
      own?.frame.remove();
      resolve(r);
    });
    port.postMessage({ type: 'run', id, code, files, dom, timeoutMs: RUN_TIMEOUT_MS });
  });
}

/** A run's output as plain text (console lines, then the returned value or the error) */
export function runText(r: RunResult): string {
  return [...r.logs, ...(r.result !== undefined ? [`→ ${r.result}`] : []), ...(r.error ? [`Error: ${r.error}`] : [])].join('\n');
}
