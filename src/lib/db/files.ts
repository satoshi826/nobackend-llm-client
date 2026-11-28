// File storage: every file the app keeps, of any type: documents a model wrote, images and videos a chat made, files
// the user brought in, data a page saved. A file's record (files) holds what lists show; its content lives apart
// (fileData): the current one, the one before its last change (for undo), nothing older, and a thumbnail for images
// and videos. A text is kept as text, anything else as bytes. Lists and path checks read the catalog (catalog.ts),
// which these writers keep up to date; a content is read only when it is needed. Files of temporary chats stay in
// memory. With a passphrase, records and texts are encrypted (sealed.ts), and bytes apart (bytes.ts).
import { db, PREVIEW_CHARS, textBytes, type FileData, type FileRecord, type Origin, type SavedBy, type Stamp } from './schema';
import { currentDataKey, seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';
import type { DataTable } from './data-tables';
import { filesChanged } from './changes';
import { allFiles, catalogFile, dropFile, ensureCatalog, isTemporary, putFile as catalogPut, recordOf, resetCatalog, withTakenPaths, type FileEntry, type TextEntry } from './catalog';
import { cleanFileName, extOfMime, freePath, mimeFromName, timeName } from '../paths';
import { isStoredAs, openStored, storedBytes } from './bytes';
import { base64ToBlob } from '../base64';

/** Upper bound for one file's text */
export const MAX_FILE_CHARS = 2_000_000;

type Which = 'current' | 'previous' | 'thumb';
const dataId = (id: string, which: Which) => `${id}:${which}`;
/** Contents of temporary files, by data id */
const mem = new Map<string, string | Blob>();

/** The thumbnail's type when it is encrypted (made as WebP; a browser that cannot write it gives PNG, which shows as well) */
const THUMB_MIME = 'image/webp';

/** A content's stored row: a text sealed with the record's key, bytes encrypted apart */
async function rowOf(fileId: string, which: Which, content: string | Blob, key: DataKey | null): Promise<FileData> {
  const id = dataId(fileId, which);
  return typeof content === 'string' ? seal('fileData', { id, fileId, text: content }, key) : { id, fileId, data: await storedBytes(content, key) };
}

/** A stored row's content: its text, or its bytes typed `mime` */
async function contentOf(row: FileData, mime: string, key: DataKey | null = currentDataKey()): Promise<string | Blob> {
  if ('data' in row) return openStored(row.data, mime, key);
  const r = await unseal(row, key);
  return 'text' in r ? r.text : '';
}

/** A text file's record (not saved) */
export function newFile(o: { id: string; path: string; origin: Origin; text: string; by: SavedBy; conversationId?: string; mime?: string }): FileRecord {
  const now = Date.now();
  return {
    id: o.id,
    path: o.path,
    mime: o.mime ?? mimeFromName(o.path),
    origin: o.origin,
    ...(o.conversationId ? { conversationId: o.conversationId } : {}),
    createdAt: now,
    updatedAt: now,
    bytes: textBytes(o.text),
    preview: o.text.slice(0, PREVIEW_CHARS),
    current: { at: now, by: o.by }
  };
}

/** Write a record and the contents that changed with it, in one transaction (or in memory for a temporary file) */
async function write(f: FileRecord, contents: Partial<Record<Which, string | Blob>>, inMemory: boolean): Promise<FileEntry> {
  if (inMemory) {
    for (const [w, c] of Object.entries(contents)) mem.set(dataId(f.id, w as Which), c);
  } else {
    // Encrypt first: a transaction ends as soon as it waits on anything but the database
    const key = currentDataKey();
    const rows = await Promise.all(Object.entries(contents).map(([w, c]) => rowOf(f.id, w as Which, c, key)));
    const rec = await seal('files', recordOf(f), key);
    await db().transaction('rw', db().files, db().fileData, async () => {
      if (rows.length) await db().fileData.bulkPut(rows);
      await db().files.put(rec);
    });
  }
  const e = catalogPut(recordOf(f), inMemory);
  filesChanged();
  return e;
}

/** A written entry as the text file it must be */
function asText(e: FileEntry): TextEntry {
  if (e.kind !== 'text') throw new Error(`${e.path} is not a text file`);
  return e;
}

/** Save a new text file with its text */
export async function createFile(f: FileRecord, text: string, temporary = false): Promise<TextEntry> {
  await ensureCatalog();
  return asText(await write(f, { current: text }, temporary));
}

/** Longest side of a thumbnail (sharp in a grid tile on a 2x screen) */
const THUMB_SIZE = 480;

/** A small copy for grids and previews (null where the browser cannot draw off screen, or for what is no picture) */
async function makeThumb(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    // WebP keeps transparency (background removal); a browser that cannot write it gives PNG
    const thumb = await canvas.convertToBlob({ type: THUMB_MIME, quality: 0.8 });
    return thumb.size < blob.size ? thumb : blob;
  } catch {
    return null;
  }
}

