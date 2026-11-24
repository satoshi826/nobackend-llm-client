// パスフレーズによる API キーの暗号化（WebCrypto: PBKDF2-SHA256 → AES-GCM-256）。
// 目的: ディスク上・バックアップ・他人に端末を触られた場合の平文露出を防ぐ。
// 注意: 解錠中はメモリ上に平文があるため、XSS 対策にはならない（docs/design.md §5.3）。

export interface EncryptedBlob {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64
}

export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain: string, passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<EncryptedBlob> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。`);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('パスフレーズが違います。');
  }
}

export async function decryptSecret(blob: EncryptedBlob, passphrase: string): Promise<string> {
  if (blob?.v !== 1 || blob.kdf !== 'PBKDF2-SHA256') throw new Error('対応していない暗号化形式です。');
  const key = await deriveKey(passphrase, unb64(blob.salt), blob.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return dec.decode(pt);
  } catch {
    throw new WrongPassphraseError();
  }
}
