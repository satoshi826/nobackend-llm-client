// Image storage: images made in chats, and images the user brought in (uploaded or fetched from the web).
// Images of temporary chats stay in memory only. With a passphrase (a data key is set) the bytes, the thumbnail
// and a brought-in image's name and origin are encrypted with the same data key as conversations.
import { db, type BlobRecord, type ImageInfo, type SealedBytes } from './schema';
import { currentDataKey, DataLockedError } from './sealed';
import { openBytes, openJSON, sealBytes, sealJSON, type DataKey } from '../crypto/data';
import { registerDataTable } from './data-tables';
import { t } from './messages';

const mem = new Map<string, BlobRecord>();

export interface ImageMeta {
  id: string;
  mime: string;
  /** Made in a chat: the conversation and message it belongs to */
  conversationId?: string;
  messageId?: string;
  /** Brought in by the user */
  info?: ImageInfo;
}

/** An image record as listed: without its bytes, with its info readable */
export type ImageListing = Omit<BlobRecord, 'blob' | 'enc' | 'thumb' | 'infoEnc'>;

async function storedInfo(info: ImageInfo | undefined, key: DataKey | null): Promise<Pick<BlobRecord, 'info' | 'infoEnc'>> {
  if (!info) return {};
  return key ? { infoEnc: await sealJSON(key, info) } : { info };
}

async function infoOf(rec: BlobRecord, key: DataKey | null = currentDataKey()): Promise<ImageInfo | undefined> {
  if (rec.info) return rec.info;
  if (!rec.infoEnc) return undefined;
  if (!key) throw new DataLockedError();
  return openJSON<ImageInfo>(key, rec.infoEnc);
}

async function seal(key: DataKey, blob: Blob): Promise<SealedBytes> {
  const s = await sealBytes(key, await blob.arrayBuffer());
  return { iv: s.iv, data: new Blob([s.data], { type: blob.type }) };
}

async function open(key: DataKey, s: SealedBytes, mime: string): Promise<Blob> {
  return new Blob([await openBytes(key, { iv: s.iv, data: await s.data.arrayBuffer() })], { type: s.data.type || mime });
}

/** Stored form of an image's bytes: encrypted when a data key is given */
async function stored(blob: Blob, key: DataKey | null): Promise<Pick<BlobRecord, 'blob' | 'enc'>> {
  return key ? { enc: await seal(key, blob) } : { blob };
}

/** Longest side of a thumbnail (sharp in a grid tile on a 2x screen) */
const THUMB_SIZE = 480;

/** A small copy for grids and previews (null where the browser cannot draw off screen) */
async function makeThumb(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    // WebP keeps transparency (background removal); a browser that cannot write it gives PNG
    const thumb = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    return thumb.size < blob.size ? thumb : blob;
  } catch {
    return null;
  }
}

async function storedThumb(blob: Blob, key: DataKey | null): Promise<BlobRecord['thumb']> {
  const thumb = await makeThumb(blob);
  return thumb ? (key ? seal(key, thumb) : thumb) : undefined;
}

/** Save an image (encrypted when a data key is set) */
export async function putImage(meta: ImageMeta, blob: Blob, temporary: boolean): Promise<void> {
  const { info, ...rest } = meta;
  const base = { ...rest, createdAt: Date.now(), size: blob.size };
  if (temporary) {
    mem.set(meta.id, { ...base, info, blob });
    return;
  }
  const key = currentDataKey();
  await db().blobs.put({ ...base, ...(await storedInfo(info, key)), ...(await stored(blob, key)), thumb: await storedThumb(blob, key) });
}

async function toBlob(rec: BlobRecord, key: DataKey | null = currentDataKey()): Promise<Blob> {
  if (rec.blob) return rec.blob;
  if (!rec.enc) throw new Error(t('images.noData'));
  if (!key) throw new DataLockedError();
  return open(key, rec.enc, rec.mime);
}

export async function getImage(id: string): Promise<Blob | null> {
  const rec = mem.get(id) ?? (await db().blobs.get(id));
  return rec ? toBlob(rec) : null;
}

