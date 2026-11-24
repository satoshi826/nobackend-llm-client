// キーストア: キーの保存・暗号化・解錠と、キーを付けた送信。キー金庫のページの中でだけ動く。
// 同じページを本体と同じオリジンに置くか別オリジンに置くかは、デプロイ時に決める（コードは同じ）。
//
// 保存のルール（選択肢なし）:
//   - 金庫にパスフレーズがなければ、キーはそのまま保存する
//   - パスフレーズがあれば、すべてのキーを暗号化して保存する（後から設定したら保存済みのキーも暗号化し直す）
//   - 解錠は金庫全体で 1 回。パスフレーズを忘れたら「すべてのキーを削除」して入れ直す
import { decryptSecret, encryptSecret, MIN_PASSPHRASE_LENGTH, WrongPassphraseError, type EncryptedBlob } from '../src/lib/crypto/passphrase';
import { ACCOUNT_IDS, accountById, providerConfigOf, type KeyStatus, type VaultState } from '../src/lib/keys/accounts';

// ---- 保存領域（IndexedDB） ----
interface SecretRec {
  id: string;
  key?: string;
  enc?: EncryptedBlob;
  hosts: string[];
  createdAt: number;
}
/** パスフレーズの確認用（既知の文字列を暗号化したもの）。キーと同じストアに予約 ID で置く */
const META_ID = '__passphrase__';
const CHECK_TEXT = 'nbl-vault-passphrase-check';
interface MetaRec {
  id: typeof META_ID;
  check: EncryptedBlob;
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
const putRec = (r: SecretRec | MetaRec) => idb<unknown>('readwrite', (s) => s.put(r));
const delRec = (id: string) => idb<unknown>('readwrite', (s) => s.delete(id));
const getMeta = () => idb<MetaRec | undefined>('readonly', (s) => s.get(META_ID));
async function allRecs(): Promise<SecretRec[]> {
  const all = await idb<(SecretRec | MetaRec)[]>('readonly', (s) => s.getAll());
  return all.filter((r): r is SecretRec => r.id !== META_ID);
}

// ---- メモリ上の状態（解錠済みのキーとパスフレーズ）と、金庫ページ同士の共有 ----
const mem = new Map<string, string>();
let passphrase: string | null = null;
const listeners = new Set<() => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('key-vault') : null;

function emit() {
  for (const l of listeners) l();
}

/** 自分の状態を他の金庫ページ（同じオリジンの iframe）に伝える */
function broadcast() {
  bc?.postMessage({ type: 'sync', pass: passphrase, keys: [...mem] });
}

if (bc) {
  bc.onmessage = (e) => {
    const d = e.data;
    if (d?.type === 'hello') {
      if (passphrase !== null || mem.size) broadcast();
      else bc.postMessage({ type: 'changed' });
      return;
    }
    if (d?.type === 'sync' && Array.isArray(d.keys)) {
      mem.clear();
      for (const [id, key] of d.keys) if (typeof id === 'string' && typeof key === 'string') mem.set(id, key);
      passphrase = typeof d.pass === 'string' ? d.pass : null;
    } else if (d?.type !== 'changed') return;
    emit();
  };
  bc.postMessage({ type: 'hello' });
}

/** 保存内容だけが変わった（メモリの状態は同じ） */
function changed() {
  bc?.postMessage({ type: 'changed' });
  emit();
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Result = { ok: boolean; message: string };

// ---- 状態 ----
export function allowedHosts(id: string): string[] {
  const a = accountById(id);
  return a ? [a.host] : [];
}

export function label(id: string): string {
  return accountById(id)?.label ?? id;
}

export async function vaultState(): Promise<VaultState> {
  const has = !!(await getMeta()) || (await allRecs()).some((r) => r.enc);
  return { hasPassphrase: has, locked: has && passphrase === null };
}

export async function status(id: string): Promise<KeyStatus> {
  const r = await getRec(id);
  if (r?.enc) {
    const k = mem.get(id);
    return { present: true, encrypted: true, locked: k === undefined, hosts: r.hosts, last4: k?.slice(-4) ?? '' };
  }
  if (r?.key) return { present: true, encrypted: false, locked: false, hosts: r.hosts, last4: r.key.slice(-4) };
  return { present: false, encrypted: false, locked: false, hosts: [], last4: '' };
}

export async function allStatus(): Promise<{ keys: Record<string, KeyStatus>; vault: VaultState }> {
  const keys: Record<string, KeyStatus> = {};
  for (const id of ACCOUNT_IDS) keys[id] = await status(id);
  return { keys, vault: await vaultState() };
}

// ---- キーの保存・削除 ----
export async function saveKey(id: string, key: string): Promise<Result> {
  const account = accountById(id);
  if (!account) return { ok: false, message: '未対応の接続先です。' };
  const k = key.trim();
  if (!k) return { ok: false, message: 'キーを入力してください。' };
  const vs = await vaultState();
  if (vs.locked) return { ok: false, message: '先にパスフレーズで解錠してください。' };
  const cfg = providerConfigOf(id);
  if (cfg && account.preset?.validateKey) {
    const r = await account.preset.validateKey(cfg, (url, init) => keyedFetch(id, url, init ?? {}, k));
    if (!r.ok) return { ok: false, message: r.error?.message ?? 'キーを確認できませんでした。' };
  }
  const base = { id, hosts: allowedHosts(id), createdAt: Date.now() };
  if (passphrase !== null) {
    await putRec({ ...base, enc: await encryptSecret(k, passphrase) });
    mem.set(id, k);
    broadcast();
  } else {
    await putRec({ ...base, key: k });
  }
  changed();
  return { ok: true, message: passphrase !== null ? 'キーを暗号化して保存しました。' : 'キーを保存しました。' };
}

export async function remove(id: string) {
  mem.delete(id);
  await delRec(id);
  broadcast();
  changed();
}

/** すべてのキーとパスフレーズを消す（パスフレーズを忘れたときもこれ） */
export async function clearAll() {
  await idb<unknown>('readwrite', (s) => s.clear());
  mem.clear();
  passphrase = null;
  broadcast();
  changed();
}

// ---- パスフレーズ ----
async function verify(pass: string): Promise<boolean> {
  const meta = await getMeta();
  if (!meta) return false;
  try {
    return (await decryptSecret(meta.check, pass)) === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** 保存済みのすべてのキーを、新しいパスフレーズで暗号化し直す（null なら平文に戻す） */
async function rewriteAll(next: string | null) {
  for (const r of await allRecs()) {
    const key = r.key ?? mem.get(r.id);
    if (key === undefined) continue; // 解錠できなかった古いキーはそのまま
    await putRec(next === null ? { id: r.id, hosts: r.hosts, createdAt: r.createdAt, key } : { id: r.id, hosts: r.hosts, createdAt: r.createdAt, enc: await encryptSecret(key, next) });
    if (next === null) mem.delete(r.id);
    else mem.set(r.id, key);
  }
  if (next === null) await delRec(META_ID);
  else await putRec({ id: META_ID, check: await encryptSecret(CHECK_TEXT, next) });
  passphrase = next;
}

/** パスフレーズを設定・変更する（設定済みなら解錠している必要がある） */
export async function setPassphrase(next: string): Promise<Result> {
  if (next.length < MIN_PASSPHRASE_LENGTH) return { ok: false, message: `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` };
  const vs = await vaultState();
  if (vs.locked) return { ok: false, message: '先に今のパスフレーズで解錠してください。' };
  await rewriteAll(next);
  broadcast();
  changed();
  return { ok: true, message: vs.hasPassphrase ? 'パスフレーズを変更しました。' : 'パスフレーズを設定し、保存済みのキーを暗号化しました。' };
}

/** パスフレーズを外す（キーは暗号化せずに保存し直す） */
export async function removePassphrase(): Promise<Result> {
  if ((await vaultState()).locked) return { ok: false, message: '先に解錠してください。' };
  await rewriteAll(null);
  broadcast();
  changed();
  return { ok: true, message: 'パスフレーズを外しました。キーは暗号化せずに保存されています。' };
}

/** すべてのキーを解錠する */
export async function unlock(pass: string): Promise<Result> {
  const meta = await getMeta();
  const recs = await allRecs();
  if (meta) {
    if (!(await verify(pass))) return { ok: false, message: new WrongPassphraseError().message };
  }
  // 以前の形式（キーごとのパスフレーズ）: このパスフレーズで開けるものを開き、金庫全体のパスフレーズとして採用する
  let opened = 0;
  let failed = 0;
  for (const r of recs) {
    if (!r.enc) continue;
    try {
      mem.set(r.id, await decryptSecret(r.enc, pass));
      opened++;
    } catch {
      failed++;
    }
  }
  if (!meta && opened === 0) return { ok: false, message: new WrongPassphraseError().message };
  passphrase = pass;
  // 平文のまま残っているキー・確認用データがなければ、このパスフレーズでそろえる
  if (!meta || recs.some((r) => r.key)) await rewriteAll(pass);
  broadcast();
  changed();
  return failed
    ? { ok: true, message: `解錠しました。${failed} 件のキーは別のパスフレーズで暗号化されているため開けませんでした（削除して入れ直してください）。` }
    : { ok: true, message: '解錠しました。' };
}

export function lock() {
  if (passphrase === null && mem.size === 0) return;
  passphrase = null;
  mem.clear();
  broadcast();
  emit();
}

async function keyFor(id: string): Promise<string | undefined> {
  return mem.get(id) ?? (await getRec(id))?.key;
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
  // 本体から来た認証系のヘッダは捨て、この接続先のヘッダにだけキーを付ける
  for (const h of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'api-key']) headers.delete(h);
  const kh = accountById(id)!.keyHeader;
  headers.set(kh.name, `${kh.prefix}${key}`);
  return fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
}
