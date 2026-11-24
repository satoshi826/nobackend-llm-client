// キー金庫の中核。このファイルは金庫のオリジンでだけ動く（本体アプリには含まれない）。
// - キーの保存（平文 / パスフレーズ暗号化 / セッションのみ）
// - 解錠状態の共有（同じ金庫オリジンの iframe 同士で BroadcastChannel）
// - 本体からの送信依頼に、許可されたホスト宛てのときだけキーを付けて fetch する
import { venicePreset } from '../src/lib/providers/presets/venice';
import { openrouterPreset } from '../src/lib/providers/presets/openrouter';
import { directTransport, hostOf } from '../src/lib/providers/transport';
import { decryptSecret, encryptSecret, MIN_PASSPHRASE_LENGTH, type EncryptedBlob } from '../src/lib/crypto/passphrase';
import type { ProviderConfig, ProviderPreset } from '../src/lib/providers/types';
import { PASSTHROUGH_HEADERS, type FromVault, type ToVault, type VaultKeyStatus } from '../src/lib/vault/protocol';
import { SERVICES } from '../src/lib/tools/services';

export type Mode = 'plain' | 'encrypted' | 'session';

/** 金庫が扱うプロバイダーと、キーを付けてよいホスト。ビルド時に固定され、本体からは変更できない。 */
const PRESETS: Record<string, ProviderPreset> = { venice: venicePreset, openrouter: openrouterPreset };
/** LLM 以外にキーを預かる外部サービス（Web 検索など） */
export const PROVIDER_IDS = [...Object.keys(PRESETS), ...Object.keys(SERVICES)];

export function providerLabel(id: string): string {
  return PRESETS[id]?.label ?? SERVICES[id]?.label ?? id;
}

export function allowedHosts(id: string): string[] {
  const p = PRESETS[id];
  if (p) return [hostOf(p.defaults.baseUrl)];
  const sv = SERVICES[id];
  return sv ? [hostOf(sv.baseUrl)] : [];
}

function configOf(id: string): ProviderConfig {
  return { id, ...PRESETS[id].defaults };
}

// ---- 保存領域（金庫オリジンの IndexedDB） ----
interface SecretRec {
  id: string;
  key?: string;
  enc?: EncryptedBlob;
  hosts: string[];
  createdAt: number;
}

