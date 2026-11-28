import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageApi, PageLog, RunResult } from './client';

// The app's side of the sandbox, against stand-ins for the sandbox frame: the frame announces itself on the window, the
// app hands it a private port, and from then on only that port is listened to.
interface Sandbox {
  /** What the app sent over the port */
  got: any[];
  send(m: unknown): void;
  /** Called for each message the app sends */
  onMessage?: (m: any, s: Sandbox) => void;
}
let sandboxes: Sandbox[];
let ports: MessagePort[];
/** How a sandbox made from now on answers */
let respond: Sandbox['onMessage'];

function frame() {
  const f = {
    removed: false,
    style: {},
    setAttribute() {},
    remove: () => void (f.removed = true),
    contentWindow: {
      postMessage(m: { type: string }, _origin: string, [port]: MessagePort[]) {
        expect(m).toEqual({ type: 'connect' });
        ports.push(port);
        const s: Sandbox = { got: [], send: (x) => port.postMessage(x), onMessage: respond };
        port.onmessage = (e) => {
          s.got.push(e.data);
          s.onMessage?.(e.data, s);
        };
        sandboxes.push(s);
      }
    }
  };
  return f;
}
type Frame = ReturnType<typeof frame>;

/** A message on the app's window, from `source` */
function post(source: unknown, data: unknown) {
  window.dispatchEvent(Object.assign(new Event('message'), { source, data }));
}
const announce = (f: Frame) => post(f.contentWindow, { type: 'sandbox-ready' });
/** Let messages on the ports go across */
const flush = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

let frames: Frame[];
async function load() {
  vi.resetModules();
  return import('./client');
}

