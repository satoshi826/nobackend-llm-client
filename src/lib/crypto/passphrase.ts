// Passphrase encryption of API keys and backup files (WebCrypto: PBKDF2-SHA256 → AES-GCM-256).
// Goal: avoid plaintext exposure on disk, in backups, or when someone else gets hold of the device.
// Note: while unlocked the plaintext is in memory, so this is no defence against XSS.
import { t } from './messages';
import { fromBase64, toBase64 } from '../base64';

export interface EncryptedBlob {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64
}

export const DEFAULT_ITERATIONS = 600_000;
/** Iteration counts accepted when opening: a file names its own, and a huge one would keep the tab busy for minutes */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 2_000_000;
export const MIN_PASSPHRASE_LENGTH = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();


async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain: string, passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<EncryptedBlob> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(t('passphrase.tooShort', { min: MIN_PASSPHRASE_LENGTH }));
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct) };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super(t('passphrase.wrong'));
  }
}

/** The blob is not one this app can open (another format, or an iteration count out of range): no passphrase would help */
export class UnsupportedBlobError extends Error {}

export async function decryptSecret(blob: EncryptedBlob, passphrase: string): Promise<string> {
  if (blob?.v !== 1 || blob.kdf !== 'PBKDF2-SHA256') throw new UnsupportedBlobError(t('passphrase.unsupported'));
  if (!Number.isSafeInteger(blob.iter) || blob.iter < MIN_ITERATIONS || blob.iter > MAX_ITERATIONS) throw new UnsupportedBlobError(t('passphrase.iterations'));
  const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct));
    return dec.decode(pt);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** The first line of a file encrypted by encryptFile */
export interface FileHeader {
  format: string;
  version: 2;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string; // base64
  /** The first 8 bytes of every chunk's IV (base64); the chunk's number makes the last 4 */
  nonce: string;
  /** Bytes of the file in each chunk (the last may hold fewer) */
  chunk: number;
}

/** Plain bytes per chunk: what encrypting or decrypting holds in memory at a time */
const FILE_CHUNK = 4 << 20;
const TAG_BYTES = 16;

const chunkIv = (nonce: Uint8Array, i: number) => {
  const iv = new Uint8Array(new ArrayBuffer(12));
  iv.set(nonce);
  new DataView(iv.buffer).setUint32(8, i);
  return iv;
};
/** A chunk's number and whether it is the last, sealed with it: chunks cannot be reordered, dropped or cut off unnoticed */
const chunkAad = (i: number, last: boolean) => {
  const aad = new Uint8Array(new ArrayBuffer(5));
  new DataView(aad.buffer).setUint32(0, i);
  aad[4] = last ? 1 : 0;
  return aad;
};

/**
 * A file encrypted with a passphrase, a chunk at a time: a line of JSON (FileHeader), then each chunk's ciphertext and
 * tag. Neither encrypting nor decrypting holds more than a chunk in memory; the result is a Blob, which the browser
 * may keep on disk
 */
export async function encryptFile(plain: Blob, passphrase: string, format: string, iterations = DEFAULT_ITERATIONS): Promise<Blob> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(t('passphrase.tooShort', { min: MIN_PASSPHRASE_LENGTH }));
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(8)));
  const key = await deriveKey(passphrase, salt, iterations);
  const header: FileHeader = { format, version: 2, kdf: 'PBKDF2-SHA256', iter: iterations, salt: toBase64(salt), nonce: toBase64(nonce), chunk: FILE_CHUNK };
  const out: BlobPart[] = [JSON.stringify(header) + '\n'];
  const n = Math.max(1, Math.ceil(plain.size / FILE_CHUNK));
  for (let i = 0; i < n; i++) {
    const pt = await plain.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK).arrayBuffer();
    out.push(new Blob([await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(nonce, i), additionalData: chunkAad(i, i === n - 1) }, key, pt)]));
  }
  return new Blob(out, { type: 'application/octet-stream' });
}

/** The header of a file encrypted by encryptFile, and where its chunks start; null when the file is not one */
export async function readFileHeader(file: Blob): Promise<{ header: FileHeader; start: number } | null> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const end = head.indexOf(10);
  if (end < 0) return null;
  try {
    const h = JSON.parse(dec.decode(head.subarray(0, end)));
    return h && typeof h === 'object' && h.version === 2 && typeof h.format === 'string' ? { header: h, start: end + 1 } : null;
  } catch {
    return null;
  }
}

/** Decrypts a file encrypted by encryptFile (header and start: from readFileHeader) */
export async function decryptFile(file: Blob, { header: h, start }: { header: FileHeader; start: number }, passphrase: string): Promise<Blob> {
  if (h.kdf !== 'PBKDF2-SHA256' || !Number.isSafeInteger(h.chunk) || h.chunk < 1 || h.chunk > 64 << 20) throw new UnsupportedBlobError(t('passphrase.unsupported'));
  if (!Number.isSafeInteger(h.iter) || h.iter < MIN_ITERATIONS || h.iter > MAX_ITERATIONS) throw new UnsupportedBlobError(t('passphrase.iterations'));
  const nonce = fromBase64(h.nonce);
  if (nonce.length !== 8) throw new UnsupportedBlobError(t('passphrase.unsupported'));
  const key = await deriveKey(passphrase, fromBase64(h.salt), h.iter);
  const sealed = h.chunk + TAG_BYTES;
  const n = Math.ceil((file.size - start) / sealed);
  if (n < 1) throw new WrongPassphraseError();
  const out: BlobPart[] = [];
  for (let i = 0; i < n; i++) {
    const ct = await file.slice(start + i * sealed, start + (i + 1) * sealed).arrayBuffer();
    try {
      out.push(new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(nonce, i), additionalData: chunkAad(i, i === n - 1) }, key, ct)]));
    } catch {
      // The first chunk fails with a wrong passphrase; a later one when the file is damaged or cut off
      throw new WrongPassphraseError();
    }
  }
  return new Blob(out);
}
