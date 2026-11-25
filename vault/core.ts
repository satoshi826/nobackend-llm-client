// Messaging between the key vault and the app (MessagePort). Validates send requests, has the key store attach the key and send, and streams the response back.
import { PASSTHROUGH_HEADERS, type FromVault, type ToVault } from '../src/lib/vault/protocol';
import { accountById } from '../src/lib/keys/accounts';
import { allStatus, allowedHosts, clearAll, isAllowedUrl, KeyError, keyedFetch, label, lock, unwrapDataKey, wrapDataKey } from './store';

export { allowedHosts };

export function validateRequest(req: ToVault & { type: 'fetch' }): string | null {
  if (!accountById(req.providerId)) return '未対応の接続先です。';
  if (req.method !== 'GET' && req.method !== 'POST') return '許可されていないメソッドです。';
  if (!isAllowedUrl(req.providerId, req.url)) return `${label(req.providerId)} のキーは ${allowedHosts(req.providerId).join(', ')} にしか送れません。`;
  if (req.body !== undefined && typeof req.body !== 'string') return '本文の形式が不正です。';
  return null;
}

const inflight = new Map<string, AbortController>();

export async function handle(msg: ToVault, send: (m: FromVault, transfer?: Transferable[]) => void) {
  if (msg.type === 'status') {
    const s = await allStatus();
    send({ type: 'status', providers: s.keys, vault: s.vault });
    return;
  }
  if (msg.type === 'clear-all') {
    await clearAll();
    send({ type: 'ack', id: msg.id });
    return;
  }
  if (msg.type === 'lock') {
    lock();
    send({ type: 'ack', id: msg.id });
    return;
  }
  if (msg.type === 'wrap-data-key' || msg.type === 'unwrap-data-key') {
    try {
      const value = msg.type === 'wrap-data-key' ? await wrapDataKey(String(msg.raw)) : await unwrapDataKey(msg.blob as never);
      send({ type: 'result', id: msg.id, ok: true, value });
    } catch (e) {
      send({ type: 'result', id: msg.id, ok: false, message: (e as Error).message });
    }
    return;
  }
  if (msg.type === 'abort') {
    inflight.get(msg.id)?.abort();
    return;
  }
  if (msg.type !== 'fetch') return;
  const err = validateRequest(msg);
  if (err) return send({ type: 'error', id: msg.id, kind: 'host-mismatch', message: err });
  const ctrl = new AbortController();
  inflight.set(msg.id, ctrl);
  try {
    const res = await keyedFetch(msg.providerId, msg.url, { method: msg.method, headers: msg.headers, body: msg.body, signal: ctrl.signal });
    const outHeaders: [string, string][] = [];
    for (const h of PASSTHROUGH_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) outHeaders.push([h, v]);
    }
    send({ type: 'head', id: msg.id, status: res.status, statusText: res.statusText, headers: outHeaders });
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        send({ type: 'chunk', id: msg.id, chunk: value }, [value.buffer]);
      }
    }
    send({ type: 'end', id: msg.id });
  } catch (e) {
    if (e instanceof KeyError) send({ type: 'error', id: msg.id, kind: e.kind, message: e.message });
    else {
      const aborted = (e as Error)?.name === 'AbortError';
      send({ type: 'error', id: msg.id, kind: aborted ? 'aborted' : 'network-or-cors', message: aborted ? '停止しました。' : '接続できませんでした。' });
    }
  } finally {
    inflight.delete(msg.id);
  }
}