beforeEach(() => {
  sandboxes = [];
  ports = [];
  frames = [];
  respond = undefined;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => {
      const f = frame();
      frames.push(f);
      return f;
    },
    // The sandbox page loads and announces itself
    body: { append: (f: Frame) => queueMicrotask(() => announce(f)) }
  });
});
afterEach(() => {
  for (const p of ports) p.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('showing a page in the sandbox', () => {
  it('listens only to the sandbox page itself, not to what a shown page posts on the window', async () => {
    const { renderInFrame } = await load();
    const f = frame();
    const stop = renderInFrame(f as unknown as HTMLIFrameElement, '<p>hi</p>', () => {});
    // Something else (the shown page, another frame) claiming to be the sandbox gets no port
    post({}, { type: 'sandbox-ready' });
    post(f.contentWindow, { type: 'something-else' });
    await flush();
    expect(sandboxes).toHaveLength(0);

    announce(f);
    await vi.waitFor(() => expect(sandboxes[0]?.got[0]).toEqual({ type: 'render', html: '<p>hi</p>' }));
    stop();
  });

  it('answers the calls a page may make, checks what it sent, and refuses the rest', async () => {
    const { renderInFrame } = await load();
    const read = vi.fn(async (path: string) => (path === 'boom.txt' ? Promise.reject(new Error('cannot read')) : `text of ${path}`));
    const api: PageApi = { files: { list: async () => ['a.txt'], read, write: async () => {} } };
    const f = frame();
    const stop = renderInFrame(f as unknown as HTMLIFrameElement, '', () => {}, { path: 'index.html', files: {}, api });
    announce(f);
    await vi.waitFor(() => expect(sandboxes[0]?.got[0]).toMatchObject({ type: 'render', path: 'index.html', api: ['files.list', 'files.read', 'files.write'] }));

    const s = sandboxes[0];
    s.send({ type: 'call', id: 1, name: 'files.read', args: { path: 'a.txt' } });
    s.send({ type: 'call', id: 2, name: 'files.read', args: { path: 5 } });
    s.send({ type: 'call', id: 3, name: 'chat', args: { prompt: 'hi' } });
    s.send({ type: 'call', id: 4, name: 'files.read', args: { path: 'boom.txt' } });
    s.send({ type: 'call', id: '5', name: 'files.list' });
    await vi.waitFor(() => expect(s.got.filter((m) => m.type === 'callResult')).toHaveLength(4));
    await flush();
    const results = Object.fromEntries(s.got.filter((m) => m.type === 'callResult').map(({ id, ...r }) => [id, r]));
    expect(results).toEqual({
      1: { type: 'callResult', value: 'text of a.txt' },
      2: { type: 'callResult', error: 'path must be a string' },
      3: { type: 'callResult', error: 'chat is not available to this page' },
      4: { type: 'callResult', error: 'cannot read' }
    });
    expect(read).not.toHaveBeenCalledWith(5);
    stop();
  });

  it('gives a page without calls no answer to them', async () => {
    const { renderInFrame } = await load();
    const f = frame();
    const stop = renderInFrame(f as unknown as HTMLIFrameElement, '', () => {}, { path: 'index.html', files: {} });
    announce(f);
    await vi.waitFor(() => expect(sandboxes[0]?.got).toHaveLength(1));
    sandboxes[0].send({ type: 'call', id: 1, name: 'files.list' });
    await flush();
    expect(sandboxes[0].got.filter((m) => m.type === 'callResult')).toEqual([]);
    stop();
  });

  it('passes on console lines and saved storage only in their own shape', async () => {
    const { renderInFrame, STORAGE_LIMIT } = await load();
    const logs: PageLog[][] = [];
    const save = vi.fn();
    const f = frame();
    const stop = renderInFrame(f as unknown as HTMLIFrameElement, '', () => {}, { path: 'index.html', files: {}, storage: { items: () => ({ theme: 'dark' }), save } }, (l) => logs.push(l));
    announce(f);
    await vi.waitFor(() => expect(sandboxes[0]?.got[0]).toMatchObject({ storage: { theme: 'dark' } }));
    const s = sandboxes[0];
    s.send({ type: 'log', entries: [{ level: 'log', text: 'x'.repeat(2000) }, { level: 'alert', text: 'odd level' }, { level: 'error', text: 5 }, null, { level: 'csp', text: 'blocked' }] });
    s.send({ type: 'storage', items: { a: '1' } });
    s.send({ type: 'storage', items: { a: 1 } });
    s.send({ type: 'storage', items: { big: 'x'.repeat(STORAGE_LIMIT + 1) } });
    s.send({ type: 'storage', items: ['a'] });
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    await flush();
    expect(logs[0]).toEqual([
      { level: 'log', text: 'x'.repeat(1000) },
      { level: 'csp', text: 'blocked' }
    ]);
    expect(save.mock.calls).toEqual([[{ a: '1' }]]);
    stop();
  });

  it('removes a page that stops answering, and one whose sandbox never loads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { renderInFrame } = await load();
    const f = frame();
    const stuck = vi.fn();
    const stop = renderInFrame(f as unknown as HTMLIFrameElement, '', stuck);
    announce(f);
    await vi.waitFor(() => expect(sandboxes).toHaveLength(1));
    // Answering each check keeps it shown
    sandboxes[0].onMessage = (m, s) => m.type === 'ping' && s.send({ type: 'pong', n: m.n });
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      await flush();
    }
    expect(stuck).not.toHaveBeenCalled();
    // An endless loop: no more answers
    sandboxes[0].onMessage = undefined;
    await vi.advanceTimersByTimeAsync(7000);
    expect(stuck).toHaveBeenCalledOnce();
    stop();

    const never = vi.fn();
    renderInFrame(frame() as unknown as HTMLIFrameElement, '', never);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(never).toHaveBeenCalledOnce();
    // Closed before it loads: nothing more happens
    const closed = vi.fn();
    renderInFrame(frame() as unknown as HTMLIFrameElement, '', closed)();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('trying a page in the sandbox', () => {
  it('starts it with the page\'s localStorage, or an empty one with freshStorage, and reads back its text', async () => {
    const { inspectPage } = await load();
    respond = (m, s) => m.type === 'eval' && s.send({ type: 'evalResult', id: m.id, result: 'shown text' });
    const page = { path: 'index.html', files: {}, storage: { items: () => ({ best: '9' }), save() {} } };
    const kept = await inspectPage('<p>hi</p>', page, { waitMs: 0 });
    const fresh = await inspectPage('<p>hi</p>', page, { waitMs: 0, freshStorage: true });
    expect(kept.text).toBe('shown text');
    expect(sandboxes[0].got[0]).toMatchObject({ type: 'render', storage: { best: '9' } });
    expect(sandboxes[1].got[0].type).toBe('render');
    expect(sandboxes[1].got[0].storage).toBeUndefined();
    expect(fresh.text).toBe('shown text');
    expect(frames.every((f) => f.removed)).toBe(true);
  });
});

describe('running code in the sandbox', () => {
  it('sends the code and its files, and gives back the output in its own shape only', async () => {
    const { runJavaScript, runText } = await load();
    let run: any;
    respond = (m, s) => {
      run = m;
      s.send({ type: 'result', id: 'someone-else', logs: ['not mine'] });
      s.send({ type: 'result', id: m.id, logs: [1, 'line'], result: 42, error: 'boom' });
    };
    const r: RunResult = await runJavaScript('return 1', { files: { 'a.csv': 'x,y' } });
    expect(run).toMatchObject({ type: 'run', code: 'return 1', files: { 'a.csv': 'x,y' }, dom: false });
    expect(r).toEqual({ logs: ['1', 'line'], result: undefined, error: 'boom' });
    expect(runText({ logs: ['a'], result: '2' })).toBe('a\n→ 2');
    expect(runText(r)).toBe('1\nline\nError: boom');
    // Worker runs share one frame
    expect(frames).toHaveLength(1);
    expect(frames[0].removed).toBe(false);
  });

  it('runs code on the page in a frame of its own, removed afterwards', async () => {
    const { runJavaScript } = await load();
    respond = (m, s) => s.send({ type: 'result', id: m.id, logs: [], result: 't' });
    expect(await runJavaScript('return document.title', { dom: true })).toEqual({ logs: [], result: 't', error: undefined });
    expect(frames[0].removed).toBe(true);
  });

  it('stops a run with no answer after its time limit, and gives the next run a fresh sandbox', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runJavaScript, RUN_TIMEOUT_MS } = await load();
    const p = runJavaScript('while (true) {}');
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 2000);
    expect((await p).error).toBe(`Stopped: no answer within ${RUN_TIMEOUT_MS + 2000} ms.`);
    expect(frames[0].removed).toBe(true);

    void runJavaScript('return 1');
    await vi.waitFor(() => expect(frames).toHaveLength(2));
  });

  it('stops a run when asked, with what it logged until then as the sandbox answers the stop', async () => {
    const { runJavaScript } = await load();
    respond = (m, s) => m.type === 'stop' && s.send({ type: 'result', id: m.id, logs: ['so far'], result: 'not a result', stopped: 'user' });
    const ctrl = new AbortController();
    const p = runJavaScript('console.log("so far"); while (true) {}', { signal: ctrl.signal });
    await vi.waitFor(() => expect(sandboxes[0]?.got[0]?.type).toBe('run'));
    ctrl.abort();
    expect(await p).toEqual({ logs: ['so far'], result: undefined, error: 'Stopped by the user.' });
    expect(sandboxes[0].got[1]).toEqual({ type: 'stop', id: sandboxes[0].got[0].id });
    // The shared frame stays for the next run
    expect(frames[0].removed).toBe(false);
  });

  it('gives the time limit as the error of a run stopped by it, with what it logged', async () => {
    const { runJavaScript } = await load();
    respond = (m, s) => s.send({ type: 'result', id: m.id, logs: ['started'], stopped: 'time' });
    expect(await runJavaScript('while (true) {}')).toEqual({ logs: ['started'], result: undefined, error: 'Stopped after 10 s.' });
  });

  it('takes a stop the sandbox does not answer as stopped with nothing printed, after a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runJavaScript } = await load();
    const ctrl = new AbortController();
    const p = runJavaScript('while (true) {}', { signal: ctrl.signal });
    await vi.waitFor(() => expect(sandboxes[0]?.got[0]?.type).toBe('run'));
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ logs: [], result: undefined, error: 'Stopped by the user.' });
  });

  it('stops code on the page by removing its frame, and one stopped before it starts is never sent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runJavaScript, RUN_TIMEOUT_MS } = await load();
    const p = runJavaScript('while (true) {}', { dom: true });
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);
    expect(await p).toEqual({ logs: [], result: undefined, error: 'Stopped after 10 s.' });
    expect(frames[0].removed).toBe(true);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await runJavaScript('return 1', { signal: ctrl.signal })).toEqual({ logs: [], result: undefined, error: 'Stopped by the user.' });
    expect(sandboxes.slice(1).every((s) => s.got.length === 0)).toBe(true);
  });
});

