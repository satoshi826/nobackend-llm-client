// Passkey unlock (WebAuthn PRF): the crypto half, kept apart so it can be tested without an authenticator.
//
// A passkey cannot give us a stable secret by itself; the PRF extension can. For each registered passkey we
// keep a random salt. Asking the authenticator for PRF(salt) (after user verification: fingerprint, face,
// device PIN) returns the same 32 secret bytes every time, and nothing else can produce them. Those bytes go
// through HKDF into an AES-GCM key that encrypts the vault passphrase. Unlocking with the passkey decrypts the
// passphrase and unlocks with it as usual, so the rest of the vault does not change.
//
// There is no server, so the WebAuthn signature is not checked (nobody holds the challenge). Security rests on
// the PRF output alone: without the authenticator (and its user verification) the stored record is useless.

const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode('nbl-vault/passkey-unlock/1');

export interface SealedPassphrase {
  iv: string;
  ct: string;
}

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url without padding (how WebAuthn names credential ids, e.g. in evalByCredential) */
export const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

async function keyFromPrf(prf: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const bytes = new Uint8Array(prf instanceof Uint8Array ? prf : new Uint8Array(prf));
  if (bytes.length < 32) throw new Error('PRF output too short');
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealWithPrf(prf: ArrayBuffer | Uint8Array, passphrase: string): Promise<SealedPassphrase> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFromPrf(prf), enc.encode(passphrase));
  return { iv: b64(iv), ct: b64(ct) };
}

/** Throws when the PRF output does not belong to this record */
export async function openWithPrf(prf: ArrayBuffer | Uint8Array, sealed: SealedPassphrase): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, await keyFromPrf(prf), unb64(sealed.ct));
  return dec.decode(pt);
}
