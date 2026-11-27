// Image storage: images and videos made in chats, and images the user brought in (uploaded or fetched from the web).
// Images of temporary chats stay in memory only. With a passphrase (a data key is set) the bytes, the thumbnail and
// an image's path and origin are encrypted with the same data key as conversations. What lists show comes from the
// catalog (catalog.ts), which these writers keep up to date.
import { db, type BlobRecord, type ImageInfo, type Origin, type SealedBytes } from './schema';
import { currentDataKey, DataLockedError } from './sealed';
import { openBytes, sealBytes, sealJSON, type DataKey } from '../crypto/data';
import { allImages, dropImage, ensureCatalog, imageEntry, infoOf, putImage as catalogPut, resetCatalog, withTakenPaths, type ImageEntry } from './catalog';
import { cleanFileName, extOfMime, freePath, timeName } from '../paths';
import { registerDataTable } from './data-tables';
import { storeChanged } from './changes';
import { t } from './messages';

const mem = new Map<string, BlobRecord>();

export interface ImageMeta {
  id: string;
  mime: string;
  /** Made in a chat: the conversation and message it belongs to */
  conversationId?: string;
  messageId?: string;
  /** Where it came from (default: made in a chat) */
  origin?: Origin;
  /** The folder it goes in ('a/'; default: the top) */
  folder?: string;
  /** Its file name, when it has one (brought in); else it is named by the time it is saved: '20261127-160816.webp' */
  name?: string;
}

async function storedInfo(info: ImageInfo, key: DataKey | null): Promise<Pick<BlobRecord, 'info' | 'infoEnc'>> {
  return key ? { infoEnc: await sealJSON(key, info) } : { info };
}

/** A stored image's info (every image has one once the catalog has loaded: convert.ts) */
async function infoOfStored(rec: BlobRecord): Promise<ImageInfo> {
  const info = await infoOf(rec);
  if (!info) throw new Error(`Image ${rec.id} has no path`);
  return info;
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

/**
 * Save an image or a video (encrypted when a data key is set). poster: a frame to make the thumbnail from (videos;
 * an image is its own)
 */
export async function putImage(meta: ImageMeta, blob: Blob, temporary: boolean, poster?: Blob): Promise<string> {
  const base = { id: meta.id, mime: meta.mime, conversationId: meta.conversationId, messageId: meta.messageId, createdAt: Date.now(), size: blob.size };
  const thumb = await makeThumb(poster ?? blob);
  const key = currentDataKey();
  const bytes = temporary ? { blob } : await stored(blob, key);
  const sealedThumb = thumb && !temporary && key ? await seal(key, thumb) : thumb;
  // The path is chosen and saved in one turn of the queue, so two images saved in the same second get two names
  return withTakenPaths(async (space) => {
    const want = (meta.folder ?? '') + (meta.name ?? timeName(base.createdAt, extOfMime(meta.mime)));
    const info: ImageInfo = { path: freePath(cleanFileName(want, extOfMime(meta.mime)), space), origin: meta.origin ?? { kind: 'made' } };
    if (temporary) mem.set(meta.id, { ...base, info, ...bytes, ...(thumb ? { thumb } : {}) });
    else await db().blobs.put({ ...base, ...(await storedInfo(info, key)), ...bytes, thumb: sealedThumb ?? undefined });
    catalogPut(imageEntry(base, info), temporary);
    storeChanged('images');
    return info.path;
  });
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
/** The thumbnail (made when first needed for older images); null for a video without one */
export async function getImageThumb(id: string): Promise<Blob | null> {
  const video = (r: BlobRecord) => r.mime.startsWith('video/');
  const m = mem.get(id);
  if (m) return m.thumb instanceof Blob ? m.thumb : video(m) ? null : toBlob(m);
  const rec = await db().blobs.get(id);
  if (!rec) return null;
  const key = currentDataKey();
  if (rec.thumb instanceof Blob) return rec.thumb;
  if (rec.thumb) {
    if (!key) throw new DataLockedError();
    return open(key, rec.thumb, video(rec) ? 'image/webp' : rec.mime);
  }
  if (video(rec)) return null;
  const full = await toBlob(rec, key);
  const thumb = await makeThumb(full);
  if (thumb) await db().blobs.update(id, { thumb: key ? await seal(key, thumb) : thumb });
  return thumb ?? full;
}

/**
 * A stored image record with a new path (encrypted like the rest of its info), for the caller to put in a transaction
 * of its own. Undefined for a temporary image
 */
export async function renamedImageRecord(id: string, rename: (path: string) => string): Promise<BlobRecord | undefined> {
  const rec = await db().blobs.get(id);
  if (!rec) return undefined;
  const info = await infoOfStored(rec);
  const { info: _i, infoEnc: _e, ...rest } = rec;
  return { ...rest, ...(await storedInfo({ ...info, path: rename(info.path) }, currentDataKey())) };
}

/** Give images new paths (stored or temporary) */
export async function renameImages(changes: { id: string; path: string }[]): Promise<void> {
  await ensureCatalog();
  const recs: BlobRecord[] = [];
  for (const c of changes) {
    const m = mem.get(c.id);
    if (m) mem.set(c.id, { ...m, info: { ...m.info!, path: c.path } });
    else {
      const r = await renamedImageRecord(c.id, () => c.path);
      if (r) recs.push(r);
    }
  }
  if (recs.length) await db().blobs.bulkPut(recs);
  for (const c of changes) {
    const m = mem.get(c.id);
    const r = recs.find((x) => x.id === c.id);
    if (m) catalogPut(imageEntry(m, m.info!), true);
    else if (r) catalogPut(imageEntry(r, await infoOfStored(r)));
  }
  if (changes.length) storeChanged('images');
}

/** Images and videos as lists show them (no bytes), newest first */
export async function listImages(): Promise<ImageEntry[]> {
  await ensureCatalog();
  return allImages();
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
  for (const [k, r] of mem) {
    if (r.conversationId !== conversationId) continue;
    mem.delete(k);
    dropImage(k);
  }
  storeChanged('images');
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
      // The thumbnail moves to the new key (or plain); one never made is made from the image (a video has none to make)
      const old = rec.thumb instanceof Blob ? rec.thumb : rec.thumb && from ? await open(from, rec.thumb, 'image/webp') : null;
      const thumb = old ?? (rec.mime.startsWith('video/') ? null : await makeThumb(blob));
      const { blob: _b, enc: _e, thumb: _t, info: _i, infoEnc: _ie, ...meta } = rec;
      // An image still without info (made before images had paths) gets one when the catalog loads: convert.ts
      await db().blobs.put({ ...meta, ...(info ? await storedInfo(info, to) : {}), ...(await stored(blob, to)), thumb: thumb ? (to ? await seal(to, thumb) : thumb) : undefined });
    }
    onProgress?.(++done, ids.length);
  }
  resetCatalog();
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

/** Bytes as base64, and as a data: URL (how APIs take an input image) */
export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const blobToDataUrl = async (b: Blob) => `data:${b.type || 'image/png'};base64,${await blobToBase64(b)}`;

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
    // One from a backup made before images had paths comes without; it gets one when the catalog loads: convert.ts
    await db().blobs.put({ ...base, ...(im.info ? await storedInfo(im.info, key) : {}), ...(await stored(blob, key)) });
    n++;
  }
  if (n) {
    resetCatalog();
    storeChanged('images');
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
  for (const id of ids) {
    mem.delete(id);
    dropImage(id);
  }
  await db().blobs.bulkDelete(ids);
  storeChanged('images');
}

