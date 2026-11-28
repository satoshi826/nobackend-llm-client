import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromVault, ToVault } from './protocol';
import { VAULT_PROTOCOL } from './protocol';
import { t } from './messages';

// The app side of the key vault, against a stand-in for the vault frame: the client places an iframe, hands it a port
// on load, and talks over that port. `answer` plays the vault for each message the app sends.
type Vault = { send(m: FromVault): void; sent: ToVault[] };
let answer: (m: ToVault, v: Vault) => void;
/** What the vault says when the app connects: its first status, or that it speaks another version */
let greeting: (v: Vault) => void;
let frames: { removed: boolean }[];
let ports: MessagePort[];

function fakeDocument() {
  return {
    createElement: () => {
      const listeners: Record<string, () => void> = {};
      const frame = {
        removed: false,
        style: {},
        setAttribute() {},
        addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
        remove: () => (frame.removed = true),
        contentWindow: {
          postMessage(m: { type: string; protocol: string }, _origin: string, [port]: MessagePort[]) {
            expect(m).toEqual({ type: 'connect', protocol: VAULT_PROTOCOL });
            ports.push(port);
            const v: Vault = { send: (x) => port.postMessage(x), sent: [] };
            port.onmessage = (e) => {
              v.sent.push(e.data);
              answer(e.data, v);
            };
            greeting(v);
          }
        },
        load: () => listeners.load?.()
      };
      frames.push(frame);
      return frame;
    },
    body: { appendChild: (f: { load(): void }) => queueMicrotask(() => f.load()) }
  };
}

const READY: FromVault = { type: 'status', providers: {}, vault: { hasPassphrase: false, locked: false, passphraseId: null } };

/** A fresh client (the connection is one per page), with the failure class of that module graph */
async function load() {
  vi.resetModules();
  return { ...(await import('./client')), ProviderFailure: (await import('../providers/errors')).ProviderFailure };
}