let dbp: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('key-vault', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('secrets', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('secrets', mode).objectStore('secrets'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const getRec = (id: string) => idb<SecretRec | undefined>('readonly', (s) => s.get(id));
const putRec = (r: SecretRec) => idb<unknown>('readwrite', (s) => s.put(r));
const delRec = (id: string) => idb<unknown>('readwrite', (s) => s.delete(id));

// ---- メモリ上の鍵（解錠済み・セッションのみ）と、金庫 iframe 間の共有 ----
interface MemEntry {
  key: string;
  mode: 'session' | 'unlocked';
}
const mem = new Map<string, MemEntry>();
const listeners = new Set<() => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('key-vault') : null;

function changed(local = true, id?: string) {
  if (local && bc && id) bc.postMessage(mem.has(id) ? { type: 'set', id, entry: mem.get(id) } : { type: 'del', id });
  for (const l of listeners) l();
}

if (bc) {
  bc.onmessage = (e) => {
    const d = e.data;
    if (d?.type === 'set' && typeof d.id === 'string' && typeof d.entry?.key === 'string') mem.set(d.id, d.entry);
    else if (d?.type === 'del' && typeof d.id === 'string') mem.delete(d.id);
    else if (d?.type === 'hello') {
      for (const [id, entry] of mem) bc.postMessage({ type: 'set', id, entry });
      return;
    } else if (d?.type === 'stored') {
      // 別の金庫 iframe が保存・削除した → 状態を読み直す
    } else return;
    changed(false);
  };
  bc.postMessage({ type: 'hello' });
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyStored(id: string) {
  bc?.postMessage({ type: 'stored', id });
  changed(true, id);
}

// ---- 公開操作 ----
export async function status(id: string): Promise<VaultKeyStatus> {
  const r = await getRec(id);
  const m = mem.get(id);
  if (r?.enc) return { present: true, mode: 'encrypted', locked: !m, hosts: r.hosts, last4: m?.key.slice(-4) ?? '' };
  if (r?.key) return { present: true, mode: 'plain', locked: false, hosts: r.hosts, last4: r.key.slice(-4) };
  if (m) return { present: true, mode: 'session', locked: false, hosts: allowedHosts(id), last4: m.key.slice(-4) };
  return { present: false, mode: null, locked: false, hosts: [], last4: '' };
}

export async function allStatus(): Promise<Record<string, VaultKeyStatus>> {
  const out: Record<string, VaultKeyStatus> = {};
  for (const id of PROVIDER_IDS) out[id] = await status(id);
  return out;
}

export async function saveKey(id: string, key: string, mode: Mode, passphrase?: string): Promise<{ ok: boolean; message: string }> {
  const preset = PRESETS[id];
  if (!preset && !SERVICES[id]) return { ok: false, message: '未対応の接続先です。' };
  const k = key.trim();
  if (!k) return { ok: false, message: 'キーを入力してください。' };
  if (mode === 'encrypted' && (passphrase ?? '').length < MIN_PASSPHRASE_LENGTH) return { ok: false, message: `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` };
  const hosts = allowedHosts(id);
  if (preset?.validateKey) {
    const r = await preset.validateKey(configOf(id), { key: k, hosts }, directTransport);
    if (!r.ok) return { ok: false, message: r.error?.message ?? 'キーを確認できませんでした。' };
  }
  const base = { id, hosts, createdAt: Date.now() };
  if (mode === 'session') {
    await delRec(id);
    mem.set(id, { key: k, mode: 'session' });
  } else if (mode === 'encrypted') {
    await putRec({ ...base, enc: await encryptSecret(k, passphrase!) });
    mem.set(id, { key: k, mode: 'unlocked' });
  } else {
    await putRec({ ...base, key: k });
    mem.delete(id);
  }
  notifyStored(id);
  return { ok: true, message: mode === 'encrypted' ? 'キーを暗号化して保存しました。' : 'キーを保存しました。' };
}

export async function unlock(id: string, passphrase: string): Promise<{ ok: boolean; message: string }> {
  const r = await getRec(id);
  if (!r?.enc) return { ok: false, message: '暗号化されたキーがありません。' };
  try {
    mem.set(id, { key: await decryptSecret(r.enc, passphrase), mode: 'unlocked' });
    changed(true, id);
    return { ok: true, message: '解錠しました。' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function lock(id: string) {
  if (mem.get(id)?.mode === 'unlocked') {
    mem.delete(id);
    changed(true, id);
  }
}

export async function remove(id: string) {
  mem.delete(id);
  await delRec(id);
  notifyStored(id);
}

async function keyFor(id: string): Promise<string | undefined> {
  const m = mem.get(id);
  if (m) return m.key;
  return (await getRec(id))?.key;
}

// ---- 送信依頼の処理 ----
const inflight = new Map<string, AbortController>();

function isAllowedUrl(providerId: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return false;
  if (u.username || u.password) return false;
  return allowedHosts(providerId).includes(u.host);
}

export function validateRequest(req: ToVault & { type: 'fetch' }): string | null {
  if (!PRESETS[req.providerId] && !SERVICES[req.providerId]) return '未対応の接続先です。';
  if (req.method !== 'GET' && req.method !== 'POST') return '許可されていないメソッドです。';
  if (!isAllowedUrl(req.providerId, req.url)) return `${providerLabel(req.providerId)} のキーは ${allowedHosts(req.providerId).join(', ')} にしか送れません。`;
  if (req.body !== undefined && typeof req.body !== 'string') return '本文の形式が不正です。';
  return null;
}

export async function handle(msg: ToVault, send: (m: FromVault, transfer?: Transferable[]) => void) {
  if (msg.type === 'status') {
    send({ type: 'status', providers: await allStatus() });
    return;
  }
  if (msg.type === 'abort') {
    inflight.get(msg.id)?.abort();
    return;
  }
  if (msg.type !== 'fetch') return;
  const err = validateRequest(msg);
  if (err) return send({ type: 'error', id: msg.id, kind: 'host-mismatch', message: err });
  const key = await keyFor(msg.providerId);
  if (!key) return send({ type: 'error', id: msg.id, kind: 'auth', message: `${providerLabel(msg.providerId)} のキーが未設定か、ロックされています。` });

  const headers = new Headers();
  for (const [k, v] of msg.headers) {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'cookie' || lk === 'proxy-authorization') continue;
    headers.set(k, v);
  }
  headers.set('Authorization', `Bearer ${key}`);
  const ctrl = new AbortController();
  inflight.set(msg.id, ctrl);
  try {
    const res = await fetch(msg.url, { method: msg.method, headers, body: msg.body, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctrl.signal });
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
    const aborted = (e as Error)?.name === 'AbortError';
    send({ type: 'error', id: msg.id, kind: aborted ? 'aborted' : 'network-or-cors', message: aborted ? '停止しました。' : '接続できませんでした。' });
  } finally {
    inflight.delete(msg.id);
  }
}