/** An image's info from a backup: today's shape, or the one before ({ name, source }); its path cleaned like a file's */
function cleanImageInfo(raw: any): ImageInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw.origin ?? raw.source;
  const origin = o?.kind === 'web' && typeof o.url === 'string' && /^https:\/\//.test(o.url) ? { kind: 'web' as const, url: o.url.slice(0, 2000) } : o?.kind === 'upload' ? { kind: 'upload' as const } : { kind: 'made' as const };
  const path = typeof raw.path === 'string' ? raw.path : typeof raw.name === 'string' ? raw.name : undefined;
  return path ? { path: cleanFileName(path, 'png'), origin } : undefined;
}

registerDataTable<ExportedImage>({
  key: 'images',
  exportRows: async ({ includeImages }) => (includeImages ? exportImages() : undefined),
  clean: (raw) =>
    (Array.isArray(raw) ? raw : [])
      .filter(
        (im: any) =>
          !!im &&
          typeof im.id === 'string' &&
          (im.conversationId === undefined || typeof im.conversationId === 'string') &&
          (im.messageId === undefined || typeof im.messageId === 'string') &&
          typeof im.mime === 'string' &&
          typeof im.data === 'string' &&
          typeof im.createdAt === 'number'
      )
      .map((im: any): ExportedImage => ({ ...im, info: cleanImageInfo(im.info) })),
  importRows: (rows) => importImages(rows),
  reseal: resealImages,
  countMadeIn: (id) => db().blobs.where('conversationId').equals(id).count(),
  // Saved images outlive their conversation (they stay in the Files tab) unless the user deletes them with it;
  // a temporary chat's go with it
  async onConversationDeleted(id, { temporary, withItems }) {
    if (temporary) forgetTemporaryImages(id);
    else if (withItems) {
      const ids = (await db().blobs.where('conversationId').equals(id).primaryKeys()) as string[];
      await deleteImageRecords(ids);
    }
  }
});