/** The thumbnail of an image (made and saved on first use for images stored before thumbnails existed) */
export async function getImageThumb(id: string): Promise<Blob | null> {
  const m = mem.get(id);
  if (m) return toBlob(m);
  const rec = await db().blobs.get(id);
  if (!rec) return null;
  const key = currentDataKey();
  if (rec.thumb instanceof Blob) return rec.thumb;
  if (rec.thumb) {
    if (!key) throw new DataLockedError();
    return open(key, rec.thumb, rec.mime);
  }
  const full = await toBlob(rec, key);
  const thumb = await makeThumb(full);
  if (thumb) await db().blobs.update(id, { thumb: key ? await seal(key, thumb) : thumb });
  return thumb ?? full;
}

/** Image records without the bytes, newest first (for the gallery) */
export async function listImages(): Promise<ImageListing[]> {
  const rows = await db().blobs.orderBy('createdAt').reverse().toArray();
  const strip = async (r: BlobRecord): Promise<ImageListing> => {
    const { blob: _b, enc: _e, thumb: _t, infoEnc: _i, ...rest } = r;
    const info = await infoOf(r);
    return info ? { ...rest, info } : rest;
  };
  return Promise.all([...[...mem.values()].sort((a, b) => b.createdAt - a.createdAt), ...rows].map(strip));
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
      const info = await infoOf(rec, from);
      // The thumbnail is made again from the image (under the new key, or plain)
      const { blob: _b, enc: _e, thumb: _t, info: _i, infoEnc: _ie, ...meta } = rec;
      await db().blobs.put({ ...meta, ...(await storedInfo(info, to)), ...(await stored(blob, to)), thumb: await storedThumb(blob, to) });
    }
    onProgress?.(++done, ids.length);
  }
}

// ---- Backups (optional; images are large) ----
export interface ExportedImage {
  id: string;
  conversationId?: string;
  messageId?: string;
  info?: ImageInfo;
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
    out.push({ id: rec.id, conversationId: rec.conversationId, messageId: rec.messageId, info: await infoOf(rec), createdAt: rec.createdAt, mime: rec.mime, data: toBase64(await blob.arrayBuffer()) });
  }
  return out;
}

/** Import images; existing ids are skipped. Returns how many were added */
export async function importImages(list: ExportedImage[]): Promise<number> {
  let n = 0;
  for (const im of list) {
    if (!/^image\//.test(im.mime) || (await db().blobs.get(im.id))) continue;
    const blob = base64ToBlob(im.data, im.mime);
    const key = currentDataKey();
    const base = { id: im.id, conversationId: im.conversationId, messageId: im.messageId, createdAt: im.createdAt, mime: im.mime, size: blob.size };
    await db().blobs.put({ ...base, ...(await storedInfo(im.info, key)), ...(await stored(blob, key)) });
    n++;
  }
  return n;
}

/** Where an image belongs (without loading its bytes) */
export async function getImageMeta(id: string): Promise<{ conversationId?: string; messageId?: string; temporary: boolean } | null> {
  const m = mem.get(id);
  if (m) return { conversationId: m.conversationId, messageId: m.messageId, temporary: true };
  const r = await db().blobs.get(id);
  return r ? { conversationId: r.conversationId, messageId: r.messageId, temporary: false } : null;
}

export async function deleteImageRecords(ids: string[]): Promise<void> {
  for (const id of ids) mem.delete(id);
  await db().blobs.bulkDelete(ids);
}

registerDataTable<ExportedImage>({
  key: 'images',
  exportRows: async ({ includeImages }) => (includeImages ? exportImages() : undefined),
  clean: (raw) =>
    (Array.isArray(raw) ? raw : []).filter(
      (im: any): im is ExportedImage =>
        !!im &&
        typeof im.id === 'string' &&
        (im.conversationId === undefined || typeof im.conversationId === 'string') &&
        (im.messageId === undefined || typeof im.messageId === 'string') &&
        (im.info === undefined || (typeof im.info?.name === 'string' && (im.info.source?.kind === 'upload' || (im.info.source?.kind === 'web' && typeof im.info.source.url === 'string')))) &&
        typeof im.mime === 'string' &&
        typeof im.data === 'string' &&
        typeof im.createdAt === 'number'
    ),
  importRows: (rows) => importImages(rows),
  reseal: resealImages,
  countMadeIn: (id) => db().blobs.where('conversationId').equals(id).count(),
  // Saved images outlive their conversation (they stay in the Files tab) unless the user deletes them with it;
  // a temporary chat's go with it
  async onConversationDeleted(id, { temporary, withItems }) {
    if (temporary) forgetTemporaryImages(id);
    else if (withItems) await db().blobs.where('conversationId').equals(id).delete();
  }
});
