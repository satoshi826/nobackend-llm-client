// Key vault client on the app side.
// Places one invisible iframe (view=transport) and sends requests over a MessageChannel.
// Responses are repacked into a ReadableStream and returned as a Response, so the existing Adapters / SSE parser work unchanged.
import { ProviderFailure } from '../providers/errors';
import type { Transport } from '../providers/types';
import { plainTransport } from '../providers/transport';
import { VAULT_PROTOCOL, type FromVault, type ToVault } from './protocol';
import type { KeyStatus, VaultState } from '../keys/accounts';
import { getLang } from '../i18n';
import { t } from './messages';

/**
 * URL of the key vault page. That page always stores keys and sends with them; the app never holds keys.
 * - unset: /vault/ on the app's own origin (works with a single deployment; no isolation from XSS)
 * - VITE_VAULT_URL set: a vault on a separate origin (e.g. https://vault.example.com/index.html). Keys stay unreadable even if the app suffers XSS
 */
// /vault/index.html gets redirected to /vault/ by Cloudflare and others, so open /vault/ directly
const SAME_ORIGIN_PATH = '/vault/';
export const VAULT_URL: string = (import.meta as any).env?.VITE_VAULT_URL || (typeof location !== 'undefined' ? new URL(SAME_ORIGIN_PATH, location.origin).toString() : SAME_ORIGIN_PATH);
export const VAULT_ORIGIN = typeof location !== 'undefined' ? new URL(VAULT_URL, location.origin).origin : '';
/** Whether the key vault is on a different origin from the app (i.e. keys are isolated from XSS) */
export const vaultIsolated = typeof location !== 'undefined' && VAULT_ORIGIN !== location.origin;

/** ID of this page (one app page). The vault's unlock state is shared only within this ID */
export const VAULT_SESSION = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

export function vaultViewUrl(params: Record<string, string>): string {
  const u = new URL(VAULT_URL);
  u.searchParams.set('session', VAULT_SESSION);
  u.searchParams.set('lang', getLang());
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

interface Pending {
  resolve(r: Response): void;
  reject(e: unknown): void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
}

class VaultConnection {
  private port: MessagePort | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private statusListeners = new Set<(s: Record<string, KeyStatus>, v: VaultState) => void>();
  private acks = new Map<string, () => void>();
  private results = new Map<string, (r: { ok: boolean; value?: unknown; message?: string }) => void>();
  private seq = 0;

  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.src = vaultViewUrl({ view: 'transport' });
      iframe.title = 'key-vault';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.referrerPolicy = 'no-referrer';
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      const timer = setTimeout(() => reject(new Error(t('connectFailed'))), 15000);
      iframe.addEventListener('load', () => {
        const ch = new MessageChannel();
        this.port = ch.port1;
        ch.port1.onmessage = (e) => this.onMessage(e.data as FromVault);
        iframe.contentWindow!.postMessage({ type: 'connect', protocol: VAULT_PROTOCOL }, VAULT_ORIGIN, [ch.port2]);
        clearTimeout(timer);
        resolve();
      });
      document.body.appendChild(iframe);
    });
    return this.ready;
  }

  onStatus(fn: (s: Record<string, KeyStatus>, v: VaultState) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private send(m: ToVault) {
    this.port!.postMessage(m);
  }

  async requestStatus() {
    await this.connect();
    this.send({ type: 'status' });
  }

  /** Wrap / unwrap the data key with the passphrase (the vault must be unlocked) */
  async dataKey(type: 'wrap-data-key', raw: string): Promise<unknown>;
  async dataKey(type: 'unwrap-data-key', blob: unknown): Promise<string>;
  async dataKey(type: 'wrap-data-key' | 'unwrap-data-key', arg: unknown): Promise<unknown> {
    await this.connect();
    const id = `d${++this.seq}`;
    const r = await new Promise<{ ok: boolean; value?: unknown; message?: string }>((resolve) => {
      this.results.set(id, resolve);
      this.send(type === 'wrap-data-key' ? { type, id, raw: String(arg) } : { type, id, blob: arg });
    });
    if (!r.ok) throw new Error(r.message ?? t('vaultFailed'));
    return r.value;
  }

  /** Vault operations (delete all keys, lock). Waits until done */
  async command(type: 'clear-all' | 'lock'): Promise<void> {
    await this.connect();
    const id = `c${++this.seq}`;
    await new Promise<void>((resolve) => {
      this.acks.set(id, resolve);
      this.send({ type, id });
    });
  }

  private onMessage(m: FromVault) {
    if (m.type === 'status') {
      for (const l of this.statusListeners) l(m.providers, m.vault);
      return;
    }
    if (m.type === 'ack') {
      this.acks.get(m.id)?.();
      this.acks.delete(m.id);
      return;
    }
    if (m.type === 'result') {
      this.results.get(m.id)?.(m);
      this.results.delete(m.id);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    switch (m.type) {
      case 'head': {
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            p.controller = controller;
          },
          cancel: () => this.send({ type: 'abort', id: m.id })
        });
        const noBody = m.status === 204 || m.status === 304;
        p.resolve(new Response(noBody ? null : stream, { status: m.status, statusText: m.statusText, headers: m.headers }));
        break;
      }
      case 'chunk':
        p.controller?.enqueue(m.chunk);
        break;
      case 'end':
        try {
          p.controller?.close();
        } catch {
          /* already closed */
        }
        this.pending.delete(m.id);
        break;
      case 'error': {
        const err =
          m.kind === 'aborted'
            ? new DOMException('aborted', 'AbortError')
            : new ProviderFailure({ kind: (m.kind as any) ?? 'server', message: m.message });
        if (p.controller) p.controller.error(err);
        else p.reject(err);
        this.pending.delete(m.id);
        break;
      }
    }
  }

  async fetch(providerId: string, url: string, init: RequestInit): Promise<Response> {
    await this.connect();
    const id = `r${++this.seq}`;
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw new ProviderFailure({ kind: 'bad-request', message: t('methodNotAllowed') });
    const headers: [string, string][] = [];
    new Headers(init.headers).forEach((v, k) => headers.push([k, v]));
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new ProviderFailure({ kind: 'bad-request', message: t('bodyMustBeString') });
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal?.addEventListener('abort', () => this.send({ type: 'abort', id }), { once: true });
      this.send({ type: 'fetch', id, providerId, url, method: method as 'GET' | 'POST', headers, body: (init.body as string | undefined) ?? undefined });
    });
  }
}

export const vault = new VaultConnection();

/**
 * Transport in vault mode. Requests that need a key (credential.kind === 'vault') go through the vault;
 * requests that need none (model lists etc.) are sent directly from the app.
 */
export const vaultTransport: Transport = {
  fetch(url, init, auth) {
    if (auth) return vault.fetch(auth.keyId, url, init);
    return plainTransport.fetch(url, init);
  }
};
