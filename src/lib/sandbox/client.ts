// The app's side of the sandbox (sandbox/sandbox.html): an <iframe sandbox="allow-scripts"> with no origin of its own
// and a CSP that blocks every request. The page announces itself once on the window; from then on the app talks to
// it over a private MessagePort, so whatever the shown HTML posts on the window is never listened to.

export const SANDBOX_URL = '/sandbox/';
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

/**
 * Show html in a sandbox frame (call when the frame is created) and keep checking that the page answers; onStuck runs
 * when it stops answering, so the caller can remove the frame. Returns a cleanup function
 */
export function renderInFrame(frame: HTMLIFrameElement, html: string, onStuck: () => void): () => void {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  void connect(frame, ctrl.signal).then((port) => {
    if (ctrl.signal.aborted) return port.close();
    let last = Date.now();
    let n = 0;
    port.onmessage = (e) => {
      if ((e.data as { type?: string })?.type === 'pong') last = Date.now();
    };
    port.postMessage({ type: 'render', html });
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

// ---- running code: one hidden sandbox frame, jobs answered by id over its port ----
let hidden: { frame: HTMLIFrameElement; port: Promise<MessagePort> } | null = null;
const pending = new Map<string, (r: RunResult) => void>();

/** Drop the hidden frame (stuck in code run on its page); the next run makes a fresh one */
function resetHidden() {
  hidden?.frame.remove();
  hidden = null;
}

function hiddenPort(): Promise<MessagePort> {
  if (hidden) return hidden.port;
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
  hidden = { frame: f, port };
  f.src = SANDBOX_URL;
  document.body.append(f);
  return port;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Text files the code reads as `files` ({ name: text }) */
  files?: Record<string, string>;
  /** Run on the sandbox page instead of a worker, so the code has DOMParser (stopped by removing the frame) */
  dom?: boolean;
}

/** Run JavaScript in the sandbox: no network, no access to the app, stopped after timeoutMs */
export async function runJavaScript(code: string, { timeoutMs = 10_000, files = {}, dom = false }: RunOptions = {}): Promise<RunResult> {
  const port = await hiddenPort();
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    // A worker is stopped by the sandbox itself; code on the page (dom) is stopped by dropping the frame
    const limit = dom ? timeoutMs : timeoutMs + 2000;
    const guard = setTimeout(() => {
      pending.delete(id);
      resetHidden();
      resolve({ logs: [], error: `Stopped: no answer within ${limit} ms.` });
    }, limit);
    pending.set(id, (r) => {
      clearTimeout(guard);
      resolve(r);
    });
    port.postMessage({ type: 'run', id, code, files, dom, timeoutMs });
  });
}

/** A run's output as plain text (console lines, then the returned value or the error) */
export function runText(r: RunResult): string {
  return [...r.logs, ...(r.result !== undefined ? [`→ ${r.result}`] : []), ...(r.error ? [`Error: ${r.error}`] : [])].join('\n');
}