/** A new file of bytes, as lists of what was brought in or made describe it */
export interface NewBytes {
  id: string;
  mime: string;
  origin: Origin;
  /** The conversation it was made in or brought into, and the answer that shows it (images and videos a chat made) */
  conversationId?: string;
  messageId?: string;
  /** The folder it goes in ('a/'; default: the top) */
  folder?: string;
  /** Its file name, when it has one; else it is named by the time it is saved: '20261127-160816.webp' */
  name?: string;
}

/**
 * Save a new file of bytes at a free path (a taken name gets a number). An image gets a thumbnail; poster: a frame to
 * make a video's from
 */
export async function storeBytes(meta: NewBytes, blob: Blob, temporary: boolean, poster?: Blob): Promise<FileEntry> {
  const now = Date.now();
  const thumb = meta.mime.startsWith('image/') || poster ? await makeThumb(poster ?? blob) : null;
  // The path is chosen and saved in one turn of the queue, so two files saved in the same second get two names
  return withTakenPaths(async (space) => {
    const ext = extOfMime(meta.mime);
    const want = (meta.folder ?? '') + (meta.name ?? timeName(now, ext));
    const f: FileRecord = {
      id: meta.id,
      path: freePath(cleanFileName(want, ext), space),
      mime: meta.mime,
      origin: meta.origin,
      ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
      ...(meta.messageId ? { messageId: meta.messageId } : {}),
      createdAt: now,
      updatedAt: now,
      bytes: blob.size,
      current: { at: now, by: meta.origin.kind === 'made' ? 'model' : 'upload' }
    };
    return write(f, { current: blob, ...(thumb ? { thumb } : {}) }, temporary);
  });
}

/** Save a file's record itself (a rename, a move); its contents stay */
export async function putFile(f: TextEntry): Promise<TextEntry>;
export async function putFile(f: FileRecord | FileEntry): Promise<FileEntry>;
export async function putFile(f: FileRecord | FileEntry): Promise<FileEntry> {
  await ensureCatalog();
  return write(recordOf(f), {}, isTemporary(f.id));
}

export async function getFile(id: string): Promise<FileEntry | undefined> {
  await ensureCatalog();
  return catalogFile(id);
}

/** All files, most recently changed first */
export async function listFiles(): Promise<FileEntry[]> {
  await ensureCatalog();
  return allFiles();
}

async function readData(id: string, which: Which, mime: string): Promise<string | Blob | undefined> {
  const m = mem.get(dataId(id, which));
  if (m !== undefined) return m;
  const row = await db().fileData.get(dataId(id, which));
  return row && contentOf(row, mime);
}

/** A text file's current text, or the one before its last change ('' when there is none) */
export async function readText(id: string, which: 'current' | 'previous' = 'current'): Promise<string> {
  const c = await readData(id, which, '');
  return typeof c === 'string' ? c : '';
}

/** The current texts of several text files, by id (read together) */
export async function readTexts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const stored = ids.filter((id) => {
    const m = mem.get(dataId(id, 'current'));
    if (typeof m === 'string') out.set(id, m);
    return m === undefined;
  });
  const rows = await db().fileData.bulkGet(stored.map((id) => dataId(id, 'current')));
  const opened = await Promise.all(rows.map((r) => (r && !('data' in r) ? unseal(r) : null)));
  stored.forEach((id, i) => {
    const r = opened[i];
    out.set(id, r && 'text' in r ? r.text : '');
  });
  return out;
}

