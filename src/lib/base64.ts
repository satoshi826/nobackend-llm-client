// Bytes as base64 and back (keys and sealed data, backups, images in API requests and answers)

/** Bytes as base64, a chunk at a time (one call over a large image would overflow the call stack) */
export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A blob's bytes as base64, and as a data: URL (how APIs take an input image) */
export const blobToBase64 = async (b: Blob): Promise<string> => toBase64(await b.arrayBuffer());
export const blobToDataUrl = async (b: Blob) => `data:${b.type || 'image/png'};base64,${await blobToBase64(b)}`;
export const base64ToBlob = (data: string, mime: string): Blob => new Blob([fromBase64(data)], { type: mime });
