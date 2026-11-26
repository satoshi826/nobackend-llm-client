// Key store: saving, encrypting and unlocking keys, and sending requests with keys attached. Runs only inside the key vault page.
// Whether that page shares the app's origin or lives on a separate one is decided at deploy time (same code).
//
// Storage rules (not configurable):
//   - if the vault has no passphrase, keys are stored as is
//   - with a passphrase, all keys are stored encrypted (setting one later re-encrypts the stored keys)
//   - unlocking happens once for the whole vault. If the passphrase is forgotten, "delete all keys" and enter them again
import { decryptSecret, encryptSecret, MIN_PASSPHRASE_LENGTH, WrongPassphraseError, type EncryptedBlob } from '../src/lib/crypto/passphrase';
import { ACCOUNT_IDS, accountById, providerConfigOf, type KeyStatus, type VaultState } from '../src/lib/keys/accounts';
import { formatList, formatNumber } from '../src/lib/i18n';
import { t } from './messages';

// ---- Storage (IndexedDB) ----
interface SecretRec {
  id: string;
  key?: string;
  enc?: EncryptedBlob;
  hosts: string[];
  createdAt: number;
}
/** Passphrase check value (a known string, encrypted). Kept in the same store as the keys under a reserved ID */
const META_ID = '__passphrase__';
const CHECK_TEXT = 'nbl-vault-passphrase-check';
interface MetaRec {
  id: typeof META_ID;
  check: EncryptedBlob;
  /** Passphrase ID (renewed every time it is set or changed) */
  pid?: string;
}
/** Marker for wrapping the app's data key (so the app cannot get other ciphertexts decrypted) */
const DATA_KEY_PREFIX = 'nbl-data-key:';

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

// ---- In-memory state (unlocked keys and passphrase) and sharing between vault pages ----
const mem = new Map<string, string>();
let passphrase: string | null = null;
const listeners = new Set<() => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('key-vault') : null;
/**
 * ID of each app page (the app appends it to the vault URL). Unlock state is shared only among vault pages with the same ID.
 * Other tabs and reloaded pages get a different ID, so each one has to be unlocked when opened.
 */
const SESSION = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('session') ?? '') : '';

function emit() {
  for (const l of listeners) l();
}

/** Broadcast our state to the other vault pages (same-origin iframes) */
function broadcast() {
  bc?.postMessage({ type: 'sync', session: SESSION, pass: passphrase, keys: [...mem] });
}

