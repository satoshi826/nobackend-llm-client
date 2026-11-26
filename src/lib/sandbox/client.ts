// The app's side of the sandbox (sandbox/sandbox.html): an <iframe sandbox="allow-scripts"> with no origin of its own
// and a CSP that blocks every request. Messages from it are untrusted; only its own frame is listened to.

export const SANDBOX_URL = '/sandbox/';
/** Only scripts may run: no same-origin access, no popups, forms, top navigation or downloads */
export const SANDBOX_FLAGS = 'allow-scripts';

export interface RunResult {
  logs: string[];
  /** The value the code returned, as text */
  result?: string;
  error?: string;
}

/** Show html in a sandbox frame (call when the frame is created; the html is sent once the page is ready) */
export function renderInFrame(frame: HTMLIFrameElement, html: string): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || (e.data as { type?: string })?.type !== 'sandbox-ready') return;
    frame.contentWindow!.postMessage({ type: 'render', html }, '*');
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

// ---- running code: one hidden sandbox frame, jobs answered by id ----
let hidden: Promise<HTMLIFrameElement> | null = null;
const pending = new Map<string, (r: RunResult) => void>();

function hiddenFrame(): Promise<HTMLIFrameElement> {
  if (hidden) return hidden;
  hidden = new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', SANDBOX_FLAGS);
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    window.addEventListener('message', (e) => {
      if (e.source !== f.contentWindow) return;
      const d = e.data as { type?: string; id?: string } & RunResult;
      if (d?.type === 'sandbox-ready') resolve(f);
      else if (d?.type === 'result' && typeof d.id === 'string') {
        pending.get(d.id)?.({
          logs: Array.isArray(d.logs) ? d.logs.map(String) : [],
          result: typeof d.result === 'string' ? d.result : undefined,
          error: typeof d.error === 'string' ? d.error : undefined
        });
        pending.delete(d.id);
      }
    });
    f.src = SANDBOX_URL;
    document.body.append(f);
  });
  return hidden;
}

/** Run JavaScript in the sandbox (a worker there): no network, no access to the app, stopped after timeoutMs */
export async function runJavaScript(code: string, timeoutMs = 10_000): Promise<RunResult> {
  const f = await hiddenFrame();
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    // The sandbox stops the worker itself; this only covers a sandbox that never answers
    const guard = setTimeout(() => {
      pending.delete(id);
      resolve({ logs: [], error: `No answer from the sandbox within ${timeoutMs + 2000} ms.` });
    }, timeoutMs + 2000);
    pending.set(id, (r) => {
      clearTimeout(guard);
      resolve(r);
    });
    f.contentWindow!.postMessage({ type: 'run', id, code, timeoutMs }, '*');
  });
}

/** A run's output as plain text (console lines, then the returned value or the error) */
export function runText(r: RunResult): string {
  return [...r.logs, ...(r.result !== undefined ? [`→ ${r.result}`] : []), ...(r.error ? [`Error: ${r.error}`] : [])].join('\n');
}