/** A file's current content as bytes, typed by its type (a text as UTF-8); null when it is not stored in this browser */
export async function readBytes(id: string): Promise<Blob | null> {
  await ensureCatalog();
  const f = catalogFile(id);
  if (!f) return null;
  const c = await readData(id, 'current', f.mime);
  if (c === undefined) return null;
  return typeof c === 'string' ? new Blob([c], { type: f.mime }) : c;
}

/** An image's or a video's thumbnail (made when first needed for an image stored without one); null when there is none */
export async function readThumb(id: string): Promise<Blob | null> {
  await ensureCatalog();
  const f = catalogFile(id);
  if (!f || (f.kind !== 'image' && f.kind !== 'video')) return null;
  const had = await readData(id, 'thumb', THUMB_MIME);
  if (had instanceof Blob) return had;
  if (f.kind === 'video') return null;
  const full = await readBytes(id);
  const thumb = full && (await makeThumb(full));
  if (!thumb) return full;
  if (isTemporary(id)) mem.set(dataId(id, 'thumb'), thumb);
  else await db().fileData.put(await rowOf(id, 'thumb', thumb, currentDataKey()));
  return thumb;
}

/**
 * Save a new current text. The one it replaces becomes the previous text, unless keepPrevious (appending to a file
 * being written, a page saving its data): then the previous text stays as it was. now: its time, when the caller
 * must know it before the change is heard of
 */
export async function setText(id: string, text: string, by: SavedBy, keepPrevious = false, now = Date.now()): Promise<TextEntry> {
  await ensureCatalog();
  const got = catalogFile(id);
  if (!got) throw new Error(`No file ${id}`);
  const f = asText(got);
  const stamp: Stamp = { at: now, by };
  const next: TextEntry = { ...f, current: stamp, bytes: textBytes(text), preview: text.slice(0, PREVIEW_CHARS), updatedAt: now, ...(keepPrevious ? {} : { previous: f.current }) };
  const contents: Partial<Record<Which, string>> = { current: text };
  if (!keepPrevious) contents.previous = await readText(id);
  return asText(await write(next, contents, isTemporary(id)));
}

function forget(id: string) {
  for (const w of ['current', 'previous', 'thumb'] as const) mem.delete(dataId(id, w));
  dropFile(id);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  await ensureCatalog();
  for (const id of ids) forget(id);
  await db().transaction('rw', db().files, db().fileData, async () => {
    await db().fileData.where('fileId').anyOf(ids).delete();
    await db().files.bulkDelete(ids);
  });
  filesChanged();
}

export const isTemporaryFile = (id: string): boolean => isTemporary(id);

/** Files of a temporary chat disappear with it */
export function forgetTemporaryFiles(conversationId: string) {
  for (const f of allFiles()) if (f.conversationId === conversationId && isTemporary(f.id)) forget(f.id);
  filesChanged();
}

/** How many stored files there are, and their bytes: text files (text) or the others */
export async function fileUsage(text: boolean): Promise<{ count: number; bytes: number }> {
  const files = (await listFiles()).filter((f) => !isTemporary(f.id) && (f.kind === 'text') === text);
  return { count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) };
}

/** Encrypt (to: a key) or decrypt (to: null) every file record and content; safe to re-run after an interruption */
async function resealFiles(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  // Converted first (under the old key), so nothing in an older shape is written in the clear
  await ensureCatalog();
  const rows = await db().files.toArray();
  let done = 0;
  for (const raw of rows) {
    const f = await unseal(raw, from);
    const data = await db().fileData.where('fileId').equals(f.id).toArray();
    const resealed = await Promise.all(
      data.map(async (r): Promise<FileData> => {
        if (!('data' in r)) return seal('fileData', await unseal(r, from), to);
        // Bytes already in the form asked for stay as they are (a run stopped halfway)
        if (isStoredAs(r.data, from, to)) return r;
        return { ...r, data: await storedBytes(await openStored(r.data, '', from), to) };
      })
    );
    const rec = await seal('files', f, to);
    await db().transaction('rw', db().files, db().fileData, async () => {
      if (resealed.length) await db().fileData.bulkPut(resealed);
      await db().files.put(rec);
    });
    onProgress?.(++done, rows.length);
  }
  resetCatalog();
}

