// The app's side of the sandbox (sandbox/sandbox.html): an <iframe sandbox="allow-scripts"> with no origin of its own
// and a CSP that blocks every request. The page announces itself once on the window; from then on the app talks to
// it over a private MessagePort, so whatever the shown HTML posts on the window is never listened to.

export const SANDBOX_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}sandbox/`;
/** Only scripts may run: no same-origin access, no popups, forms, top navigation or downloads */
export const SANDBOX_FLAGS = 'allow-scripts';
/** A shown page that does not answer for this long is stuck (an endless loop) and is removed */
const STUCK_MS = 5_000;

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

/** A page of a project: its own path ('site/index.html') and the project files it may use, by path ('site/css/a.css') */
export interface SandboxPage {
  path: string;
  /** Text, or a Blob (images, media) */
  files: Record<string, string | Blob>;
}

/**
 * Show html in a sandbox frame (call when the frame is created) and keep checking that the page answers; onStuck runs
 * when it stops answering, so the caller can remove the frame. With page, the html's references to the project's files
 * use those files (sandbox/rewrite.js). Returns a cleanup function
 */
export function renderInFrame(frame: HTMLIFrameElement, html: string, onStuck: () => void, page?: SandboxPage): () => void {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  void connect(frame, ctrl.signal).then((port) => {
    if (ctrl.signal.aborted) return port.close();
    let last = Date.now();
    let n = 0;
    port.onmessage = (e) => {
      if ((e.data as { type?: string })?.type === 'pong') last = Date.now();
    };
    // With page: path and files (Blobs go across without copying their bytes)
    port.postMessage({ type: 'render', html, ...page });
    timer = setInterval(() => {
      if (Date.now() - last <= STUCK_MS) return port.postMessage({ type: 'ping', n: ++n });
      clearInterval(timer);
      port.close();
      onStuck();
    }, 1000);
    ctrl.signal.addEventListener('abort', () => (clearInterval(timer), port.close()), { once: true });
  });
  return () => ctrl.abort();
}

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

/** How long a run may take */
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
