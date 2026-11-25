// Image storage (generated images). Images of temporary chats stay in memory only.
// With a passphrase (a data key is set) the bytes are encrypted with the same data key as conversations.
import { db, type BlobRecord } from './schema';
import { currentDataKey, DataLockedError } from './sealed';
import { openBytes, sealBytes, type DataKey } from '../crypto/data';

const mem = new Map<string, BlobRecord>();

export interface ImageMeta {
  id: string;
  conversationId: string;
  messageId: string;
  mime: string;
}

/** Save an image (encrypted when a data key is set) */
export async function putImage(meta: ImageMeta, blob: Blob, temporary: boolean): Promise<void> {
  const base = { ...meta, createdAt: Date.now(), size: blob.size };
  if (temporary) {
    mem.set(meta.id, { ...base, blob });
    return;
  }
  const key = currentDataKey();
  await db().blobs.put(key ? { ...base, enc: await sealBytes(key, await blob.arrayBuffer()) } : { ...base, blob });
}

async function toBlob(rec: BlobRecord, key: DataKey | null = currentDataKey()): Promise<Blob> {
  if (rec.blob) return rec.blob;
  if (!rec.enc) throw new Error('画像のデータがありません。');
  if (!key) throw new DataLockedError();
  return new Blob([await openBytes(key, rec.enc)], { type: rec.mime });
}

export async function getImage(id: string): Promise<Blob | null> {
  const rec = mem.get(id) ?? (await db().blobs.get(id));
  return rec ? toBlob(rec) : null;
}

/** Image records without the bytes, newest first (for the gallery) */
export async function listImages(): Promise<Omit<BlobRecord, 'blob' | 'enc'>[]> {
  const rows = await db().blobs.orderBy('createdAt').reverse().toArray();
  const strip = ({ blob: _b, enc: _e, ...rest }: BlobRecord) => rest;
  return [...[...mem.values()].sort((a, b) => b.createdAt - a.createdAt).map(strip), ...rows.map(strip)];
}

export async function imageUsage(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  await db().blobs.each((r) => {
    count++;
    bytes += r.size;
  });
  return { count, bytes };
}

export function forgetTemporaryImages(conversationId: string) {
  for (const [k, r] of mem) if (r.conversationId === conversationId) mem.delete(k);
}

/** Encrypt (to: a key) or decrypt (to: null) every stored image; safe to re-run after an interruption */
export async function resealImages(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  const ids = (await db().blobs.toCollection().primaryKeys()) as string[];
  let done = 0;
  for (const id of ids) {
    const rec = await db().blobs.get(id);
    if (!rec) continue;
    const already = to ? !!rec.enc && from === to : !!rec.blob;
    if (!already) {
      const blob = await toBlob(rec, from);
      const { blob: _b, enc: _e, ...meta } = rec;
      await db().blobs.put(to ? { ...meta, enc: await sealBytes(to, await blob.arrayBuffer()) } : { ...meta, blob });
    }
    onProgress?.(++done, ids.length);
  }
}

// ---- Backups (optional; images are large) ----
export interface ExportedImage {
  id: string;
  conversationId: string;
  messageId: string;
  createdAt: number;
  mime: string;
  /** base64 */
  data: string;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
}

export async function exportImages(): Promise<ExportedImage[]> {
  const out: ExportedImage[] = [];
  for (const rec of await db().blobs.toArray()) {
    const blob = await toBlob(rec);
    out.push({ id: rec.id, conversationId: rec.conversationId, messageId: rec.messageId, createdAt: rec.createdAt, mime: rec.mime, data: toBase64(await blob.arrayBuffer()) });
  }
  return out;
}

/** Import images; existing ids are skipped. Returns how many were added */
export async function importImages(list: ExportedImage[], conversationIds: Set<string>): Promise<number> {
  let n = 0;
  for (const im of list) {
    if (!conversationIds.has(im.conversationId) || !/^image\//.test(im.mime) || (await db().blobs.get(im.id))) continue;
    const blob = base64ToBlob(im.data, im.mime);
    const key = currentDataKey();
    const base = { id: im.id, conversationId: im.conversationId, messageId: im.messageId, createdAt: im.createdAt, mime: im.mime, size: blob.size };
    await db().blobs.put(key ? { ...base, enc: await sealBytes(key, await blob.arrayBuffer()) } : { ...base, blob });
    n++;
  }
  return n;
}

/** Where an image belongs (without loading its bytes) */
export async function getImageMeta(id: string): Promise<{ conversationId: string; messageId: string; temporary: boolean } | null> {
  const m = mem.get(id);
  if (m) return { conversationId: m.conversationId, messageId: m.messageId, temporary: true };
  const r = await db().blobs.get(id);
  return r ? { conversationId: r.conversationId, messageId: r.messageId, temporary: false } : null;
}

export async function deleteImageRecords(ids: string[]): Promise<void> {
  for (const id of ids) mem.delete(id);
  await db().blobs.bulkDelete(ids);
}