// ---- backup: a file with its texts as a list of versions (previous, current), the shape older backups use too ----
export interface ExportedVersion {
  v: number;
  at: number;
  by: SavedBy;
  text: string;
}
export type ExportedFile = Omit<FileRecord, 'current' | 'previous' | 'preview' | 'bytes' | 'path'> & { name: string; versions: ExportedVersion[] };

export async function exportFiles(): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  for (const f of await listFiles()) {
    if (isTemporary(f.id) || f.kind !== 'text') continue;
    const { current, previous, preview: _p, bytes: _b, kind: _k, path, ...rest } = f;
    const [text, before] = await Promise.all([readText(f.id), previous ? readText(f.id, 'previous') : Promise.resolve(undefined)]);
    out.push({ ...rest, name: path, versions: [...(previous && before !== undefined ? [{ ...previous, text: before, v: 1 }] : []), { ...current, text, v: previous ? 2 : 1 }] });
  }
  return out;
}

/** Keep only well-formed file records (with their newest two versions); backups in older shapes are read too */
export function cleanFiles(raw: unknown): ExportedFile[] {
  if (!Array.isArray(raw)) return [];
  const isStr = (x: unknown): x is string => typeof x === 'string';
  const out: ExportedFile[] = [];
  for (const f of raw as any[]) {
    if (!f || !isStr(f.id) || !isStr(f.name) || !Array.isArray(f.versions)) continue;
    const versions: ExportedVersion[] = f.versions
      .filter((v: any) => v && isStr(v.text) && Number.isFinite(v.v))
      .map((v: any) => ({ v: v.v, at: Number.isFinite(v.at) ? v.at : Date.now(), text: v.text.slice(0, MAX_FILE_CHARS), by: v.by === 'user' || v.by === 'upload' ? v.by : 'model' }))
      .slice(-2);
    if (!versions.length) continue;
    const name = cleanFileName(f.name);
    const o = f.origin;
    // Older backups: kind ('document' | 'upload'), url
    const url = o?.kind === 'web' ? o.url : f.url;
    const origin: Origin = isStr(url) && url.startsWith('https://') ? { kind: 'web', url: url.slice(0, 2000) } : o?.kind === 'upload' || f.kind === 'upload' ? { kind: 'upload' } : { kind: 'made' };
    out.push({
      id: f.id,
      name,
      mime: mimeFromName(name),
      origin,
      ...(isStr(f.conversationId) ? { conversationId: f.conversationId } : {}),
      createdAt: Number.isFinite(f.createdAt) ? f.createdAt : Date.now(),
      updatedAt: Number.isFinite(f.updatedAt) ? f.updatedAt : Date.now(),
      versions
    });
  }
  return out;
}

/** Add files that do not exist yet; returns how many were added */
export async function importFiles(files: ExportedFile[]): Promise<number> {
  let n = 0;
  const key = currentDataKey();
  for (const f of files) {
    if (await db().files.get(f.id)) continue;
    const { versions, name, ...rest } = f;
    const current = versions[versions.length - 1];
    const before = versions.length > 1 ? versions[versions.length - 2] : undefined;
    const record: FileRecord = {
      ...rest,
      path: name,
      bytes: textBytes(current.text),
      preview: current.text.slice(0, PREVIEW_CHARS),
      current: { at: current.at, by: current.by },
      ...(before ? { previous: { at: before.at, by: before.by } } : {})
    };
    const rows = await Promise.all([rowOf(f.id, 'current', current.text, key), ...(before ? [rowOf(f.id, 'previous', before.text, key)] : [])]);
    const rec = await seal('files', record, key);
    await db().transaction('rw', db().files, db().fileData, async () => {
      await db().fileData.bulkPut(rows);
      await db().files.put(rec);
    });
    n++;
  }
  // Read again with what came in
  if (n) {
    resetCatalog();
    filesChanged();
  }
  return n;
}

// ---- backup of images and videos (optional: they are large) ----
export interface ExportedImage {
  id: string;
  conversationId?: string;
  messageId?: string;
  info?: { path: string; origin: Origin };
  createdAt: number;
  mime: string;
  /** The bytes (in a backup file: an entry of its zip, or base64 in backups before v7) */
  data: Blob;
}

