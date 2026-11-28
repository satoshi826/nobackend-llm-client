// How much each kind of stored data takes, for Settings → プライバシーとデータ. Sizes are estimates of the records;
// the browser's own files are larger (it frees deleted data only later, and keeps its own bookkeeping)
import { db } from './schema';

export interface StorageUse {
  count: number;
  bytes: number;
}

export interface StorageBreakdown {
  /** Conversations and their messages (count: conversations) */
  conversations: StorageUse;
  /** Images with their thumbnails */
  images: StorageUse;
  /** Videos (kept with the images) with their thumbnails */
  videos: StorageUse;
  /** Files with their earlier versions (count: files) */
  files: StorageUse;
  /** Bytes of the settings, the model lists, the usage log, saved prompts and skills with their files */
  other: number;
}

/** Rough stored size of a value: binary data as is, one byte per Latin-1 character and two per any other */
export function approxBytes(v: unknown): number {
  if (v == null) return 0;
  // oxlint-disable-next-line no-control-regex -- the range starts at U+0000 to cover every one-byte character
  if (typeof v === 'string') return /[^\u0000-\u00ff]/.test(v) ? v.length * 2 : v.length;
  if (typeof v !== 'object') return 8;
  if (v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v.byteLength;
  let n = 0;
  for (const [k, x] of Object.entries(v)) n += k.length + approxBytes(x);
  return n;
}

/** Reads every record once, one at a time (a cursor, so memory stays flat with tens of thousands of messages) */
async function measure(tables: string[], counted: string): Promise<StorageUse> {
  let bytes = 0;
  for (const name of tables) await db().table(name).each((r) => void (bytes += approxBytes(r)));
  return { count: await db().table(counted).count(), bytes };
}

/** Images and videos share one table */
async function media(): Promise<{ images: StorageUse; videos: StorageUse }> {
  const images = { count: 0, bytes: 0 };
  const videos = { count: 0, bytes: 0 };
  await db().blobs.each((r) => {
    const into = r.mime.startsWith('video/') ? videos : images;
    into.count++;
    into.bytes += approxBytes(r);
  });
  return { images, videos };
}

export async function storageBreakdown(): Promise<StorageBreakdown> {
  return {
    conversations: await measure(['conversations', 'messages'], 'conversations'),
    ...(await media()),
    files: await measure(['files', 'fileTexts'], 'files'),
    other: (await measure(['settings', 'models', 'usage', 'prompts', 'skills', 'skillFiles'], 'settings')).bytes
  };
}
