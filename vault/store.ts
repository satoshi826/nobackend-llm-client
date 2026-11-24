// キーストア: キーの保存・暗号化・解錠と、キーを付けた送信。キー金庫のページの中でだけ動く。
// 同じページを本体と同じオリジンに置くか別オリジンに置くかは、デプロイ時に決める（コードは同じ）。
import { decryptSecret, encryptSecret, MIN_PASSPHRASE_LENGTH, type EncryptedBlob } from '../src/lib/crypto/passphrase';
import { ACCOUNT_IDS, accountById, providerConfigOf, type KeyStatus } from '../src/lib/keys/accounts';

export type Mode = 'plain' | 'encrypted' | 'session';

// ---- 保存領域（IndexedDB） ----
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

// ---- メモリ上の鍵（解錠済み・セッションのみ）と、金庫ページ同士の共有 ----
interface MemEntry {
  key: string;
  mode: 'session' | 'unlocked';
}
const mem = new Map<string, MemEntry>();
const listeners = new Set<() => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('key-vault') : null;

function emit() {
  for (const l of listeners) l();
}

/** 自分の変更を他の金庫ページに伝える */
function broadcast(id: string, stored = false) {
  if (!bc) return;
  if (stored) bc.postMessage({ type: 'stored', id });
  bc.postMessage(mem.has(id) ? { type: 'set', id, entry: mem.get(id) } : { type: 'del', id });
}

if (bc) {
  bc.onmessage = (e) => {
    const d = e.data;
    if (d?.type === 'set' && typeof d.id === 'string' && typeof d.entry?.key === 'string') mem.set(d.id, d.entry);
    else if (d?.type === 'del' && typeof d.id === 'string') mem.delete(d.id);
    else if (d?.type === 'hello') {
      for (const [id, entry] of mem) bc.postMessage({ type: 'set', id, entry });
      return;
    } else if (d?.type !== 'stored') return;
    emit();
  };
  bc.postMessage({ type: 'hello' });
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- 公開操作 ----
export function allowedHosts(id: string): string[] {
  const a = accountById(id);
  return a ? [a.host] : [];
}

export function label(id: string): string {
  return accountById(id)?.label ?? id;
}

export async function status(id: string): Promise<KeyStatus> {
  const r = await getRec(id);
  const m = mem.get(id);
  if (r?.enc) return { present: true, mode: 'encrypted', locked: !m, hosts: r.hosts, last4: m?.key.slice(-4) ?? '' };
  if (r?.key) return { present: true, mode: 'plain', locked: false, hosts: r.hosts, last4: r.key.slice(-4) };
  if (m) return { present: true, mode: 'session', locked: false, hosts: allowedHosts(id), last4: m.key.slice(-4) };
  return { present: false, mode: null, locked: false, hosts: [], last4: '' };
}

export async function allStatus(): Promise<Record<string, KeyStatus>> {
  const out: Record<string, KeyStatus> = {};
  for (const id of ACCOUNT_IDS) out[id] = await status(id);
  return out;
}

export async function saveKey(id: string, key: string, mode: Mode, passphrase?: string): Promise<{ ok: boolean; message: string }> {
  const account = accountById(id);
  if (!account) return { ok: false, message: '未対応の接続先です。' };
  const k = key.trim();
  if (!k) return { ok: false, message: 'キーを入力してください。' };
  if (mode === 'encrypted' && (passphrase ?? '').length < MIN_PASSPHRASE_LENGTH) return { ok: false, message: `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` };
  const cfg = providerConfigOf(id);
  if (cfg && account.preset?.validateKey) {
    const r = await account.preset.validateKey(cfg, (url, init) => keyedFetch(id, url, init ?? {}, k));
    if (!r.ok) return { ok: false, message: r.error?.message ?? 'キーを確認できませんでした。' };
  }
  const base = { id, hosts: allowedHosts(id), createdAt: Date.now() };
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
  broadcast(id, true);
  emit();
  return { ok: true, message: mode === 'encrypted' ? 'キーを暗号化して保存しました。' : 'キーを保存しました。' };
}

export async function unlock(id: string, passphrase: string): Promise<{ ok: boolean; message: string }> {
  const r = await getRec(id);
  if (!r?.enc) return { ok: false, message: '暗号化されたキーがありません。' };
  try {
    mem.set(id, { key: await decryptSecret(r.enc, passphrase), mode: 'unlocked' });
    broadcast(id);
    emit();
    return { ok: true, message: '解錠しました。' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function lock(id: string) {
  if (mem.get(id)?.mode !== 'unlocked') return;
  mem.delete(id);
  broadcast(id);
  emit();
}

export async function remove(id: string) {
  mem.delete(id);
  await delRec(id);
  broadcast(id, true);
  emit();
}

async function keyFor(id: string): Promise<string | undefined> {
  return mem.get(id)?.key ?? (await getRec(id))?.key;
}

// ---- キーを付けた送信 ----
export function isAllowedUrl(id: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return false;
  if (u.username || u.password) return false;
  return allowedHosts(id).includes(u.host);
}

export class KeyError extends Error {
  constructor(
    public readonly kind: 'host-mismatch' | 'auth',
    message: string
  ) {
    super(message);
  }
}

/**
 * 許可されたホスト宛てのときだけ、キーを付けて送る。
 * @param candidate 保存前のキーの確認用（省略時は保存済みのキー）
 */
export async function keyedFetch(id: string, url: string, init: RequestInit, candidate?: string): Promise<Response> {
  if (!accountById(id)) throw new KeyError('host-mismatch', '未対応の接続先です。');
  if (!isAllowedUrl(id, url)) throw new KeyError('host-mismatch', `${label(id)} のキーは ${allowedHosts(id).join(', ')} にしか送れません。`);
  const key = candidate ?? (await keyFor(id));
  if (!key) throw new KeyError('auth', `${label(id)} のキーが未設定か、ロックされています。`);
  const headers = new Headers(init.headers);
  for (const h of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(h);
  headers.set('Authorization', `Bearer ${key}`);
  return fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
}