if (bc) {
  bc.onmessage = (e) => {
    const d = e.data;
    // Storage changes (changed) go to every page; unlock state (hello / sync) only among pages of the same app page
    if (d?.type !== 'changed' && d?.session !== SESSION) return;
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
  bc.postMessage({ type: 'hello', session: SESSION });
}

/** Only the stored contents changed (in-memory state is the same) */
function changed() {
  bc?.postMessage({ type: 'changed' });
  emit();
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Result = { ok: boolean; message: string };

// ---- State ----
export function allowedHosts(id: string): string[] {
  const a = accountById(id);
  return a ? [a.host] : [];
}

export function label(id: string): string {
  return accountById(id)?.label ?? id;
}

export async function vaultState(): Promise<VaultState> {
  const meta = await getMeta();
  const has = !!meta || (await allRecs()).some((r) => r.enc);
  return { hasPassphrase: has, locked: has && passphrase === null, passphraseId: has ? (meta?.pid ?? 'legacy') : null };
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

// ---- Saving and deleting keys ----
export async function saveKey(id: string, key: string): Promise<Result> {
  const account = accountById(id);
  if (!account) return { ok: false, message: t('common.unsupportedProvider') };
  const k = key.trim();
  if (!k) return { ok: false, message: t('store.enterKey') };
  const vs = await vaultState();
  if (vs.locked) return { ok: false, message: t('store.unlockFirst') };
  const cfg = providerConfigOf(id);
  if (cfg && account.preset?.validateKey) {
    const r = await account.preset.validateKey(cfg, (url, init) => keyedFetch(id, url, init ?? {}, k));
    if (!r.ok) return { ok: false, message: r.error?.message ?? t('store.keyCheckFailed') };
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
  return { ok: true, message: passphrase !== null ? t('store.savedEncrypted') : t('store.saved') };
}

export async function remove(id: string) {
  mem.delete(id);
  await delRec(id);
  broadcast();
  changed();
}

/** Delete all keys and the passphrase (also the way out when the passphrase is forgotten) */
export async function clearAll() {
  await idb<unknown>('readwrite', (s) => s.clear());
  mem.clear();
  passphrase = null;
  broadcast();
  changed();
}

// ---- Passphrase ----
async function verify(pass: string): Promise<boolean> {
  const meta = await getMeta();
  if (!meta) return false;
  try {
    return (await decryptSecret(meta.check, pass)) === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** Re-encrypt all stored keys with a new passphrase (null turns them back into plaintext) */
async function rewriteAll(next: string | null) {
  for (const r of await allRecs()) {
    const key = r.key ?? mem.get(r.id);
    if (key === undefined) continue; // old keys that could not be unlocked stay as they are
    await putRec(next === null ? { id: r.id, hosts: r.hosts, createdAt: r.createdAt, key } : { id: r.id, hosts: r.hosts, createdAt: r.createdAt, enc: await encryptSecret(key, next) });
    if (next === null) mem.delete(r.id);
    else mem.set(r.id, key);
  }
  const meta = await getMeta();
  if (next === null) await delRec(META_ID);
  // Keep the ID when re-aligning with the same passphrase (the app's data key need not be rewrapped)
  else await putRec({ id: META_ID, check: await encryptSecret(CHECK_TEXT, next), pid: meta?.pid && next === passphrase ? meta.pid : crypto.randomUUID() });
  passphrase = next;
}

/** Set or change the passphrase (changing requires confirming the current one) */
export async function setPassphrase(next: string, current?: string): Promise<Result> {
  if (next.length < MIN_PASSPHRASE_LENGTH) return { ok: false, message: t('pass.tooShort', { min: MIN_PASSPHRASE_LENGTH }) };
  const vs = await vaultState();
  if (vs.locked) return { ok: false, message: t('store.unlockCurrentFirst') };
  if (vs.hasPassphrase && !(await verify(current ?? ''))) return { ok: false, message: t('store.wrongCurrent') };
  await rewriteAll(next);
  broadcast();
  changed();
  return { ok: true, message: vs.hasPassphrase ? t('store.changed') : t('store.setDone') };
}

/** Remove the passphrase (keys are re-saved unencrypted; requires confirming the current one) */
export async function removePassphrase(current: string): Promise<Result> {
  if ((await vaultState()).locked) return { ok: false, message: t('store.unlockFirstShort') };
  if (!(await verify(current))) return { ok: false, message: t('store.wrongCurrent') };
  await rewriteAll(null);
  broadcast();
  changed();
  return { ok: true, message: t('store.removed') };
}

/** Unlock all keys */
export async function unlock(pass: string): Promise<Result> {
  const meta = await getMeta();
  const recs = await allRecs();
  if (meta) {
    if (!(await verify(pass))) return { ok: false, message: new WrongPassphraseError().message };
  }
  // Legacy format (per-key passphrases): open whatever this passphrase can open, and adopt it as the vault-wide passphrase
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
  // If keys remain in plaintext or there is no check value yet, bring everything in line with this passphrase
  if (!meta || recs.some((r) => r.key)) await rewriteAll(pass);
  broadcast();
  changed();
  return failed
    ? { ok: true, message: t('unlock.partial', { count: formatNumber(failed) }) }
    : { ok: true, message: t('unlock.done') };
}

// ---- Wrapping / unwrapping the app's data key (used to encrypt conversations) with the passphrase ----
export async function wrapDataKey(raw: string): Promise<EncryptedBlob> {
  if (passphrase === null) throw new KeyError('auth', t('store.notUnlocked'));
  return encryptSecret(DATA_KEY_PREFIX + raw, passphrase);
}

export async function unwrapDataKey(blob: EncryptedBlob): Promise<string> {
  if (passphrase === null) throw new KeyError('auth', t('store.notUnlocked'));
  const text = await decryptSecret(blob, passphrase);
  if (!text.startsWith(DATA_KEY_PREFIX)) throw new KeyError('auth', t('store.notDataKey'));
  return text.slice(DATA_KEY_PREFIX.length);
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

/**
 * The saved key itself, for showing it on the key page (it never leaves the vault page).
 * With a passphrase, it must be entered again even while unlocked, so an unlocked device left alone does not give the key away.
 */
export async function revealKey(id: string, pass = ''): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const vs = await vaultState();
  if (vs.locked) return { ok: false, message: t('store.unlockFirst') };
  if (vs.hasPassphrase && !(await verify(pass))) return { ok: false, message: new WrongPassphraseError().message };
  const key = await keyFor(id);
  return key ? { ok: true, key } : { ok: false, message: t('store.noKey', { name: label(id) }) };
}

// ---- Sending with keys attached ----
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
 * Attaches the key and sends only when the URL is on an allowed host.
 * @param candidate key to verify before saving (defaults to the stored key)
 */
export async function keyedFetch(id: string, url: string, init: RequestInit, candidate?: string): Promise<Response> {
  if (!accountById(id)) throw new KeyError('host-mismatch', t('common.unsupportedProvider'));
  if (!isAllowedUrl(id, url)) throw new KeyError('host-mismatch', t('store.hostMismatch', { name: label(id), hosts: formatList(allowedHosts(id)) }));
  const key = candidate ?? (await keyFor(id));
  if (!key) throw new KeyError('auth', t('store.noKey', { name: label(id) }));
  const headers = new Headers(init.headers);
  // Drop auth headers coming from the app and attach the key only to this provider's header
  for (const h of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'api-key']) headers.delete(h);
  const kh = accountById(id)!.keyHeader;
  headers.set(kh.name, `${kh.prefix}${key}`);
  return fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
}
