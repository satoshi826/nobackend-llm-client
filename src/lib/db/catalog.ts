// The catalog: what is known about every file and every image without their contents, kept in memory while the data
// is open, with an index of paths. Lists, path checks and lookups by path read it instead of the database; the
// writers in files.ts and images.ts change it as they write, so it is never read back from storage after it loads.
// It loads once the data can be read (stored data in an older shape is converted first: convert.ts).
import { db, type BlobRecord, type FileRecord, type ImageInfo, type Origin } from './schema';
import { currentDataKey, DataLockedError, unseal } from './sealed';
import { openJSON, type DataKey } from '../crypto/data';
import { pathKey, type PathSpace } from '../paths';
import { convertFile, convertImageInfo, isOldFile, isOldImageInfo } from './convert';

/** An image or a video as lists show it: without its bytes */
export interface ImageEntry {
  id: string;
  mime: string;
  size: number;
  createdAt: number;
  /** Made in a chat: the conversation and message it belongs to */
  conversationId?: string;
  messageId?: string;
  /** Its path (named by the time it was saved when it came with no name) */
  path: string;
  origin: Origin;
}

/** An image record's info, opened (images made in a chat have none) */
export async function infoOf(rec: BlobRecord, key: DataKey | null = currentDataKey()): Promise<ImageInfo | undefined> {
  if (rec.info) return rec.info;
  if (!rec.infoEnc) return undefined;
  if (!key) throw new DataLockedError();
  return openJSON<ImageInfo>(key, rec.infoEnc);
}

export function imageEntry(rec: Omit<BlobRecord, 'info' | 'infoEnc'>, info: ImageInfo): ImageEntry {
  return {
    id: rec.id,
    mime: rec.mime,
    size: rec.size,
    createdAt: rec.createdAt,
    ...(rec.conversationId ? { conversationId: rec.conversationId } : {}),
    ...(rec.messageId ? { messageId: rec.messageId } : {}),
    path: info.path,
    origin: info.origin
  };
}

const files = new Map<string, FileRecord>();
const images = new Map<string, ImageEntry>();
/** Path key → id, for files and images with a path */
const byPath = new Map<string, string>();
/** Folder key ('a/b/') → how many paths lie in it */
const folders = new Map<string, number>();
/** The path each id has in the index, to take it out when it changes */
const pathOfId = new Map<string, string>();
/** Files and images that live in memory only (temporary chats) */
const temporary = new Set<string>();

let loading: Promise<void> | null = null;

let queue: Promise<unknown> = Promise.resolve();
/**
 * Run `fn` with the paths in use, one call at a time, so two saves started together cannot take the same path. `fn`
 * should save what it names, and read the records it changes, before it returns
 */
export function withTakenPaths<T>(fn: (space: PathSpace) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await ensureCatalog();
    return fn(catalogSpace);
  });
  queue = run.catch(() => undefined);
  return run;
}

function index(id: string, path: string | undefined) {
  const old = pathOfId.get(id);
  if (old !== undefined) {
    if (byPath.get(old) === id) byPath.delete(old);
    for (let i = old.indexOf('/'); i >= 0; i = old.indexOf('/', i + 1)) {
      const f = old.slice(0, i + 1);
      const n = (folders.get(f) ?? 1) - 1;
      if (n) folders.set(f, n);
      else folders.delete(f);
    }
    pathOfId.delete(id);
  }
  if (path === undefined) return;
  const k = pathKey(path);
  byPath.set(k, id);
  pathOfId.set(id, k);
  for (let i = k.indexOf('/'); i >= 0; i = k.indexOf('/', i + 1)) {
    const f = k.slice(0, i + 1);
    folders.set(f, (folders.get(f) ?? 0) + 1);
  }
}

async function load() {
  const [fileRows, imageRows] = await Promise.all([db().files.toArray(), db().blobs.toArray()]);
  // Opened together (decrypting is cheap); only records in an older shape are converted, one by one
  const opened = await Promise.all(fileRows.map((r) => unseal(r)));
  for (const f of opened) putFile(isOldFile(f) ? await convertFile(f) : f);
  const infos = await Promise.all(imageRows.map((r) => infoOf(r)));
  // One by one, so an image given a path takes it before the next one looks for a free one
  for (const [i, r] of imageRows.entries()) {
    const info = infos[i];
    putImage(imageEntry(r, isOldImageInfo(info) ? await convertImageInfo(r, info, catalogSpace) : info!));
  }
}

/** Load the catalog if it is not loaded (once per opening of the data; calls made meanwhile share the load) */
export function ensureCatalog(): Promise<void> {
  loading ??= load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Forget what was loaded (after an import, a change of the passphrase, or a wipe); temporary entries stay */
export function resetCatalog() {
  // Deleting the entry being visited is safe in a Map's iteration
  for (const id of files.keys()) if (!temporary.has(id)) dropFile(id);
  for (const id of images.keys()) if (!temporary.has(id)) dropImage(id);
  loading = null;
}

// ---- reading (call ensureCatalog first) ----
export const catalogFile = (id: string): FileRecord | undefined => files.get(id);
export const catalogImage = (id: string): ImageEntry | undefined => images.get(id);
export const isTemporary = (id: string): boolean => temporary.has(id);
/** Every file, most recently changed first */
export const allFiles = (): FileRecord[] => [...files.values()].sort((a, b) => b.updatedAt - a.updatedAt);
/** Every image and video, newest first */
export const allImages = (): ImageEntry[] => [...images.values()].sort((a, b) => b.createdAt - a.createdAt);
/** What has this path: a file or an image */
export function atPath(path: string): { kind: 'file'; file: FileRecord } | { kind: 'image'; image: ImageEntry } | undefined {
  const id = byPath.get(pathKey(path));
  const f = id && files.get(id);
  if (f) return { kind: 'file', file: f };
  const im = id && images.get(id);
  return im ? { kind: 'image', image: im } : undefined;
}
/** The paths in use, for the checks in lib/paths.ts */
export const catalogSpace: PathSpace = { ownerOf: (k) => byPath.get(k), holds: (f) => folders.has(f) };

// ---- writing (only files.ts and images.ts, as they write) ----
export function putFile(f: FileRecord, inMemory = false) {
  files.set(f.id, f);
  if (inMemory) temporary.add(f.id);
  index(f.id, f.name);
}
export function dropFile(id: string) {
  files.delete(id);
  temporary.delete(id);
  index(id, undefined);
}
export function putImage(e: ImageEntry, inMemory = false) {
  images.set(e.id, e);
  if (inMemory) temporary.add(e.id);
  index(e.id, e.path);
}
export function dropImage(id: string) {
  images.delete(id);
  temporary.delete(id);
  index(id, undefined);
}