beforeEach(() => {
  frames = [];
  ports = [];
  answer = () => {};
  greeting = (v) => v.send(READY);
  vi.stubGlobal('location', { origin: 'https://app.test', reload() {} });
  vi.stubGlobal('document', fakeDocument());
});
afterEach(() => {
  for (const p of ports) p.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const URL_ = 'https://api.venice.ai/api/v1/chat/completions';
const enc = (s: string) => new TextEncoder().encode(s);

describe('sending a request through the key vault', () => {
  it('asks the vault to send it with the provider’s key, and reads the answer as it streams in', async () => {
    let fetchMsg: ToVault | undefined;
    answer = (m, v) => {
      if (m.type !== 'fetch') return;
      fetchMsg = m;
      v.send({ type: 'head', id: m.id, status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] });
      v.send({ type: 'chunk', id: m.id, chunk: enc('data: a\n\n') });
      v.send({ type: 'chunk', id: m.id, chunk: enc('data: b\n\n') });
      v.send({ type: 'end', id: m.id });
    };
    const { vault } = await load();
    const res = await vault.fetch('venice', URL_, { method: 'post', headers: { 'Content-Type': 'application/json' }, body: '{"x":1}' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toBe('data: a\n\ndata: b\n\n');
    expect(fetchMsg).toMatchObject({ type: 'fetch', providerId: 'venice', url: URL_, method: 'POST', headers: [['content-type', 'application/json']], body: '{"x":1}' });
  });

  it('gives an answer without a body (204) as one with no body', async () => {
    answer = (m, v) => {
      if (m.type === 'fetch') v.send({ type: 'head', id: m.id, status: 204, statusText: 'No Content', headers: [] });
    };
    const { vault } = await load();
    const res = await vault.fetch('venice', URL_, { method: 'GET' });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('fails with the vault’s kind of failure before the answer starts, and fails the reading after it started', async () => {
    let n = 0;
    answer = (m, v) => {
      if (m.type !== 'fetch') return;
      if (n++ === 0) return v.send({ type: 'error', id: m.id, kind: 'auth', message: 'no key' });
      v.send({ type: 'head', id: m.id, status: 200, statusText: 'OK', headers: [] });
      v.send({ type: 'chunk', id: m.id, chunk: enc('part') });
      v.send({ type: 'error', id: m.id, kind: 'network', message: 'cut off' });
    };
    const { vault, ProviderFailure } = await load();
    const err = await vault.fetch('venice', URL_, { method: 'POST', body: '{}' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderFailure);
    expect(err.error).toMatchObject({ kind: 'auth', message: 'no key' });

    const res = await vault.fetch('venice', URL_, { method: 'POST', body: '{}' });
    const read = await res.text().catch((e) => e);
    expect(read).toBeInstanceOf(ProviderFailure);
    expect(read.error).toMatchObject({ kind: 'network', message: 'cut off' });
  });

  it('tells the vault to stop when the user stops, and ends as a stop rather than an error', async () => {
    answer = (m, v) => {
      if (m.type === 'abort') v.send({ type: 'error', id: m.id, kind: 'aborted', message: '' });
    };
    const { vault } = await load();
    const ctrl = new AbortController();
    const p = vault.fetch('venice', URL_, { method: 'POST', body: '{}', signal: ctrl.signal });
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe('AbortError');
  });

  it('drops what the vault still sends after the reader stopped reading, and tells the vault to stop', async () => {
    let more!: () => void;
    const seen: ToVault[] = [];
    answer = (m, v) => {
      seen.push(m);
      if (m.type !== 'fetch') return;
      v.send({ type: 'head', id: m.id, status: 200, statusText: 'OK', headers: [] });
      v.send({ type: 'chunk', id: m.id, chunk: enc('a') });
      more = () => {
        v.send({ type: 'chunk', id: m.id, chunk: enc('b') });
        v.send({ type: 'end', id: m.id });
      };
    };
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.on('uncaughtException', onError);
    try {
      const { vault } = await load();
      const reader = (await vault.fetch('venice', URL_, { method: 'POST', body: '{}' })).body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('a');
      await reader.cancel();
      more();
      await new Promise((r) => setTimeout(r, 10));
      expect(errors).toEqual([]);
      expect(seen.map((m) => m.type)).toEqual(['fetch', 'abort']);
    } finally {
      process.off('uncaughtException', onError);
    }
  });

  it('sends nothing for a request already stopped, a method other than GET / POST, or a body that is not text', async () => {
    const seen: ToVault[] = [];
    answer = (m) => void seen.push(m);
    const { vault } = await load();
    const stopped = AbortSignal.abort();
    expect((await vault.fetch('venice', URL_, { method: 'POST', body: '{}', signal: stopped }).catch((e) => e)).name).toBe('AbortError');
    const del = await vault.fetch('venice', URL_, { method: 'DELETE' }).catch((e) => e);
    expect(del.error).toMatchObject({ kind: 'bad-request' });
    const blob = await vault.fetch('venice', URL_, { method: 'POST', body: new Blob(['x']) }).catch((e) => e);
    expect(blob.error).toMatchObject({ kind: 'bad-request' });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.filter((m) => m.type === 'fetch')).toEqual([]);
  });
});

describe('connecting to the key vault', () => {
  it('fails when the vault speaks another protocol version, and tries again on the next use', async () => {
    greeting = (v) => v.send({ type: 'mismatch', protocol: 'nbl-vault/0' });
    const { vault } = await load();
    await expect(vault.requestStatus()).rejects.toThrow(t('versionMismatch'));
    expect(frames[0].removed).toBe(true);

    greeting = (v) => v.send(READY);
    await expect(vault.requestStatus()).resolves.toBeUndefined();
    expect(frames).toHaveLength(2);
    expect(frames[1].removed).toBe(false);
  });

  it('fails after 15 seconds when the vault page never answers (an error page loads too)', async () => {
    vi.useFakeTimers();
    greeting = () => {};
    const { vault } = await load();
    const p = vault.requestStatus().catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toEqual(new Error(t('connectFailed')));
    expect(frames[0].removed).toBe(true);
  });

  it('passes each status the vault sends to the listeners, until they stop listening', async () => {
    const { vault } = await load();
    const seen: unknown[] = [];
    const stop = vault.onStatus((providers, state) => seen.push({ providers, state }));
    let push!: (m: FromVault) => void;
    greeting = (v) => {
      push = v.send;
      v.send(READY);
    };
    await vault.requestStatus();
    const locked: FromVault = { type: 'status', providers: { venice: { present: true, encrypted: true, locked: true } }, vault: { hasPassphrase: true, locked: true, passphraseId: 'p1' } };
    push(locked);
    await vi.waitFor(() => expect(seen).toContainEqual({ providers: locked.providers, state: locked.vault }));
    stop();
    const before = seen.length;
    push(READY);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(before);
  });
});

describe('the vault’s own operations', () => {
  it('wraps and unwraps the data key, and fails with the vault’s message when it refuses', async () => {
    answer = (m, v) => {
      if (m.type === 'wrap-data-key') v.send({ type: 'result', id: m.id, ok: true, value: { wrapped: m.raw } });
      if (m.type === 'unwrap-data-key') v.send({ type: 'result', id: m.id, ok: false, message: 'locked' });
    };
    const { vault } = await load();
    expect(await vault.dataKey('wrap-data-key', 'raw-key')).toEqual({ wrapped: 'raw-key' });
    await expect(vault.dataKey('unwrap-data-key', { wrapped: 'x' })).rejects.toThrow('locked');
  });

  it('waits for the vault to confirm a lock, and fails instead of waiting forever when it never does', async () => {
    let confirm = true;
    answer = (m, v) => {
      if (m.type === 'lock' && confirm) v.send({ type: 'ack', id: m.id });
    };
    const { vault } = await load();
    await expect(vault.command('lock')).resolves.toBeUndefined();

    confirm = false;
    vi.useFakeTimers();
    const p = vault.command('lock').catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toEqual(new Error(t('vaultFailed')));
  });
});

describe('vault transport', () => {
  it('sends requests that need a key through the vault, and the rest directly without credentials', async () => {
    const direct = vi.fn(async () => new Response('models'));
    vi.stubGlobal('fetch', direct);
    let viaVault: ToVault | undefined;
    answer = (m, v) => {
      if (m.type !== 'fetch') return;
      viaVault = m;
      v.send({ type: 'head', id: m.id, status: 200, statusText: 'OK', headers: [] });
      v.send({ type: 'end', id: m.id });
    };
    const { vaultTransport } = await load();
    await vaultTransport.fetch(URL_, { method: 'POST', body: '{}' }, { keyId: 'venice' });
    expect(viaVault).toMatchObject({ providerId: 'venice', url: URL_ });
    expect(direct).not.toHaveBeenCalled();

    expect(await (await vaultTransport.fetch('https://api.venice.ai/api/v1/models', {})).text()).toBe('models');
    expect(direct).toHaveBeenCalledWith('https://api.venice.ai/api/v1/models', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  });
});
