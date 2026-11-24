// 本体アプリ側のキー金庫クライアント。
// 画面に出ない iframe（view=transport）を 1 つ置き、MessageChannel で送信依頼を出す。
// 応答は ReadableStream に詰め直して Response として返すので、既存の Adapter / SSE パーサはそのまま使える。
import { ProviderFailure } from '../providers/errors';
import type { Transport } from '../providers/types';
import { plainTransport } from '../providers/transport';
import { VAULT_PROTOCOL, type FromVault, type ToVault } from './protocol';
import type { KeyStatus, VaultState } from '../keys/accounts';

/**
 * キー金庫ページの URL。キーの保存・送信は常にこのページが行い、本体アプリはキーを持たない。
 * - 未指定: 本体と同じオリジンの /vault/（デプロイ 1 つで動く。XSS からの隔離はない）
 * - VITE_VAULT_URL 指定: 別オリジンの金庫（例: https://vault.example.com/index.html）。本体で XSS が起きてもキーは読めない
 */
// /vault/index.html は Cloudflare などで /vault/ にリダイレクトされるので、最初から /vault/ を開く
const SAME_ORIGIN_PATH = '/vault/';
export const VAULT_URL: string = (import.meta as any).env?.VITE_VAULT_URL || (typeof location !== 'undefined' ? new URL(SAME_ORIGIN_PATH, location.origin).toString() : SAME_ORIGIN_PATH);
export const VAULT_ORIGIN = typeof location !== 'undefined' ? new URL(VAULT_URL, location.origin).origin : '';
/** キー金庫が本体と別オリジンにあるか（XSS からキーを隔離できているか） */
export const vaultIsolated = typeof location !== 'undefined' && VAULT_ORIGIN !== location.origin;

export function vaultViewUrl(params: Record<string, string>): string {
  const u = new URL(VAULT_URL);
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
      const timer = setTimeout(() => reject(new Error('キー金庫に接続できませんでした。')), 15000);
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

  /** 金庫への操作（すべてのキーの削除・ロック）。終わるまで待つ */
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
          /* 既に閉じている */
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
    if (method !== 'GET' && method !== 'POST') throw new ProviderFailure({ kind: 'bad-request', message: '許可されていないメソッドです。' });
    const headers: [string, string][] = [];
    new Headers(init.headers).forEach((v, k) => headers.push([k, v]));
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new ProviderFailure({ kind: 'bad-request', message: '本文は文字列のみ送れます。' });
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
 * 金庫モードの Transport。キーが必要な通信（credential.kind === 'vault'）は金庫に依頼し、
 * キーの要らない通信（モデル一覧など）は本体から直接送る。
 */
export const vaultTransport: Transport = {
  fetch(url, init, auth) {
    if (auth) return vault.fetch(auth.keyId, url, init);
    return plainTransport.fetch(url, init);
  }
};