describe('running a skill\'s script in the sandbox', () => {
  const job = { main: '/skill/a.js', args: ['x'], cwd: '/work', files: { '/skill/a.js': 'console.log(1)' }, readOnly: ['/skill'], libraries: {}, libraryNames: [] };
  it('sends the job, and takes back its result in its own shape only', async () => {
    const { runScript } = await load();
    let got: any;
    respond = (m, s) => {
      got = m;
      s.send({ type: 'scriptResult', id: m.id, code: 2, stdout: 'out', stderr: 5, stdoutChars: 3, written: { '/work/a.txt': 'A', '/work/b.bin': new Uint8Array([1]), 'relative.txt': 'no', '/work/c': { not: 'data' } } });
    };
    const r = await runScript(job);
    expect(got).toMatchObject({ type: 'script', job, timeoutMs: 10_000 });
    expect(r).toEqual({ code: 2, stdout: 'out', stderr: '', stdoutChars: 3, stderrChars: 0, written: { '/work/a.txt': 'A', '/work/b.bin': new Uint8Array([1]) } });
  });

  it('gives what stopped it with what it printed until then, and none of what it wrote', async () => {
    const { runScript } = await load();
    respond = (m, s) => {
      if (m.type === 'script') s.send({ type: 'scriptResult', id: m.id, stdout: 'so far', stderr: 'warned', written: { '/work/a.txt': 'half' }, stopped: 'time' });
    };
    expect(await runScript(job)).toEqual({ code: 1, stdout: 'so far', stderr: 'warned', stdoutChars: 6, stderrChars: 6, written: {}, stopped: 'time' });
    // Worker runs share the frame: it answers from now on like this
    sandboxes[0].onMessage = (m, s) => {
      if (m.type === 'stop') s.send({ type: 'scriptResult', id: m.id, stdout: 'until the stop', stopped: 'user' });
    };
    const ctrl = new AbortController();
    const p = runScript(job, ctrl.signal);
    await vi.waitFor(() => expect(sandboxes[0].got.length).toBe(2));
    ctrl.abort();
    expect(await p).toMatchObject({ stdout: 'until the stop', stopped: 'user' });
    expect(sandboxes[0].got.at(-1)).toEqual({ type: 'stop', id: sandboxes[0].got[1].id });
    // The sandbox failed: told as an error, with what it printed
    sandboxes[0].onMessage = (m, s) => s.send({ type: 'scriptResult', id: m.id, stdout: 'x', error: 'Out of memory' });
    expect(await runScript(job)).toEqual({ code: 1, stdout: 'x', stderr: '', stdoutChars: 1, stderrChars: 0, written: {}, error: 'Out of memory' });
  });
});
