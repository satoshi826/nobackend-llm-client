// The catalog: what is known about every file without its content, kept in memory while the data is open, with an
// index of paths. Lists, path checks and lookups by path read it instead of the database; the writers in files.ts
// change it as they write, so it is never read back from storage after it loads. It loads once the data can be read
// (stored data in an older shape is converted first: convert.ts).
import { db, type FileRecord } from './schema';
import { unseal } from './sealed';
import { isTextMime, pathKey, type PathSpace } from '../paths';
import { convertFile, convertImage, isOldFile } from './convert';

/** What a file holds, from its type: text is read and written as text; the rest are bytes */
export type FileKind = 'text' | 'image' | 'video' | 'pdf' | 'other';

export const kindOfMime = (mime: string): FileKind =>
  isTextMime(mime) ? 'text' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf' : 'other';

type EntryBase = Omit<FileRecord, 'preview'>;
/** A file as lists show it: its record, with what it holds told once, when it is read (kind) */
export type FileEntry = (EntryBase & { kind: 'text'; preview: string }) | (EntryBase & { kind: Exclude<FileKind, 'text'> });
/** A text file as lists show it */
export type TextEntry = Extract<FileEntry, { kind: 'text' }>;

/** A record as the catalog keeps it */
export function entryOf(r: FileRecord): FileEntry {
  const kind = kindOfMime(r.mime);
  const { preview, ...rest } = r;
  return kind === 'text' ? { ...rest, kind, preview: preview ?? '' } : { ...rest, kind };
}

/** An entry as it is stored (a record as it is) */
export function recordOf(e: FileRecord | FileEntry): FileRecord {
  if (!('kind' in e)) return e;
  const { kind: _k, ...rest } = e;
  return rest;
}

const files = new Map<string, FileEntry>();
/** Path key → id */
const byPath = new Map<string, string>();
/** Folder key ('a/b/') → how many paths lie in it */
const folders = new Map<string, number>();
/** The path each id has in the index, to take it out when it changes */
const pathOfId = new Map<string, string>();
/** Files that live in memory only (temporary chats) */
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
  // Opened together (decrypting is cheap); only records in an older shape are converted, one by one
  const opened = await Promise.all((await db().files.toArray()).map((r) => unseal(r)));
  for (const f of opened) putFile(isOldFile(f) ? await convertFile(f) : f);
  // Images and videos from the table before files held them all, one by one, so one given a path takes it before
  // the next one looks for a free one
  for (const id of (await db().blobs.toCollection().primaryKeys()) as string[]) {
    const f = await convertImage(id, catalogSpace);
    if (f) putFile(f);
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
  loading = null;
}

// ---- reading (call ensureCatalog first) ----
export const catalogFile = (id: string): FileEntry | undefined => files.get(id);
export const isTemporary = (id: string): boolean => temporary.has(id);
/** Every file, most recently changed first */
export const allFiles = (): FileEntry[] => [...files.values()].sort((a, b) => b.updatedAt - a.updatedAt);
/** The file at this path */
export function atPath(path: string): FileEntry | undefined {
  const id = byPath.get(pathKey(path));
  return id ? files.get(id) : undefined;
}
/** The paths in use, for the checks in lib/paths.ts */
export const catalogSpace: PathSpace = { ownerOf: (k) => byPath.get(k), holds: (f) => folders.has(f) };

// ---- writing (only files.ts and paths.ts, as they write) ----
export function putFile(f: FileRecord, inMemory = false): FileEntry {
  const e = entryOf(f);
  files.set(f.id, e);
  if (inMemory) temporary.add(f.id);
  index(f.id, f.path);
  return e;
}
export function dropFile(id: string) {
  files.delete(id);
  temporary.delete(id);
  index(id, undefined);
}
