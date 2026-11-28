// Encryption of stored data such as conversations (data key: random AES-GCM-256).
// The data key itself is stored wrapped with the passphrase (encrypted by the key vault) and kept in memory only while unlocked.
import { t } from './messages';
import { fromBase64, toBase64 } from '../base64';

/**
 * Encrypted data as stored: the 12-byte IV, then the ciphertext. Bytes, not text: IndexedDB stores them as they are,
 * so nothing is converted on the way in or out, and they take a quarter less room than base64
 */
export type Sealed = Uint8Array<ArrayBuffer>;
const IV_BYTES = 12;


export interface DataKey {
  /** Kept in memory while unlocked so it can be rewrapped (passphrase change) */
  raw: string;
  key: CryptoKey;
}

export async function generateDataKey(): Promise<DataKey> {
  return importDataKey(toBase64(crypto.getRandomValues(new Uint8Array(32))));
}

export async function importDataKey(raw: string): Promise<DataKey> {
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) throw new Error(t('dataKey.invalid'));
  return { raw, key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sealJSON(k: DataKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(new ArrayBuffer(IV_BYTES + ct.length));
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

export async function openJSON<T>(k: DataKey, s: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.subarray(0, IV_BYTES) }, k.key, s.subarray(IV_BYTES));
  return JSON.parse(dec.decode(pt)) as T;
}

/** Encrypt raw bytes (images; the IV is kept apart, so the ciphertext can be stored as a Blob) */
export async function sealBytes(k: DataKey, data: ArrayBuffer): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, data) };
}

export async function openBytes(k: DataKey, s: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, k.key, s.data);
}

/**
 * Development only (goes before the first release, with the schema upgrade that uses it): data sealed before it was
 * stored as bytes, with the IV and the ciphertext in base64
 */
export function sealedFromBase64(old: { iv: string; ct: string }): Sealed {
  const iv = fromBase64(old.iv);
  const ct = fromBase64(old.ct);
  const out = new Uint8Array(new ArrayBuffer(iv.length + ct.length));
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}