export async function exportImages(): Promise<ExportedImage[]> {
  const out: ExportedImage[] = [];
  for (const f of await listFiles()) {
    if (isTemporary(f.id) || (f.kind !== 'image' && f.kind !== 'video')) continue;
    const data = await readBytes(f.id);
    if (data) out.push({ id: f.id, conversationId: f.conversationId, messageId: f.messageId, info: { path: f.path, origin: f.origin }, createdAt: f.createdAt, mime: f.mime, data });
  }
  return out;
}

/** Import images and videos; existing ids are skipped, a taken path gets a number. Returns how many were added */
export async function importImages(list: ExportedImage[]): Promise<number> {
  let n = 0;
  await ensureCatalog();
  for (const im of list) {
    if (!/^(image|video)\//.test(im.mime) || (await db().files.get(im.id))) continue;
    const blob = im.data.slice(0, im.data.size, im.mime);
    const at = im.createdAt;
    await withTakenPaths(async (space) => {
      const f: FileRecord = {
        id: im.id,
        path: freePath(im.info?.path ?? timeName(at, extOfMime(im.mime)), space),
        mime: im.mime,
        origin: im.info?.origin ?? { kind: 'made' },
        ...(im.conversationId ? { conversationId: im.conversationId } : {}),
        ...(im.messageId ? { messageId: im.messageId } : {}),
        createdAt: at,
        updatedAt: at,
        bytes: blob.size,
        current: { at, by: im.info?.origin.kind === 'upload' || im.info?.origin.kind === 'web' ? 'upload' : 'model' }
      };
      await write(f, { current: blob }, false);
    });
    n++;
  }
  return n;
}

/** An image's info from a backup: today's shape, or the one before ({ name, source }); its path cleaned like a file's */
function cleanImageInfo(raw: any): ExportedImage['info'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw.origin ?? raw.source;
  const origin = o?.kind === 'web' && typeof o.url === 'string' && o.url.startsWith('https://') ? { kind: 'web' as const, url: o.url.slice(0, 2000) } : o?.kind === 'upload' ? { kind: 'upload' as const } : { kind: 'made' as const };
  const path = typeof raw.path === 'string' ? raw.path : typeof raw.name === 'string' ? raw.name : undefined;
  return path ? { path: cleanFileName(path, 'png'), origin } : undefined;
}

export const imagesTable: DataTable<ExportedImage> = {
  key: 'images',
  exportRows: async ({ includeImages }) => (includeImages ? exportImages() : undefined),
  clean: (raw, { files }) =>
    (Array.isArray(raw) ? raw : []).flatMap((im: any): ExportedImage[] => {
      if (
        !im ||
        typeof im.id !== 'string' ||
        (im.conversationId !== undefined && typeof im.conversationId !== 'string') ||
        (im.messageId !== undefined && typeof im.messageId !== 'string') ||
        typeof im.mime !== 'string' ||
        typeof im.createdAt !== 'number'
      )
        return [];
      // The bytes: base64 in the JSON (backups before v7), or the zip entry the row names
      const data = typeof im.data === 'string' ? base64ToBlob(im.data, im.mime) : typeof im.data?.file === 'string' ? files.get(im.data.file) : undefined;
      return data ? [{ id: im.id, conversationId: im.conversationId, messageId: im.messageId, info: cleanImageInfo(im.info), createdAt: im.createdAt, mime: im.mime, data }] : [];
    }),
  importRows: (rows) => importImages(rows)
};

export const filesTable: DataTable<ExportedFile> = {
  key: 'files',
  exportRows: () => exportFiles(),
  clean: (raw) => cleanFiles(raw),
  importRows: (rows) => importFiles(rows),
  reseal: resealFiles,
  countMadeIn: (id) => db().files.where('conversationId').equals(id).count(),
  // Files outlive the conversation they were made in unless the user deletes them with it; a temporary chat's go with it
  async onConversationDeleted(id, { temporary, withItems }) {
    if (temporary) forgetTemporaryFiles(id);
    else if (withItems) await deleteFiles((await db().files.where('conversationId').equals(id).primaryKeys()) as string[]);
  }
};
