// Encryption of stored data such as conversations (data key: random AES-GCM-256).
// The data key itself is stored wrapped with the passphrase (encrypted by the key vault) and kept in memory only while unlocked.

export interface Sealed {
  /** base64 */
  iv: string;
  ct: string;
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface DataKey {
  /** Kept in memory while unlocked so it can be rewrapped (passphrase change) */
  raw: string;
  key: CryptoKey;
}

export async function generateDataKey(): Promise<DataKey> {
  return importDataKey(b64(crypto.getRandomValues(new Uint8Array(32))));
}

export async function importDataKey(raw: string): Promise<DataKey> {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('データ鍵の形式が不正です。');
  return { raw, key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sealJSON(k: DataKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function openJSON<T>(k: DataKey, s: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, k.key, unb64(s.ct));
  return JSON.parse(dec.decode(pt)) as T;
}
