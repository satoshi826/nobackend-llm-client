// File storage: documents written by the model and files the user uploaded (text only).
// A file keeps its current text and the text before its last change (for undo), nothing older. The record holds the
// current text; the previous one lives in its own table (fileVersions, one row per file), so listing files never
// loads it.
// Files of temporary chats stay in memory. With a passphrase, names and contents are encrypted (sealed.ts).
import { db, type FileRecord, type FileVersion, type FileVersionInfo } from './schema';
import { currentDataKey, seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';
import { registerDataTable } from './data-tables';
import { storeChanged } from './changes';

/** Upper bound for one file's text */
export const MAX_FILE_CHARS = 2_000_000;

const mem = new Map<string, FileRecord>();

const MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  pdf: 'application/pdf'
};

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function mimeFromName(name: string): string {
  return MIME[extOf(name)] ?? 'text/plain';
}

/** Folders a file name may hold, and the length of the whole name */
const MAX_FOLDERS = 7;
const MAX_PATH = 200;

/** The parts of a raw path: NFC, no control characters, `\\` as `/`, without empty, `.`, `..` and drive-letter parts */
function pathParts(raw: string): string[] {
  return (
    raw
      // One form for the same text (a Mac gives names in NFD), so names a model writes match names from a disk
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .split(/[\\/]/)
      .map((p) => p.trim())
      .filter((p) => p && p !== '.' && p !== '..' && !/^[a-z]:$/i.test(p))
  );
}

/** Clean a folder path ('Site / css' → 'Site/css/'); '' when nothing is left */
export function cleanFolderName(raw: string): string {
  const parts = pathParts(raw)
    .slice(0, MAX_FOLDERS)
    .map((p) => p.slice(0, 60));
  while (parts.length && parts.join('/').length > MAX_PATH - 20) parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}

/**
 * Clean a file name coming from a model, a disk or a backup. A name is a path: folders separated by `/` (a `\` counts
 * as one), in NFC, with no empty, `.` or `..` parts and no control characters, at most 7 folders deep and 200
 * characters long; the last part gets an extension when it has none. There are no folder records: a folder is the
 * shared start of names. Paths are unique across files and named images (paths.ts)
 */
export function cleanFileName(raw: string, fallbackExt = 'md'): string {
  const parts = pathParts(raw);
  let name = (parts.pop() ?? '').slice(0, 120) || 'untitled';
  if (!extOf(name)) name = `${name}.${fallbackExt}`;
  const folders = parts.slice(0, MAX_FOLDERS).map((p) => p.slice(0, 60));
  while (folders.length && [...folders, name].join('/').length > MAX_PATH) folders.pop();
  return [...folders, name].join('/');
}

/** The last part of a path: the name to show alone or to download as */
export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The folders of a path, with the closing `/` ('' at the top) */
export const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

export const currentText = (f: FileRecord): string => f.current.text;

const info = ({ text: _t, ...rest }: FileVersion): FileVersionInfo => rest;

/** A new file record (not saved) */
export function newFile(o: { id: string; name: string; kind: FileRecord['kind']; text: string; by: FileVersion['by']; conversationId?: string; source?: string; url?: string; mime?: string }): FileRecord {
  const now = Date.now();
  return {
    id: o.id,
    name: o.name,
    mime: o.mime ?? mimeFromName(o.name),
    kind: o.kind,
    conversationId: o.conversationId,
    createdAt: now,
    updatedAt: now,
    size: o.text.length,
    ...(o.source ? { source: o.source } : {}),
    ...(o.url ? { url: o.url } : {}),
    current: { at: now, text: o.text, by: o.by }
  };
}

/**
 * The record with a new current text (pure). The text it replaces becomes the previous one (returned, to keep
 * apart), unless keepPrevious: then the previous text stays as it was (appending to a file being written, a page
 * saving its data)
 */
export function withText(f: FileRecord, text: string, by: FileVersion['by'], keepPrevious = false): { next: FileRecord; previousText?: string } {
  const now = Date.now();
  const next: FileRecord = { ...f, current: { at: now, text, by }, size: text.length, updatedAt: now };
  if (keepPrevious) return { next };
  return { next: { ...next, previous: info(f.current) }, previousText: f.current.text };
}

/** Previous texts of temporary files, by file id */
const memPrevious = new Map<string, string>();

/** Save the record with its previous text (when it changed), in one transaction */
async function save(next: FileRecord, previousText?: string): Promise<FileRecord> {
  if (mem.has(next.id)) {
    if (previousText !== undefined) memPrevious.set(next.id, previousText);
    mem.set(next.id, next);
    storeChanged('files');
    return next;
  }
  // Encrypt first: a transaction ends as soon as it waits on anything but the database
  const textRec = previousText === undefined ? null : await seal('fileVersions', { id: next.id, fileId: next.id, text: previousText });
  const rec = await seal('files', next);
  await db().transaction('rw', db().files, db().fileVersions, async () => {
    if (textRec) await db().fileVersions.put(textRec);
    await db().files.put(rec);
  });
  storeChanged('files');
  return next;
}

/** Save a new current text; the one it replaces becomes the previous text, unless keepPrevious */
export async function setText(f: FileRecord, text: string, by: FileVersion['by'], keepPrevious = false): Promise<FileRecord> {
  const { next, previousText } = withText(f, text, by, keepPrevious);
  return save(next, previousText);
}

/** The text before the last change, if the file has one */
export async function previousText(f: FileRecord): Promise<string | undefined> {
  if (!f.previous) return undefined;
  if (mem.has(f.id)) return memPrevious.get(f.id);
  const r = await db().fileVersions.get(f.id);
  return r ? (await unseal(r)).text : undefined;
}

/** Undo the last change: the previous text becomes current, and the current one previous (so undo again redoes) */
export async function swapPrevious(f: FileRecord): Promise<FileRecord> {
  const before = await previousText(f);
  if (before === undefined || !f.previous) return f;
  const now = Date.now();
  return save({ ...f, current: { ...f.previous, text: before }, previous: info(f.current), size: before.length, updatedAt: now }, f.current.text);
}

/** Save the record itself (a new file, a rename). Text changes go through setText */
export async function putFile(f: FileRecord, temporary = false): Promise<void> {
  if (temporary || mem.has(f.id)) mem.set(f.id, f);
  else await db().files.put(await seal('files', f));
  storeChanged('files');
}

// Records from before: every version inside (before v9), or the current one with a list of earlier ones whose texts
// were rows '<id>:<v>' (v9). Both keep only the newest two
type OldVersion = FileVersion & { v?: number; note?: string };
type WithVersions = Omit<FileRecord, 'current' | 'previous'> & { versions: OldVersion[] };
type WithHistory = Omit<FileRecord, 'current' | 'previous'> & { current: OldVersion; history: (FileVersionInfo & { v: number })[] };
const plainVersion = (x: OldVersion): FileVersion => ({ at: x.at, text: x.text, by: x.by });

/** A record and its previous text from a list of versions, oldest first (a backup, or a record from before v9) */
function fromVersions(r: WithVersions): { record: FileRecord; previousText?: string } {
  const { versions, ...rest } = r;
  const current = versions[versions.length - 1];
  const before = versions.length > 1 ? versions[versions.length - 2] : undefined;
  return { record: { ...rest, current: plainVersion(current), ...(before ? { previous: info(plainVersion(before)) } : {}) }, ...(before ? { previousText: before.text } : {}) };
}

/** Open a stored record; one in an older shape is converted and written back in this one (under `key`) */
async function open(raw: FileRecord, key: DataKey | null = currentDataKey()): Promise<FileRecord> {
  const r = (await unseal(raw, key)) as FileRecord | WithVersions | WithHistory;
  let converted: { record: FileRecord; previousText?: string };
  if ('versions' in r && Array.isArray(r.versions)) converted = fromVersions(r);
  else if ('history' in r && Array.isArray(r.history)) {
    const { history, current, ...rest } = r;
    const last = history[history.length - 1];
    const row = last && (await db().fileVersions.get(`${r.id}:${last.v}`));
    const text = row ? (await unseal(row, key)).text : undefined;
    converted = { record: { ...rest, current: plainVersion(current), ...(text !== undefined ? { previous: { at: last.at, by: last.by } } : {}) }, previousText: text };
  } else return r as FileRecord;
  const { record, previousText } = converted;
  const textRec = previousText === undefined ? null : await seal('fileVersions', { id: record.id, fileId: record.id, text: previousText }, key);
  const rec = await seal('files', record, key);
  await db().transaction('rw', db().files, db().fileVersions, async () => {
    await db().fileVersions.where('fileId').equals(record.id).delete();
    if (textRec) await db().fileVersions.put(textRec);
    await db().files.put(rec);
  });
  return record;
}

/** The files made in or brought into a conversation, newest first */
export async function filesOfConversation(conversationId: string): Promise<FileRecord[]> {
  const temporary = [...mem.values()].filter((f) => f.conversationId === conversationId);
  const stored = await Promise.all((await db().files.where('conversationId').equals(conversationId).toArray()).map((r) => open(r)));
  return [...temporary, ...stored].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFile(id: string): Promise<FileRecord | undefined> {
  const m = mem.get(id);
  if (m) return m;
  const r = await db().files.get(id);
  return r ? open(r) : undefined;
}

/** All files, most recently changed first (current versions only) */
export async function listFiles(): Promise<FileRecord[]> {
  const stored = await Promise.all((await db().files.orderBy('updatedAt').reverse().toArray()).map((f) => open(f)));
  return [...mem.values(), ...stored].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  for (const id of ids) {
    mem.delete(id);
    memPrevious.delete(id);
  }
  await db().transaction('rw', db().files, db().fileVersions, async () => {
    await db().fileVersions.where('fileId').anyOf(ids).delete();
    await db().files.bulkDelete(ids);
  });
  storeChanged('files');
}

export function isTemporaryFile(id: string): boolean {
  return mem.has(id);
}

/** Files of a temporary chat disappear with it */
export function forgetTemporaryFiles(conversationId: string) {
  for (const [k, f] of mem) {
    if (f.conversationId !== conversationId) continue;
    mem.delete(k);
    memPrevious.delete(k);
  }
  storeChanged('files');
}

export async function fileUsage(): Promise<{ count: number; chars: number }> {
  let count = 0;
  let chars = 0;
  await db().files.each((f) => {
    count++;
    chars += f.size;
  });
  return { count, chars };
}

/** Encrypt (to: a key) or decrypt (to: null) every file and previous text; old-shape records are converted on the way */
async function resealFiles(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  const rows = await db().files.toArray();
  let done = 0;
  for (const raw of rows) {
    // Convert under the old key first, so no version of an old-shape record is ever written in the clear
    const f = await open(raw, from);
    const texts = await db().fileVersions.where('fileId').equals(f.id).toArray();
    const resealed = await Promise.all(texts.map(async (x) => seal('fileVersions', await unseal(x, from), to)));
    const rec = await seal('files', f, to);
    await db().transaction('rw', db().files, db().fileVersions, async () => {
      if (resealed.length) await db().fileVersions.bulkPut(resealed);
      await db().files.put(rec);
    });
    onProgress?.(++done, rows.length);
  }
}

// ---- backup: the previous and current texts as a list of versions, the shape older backups use too ----
export type ExportedFile = Omit<FileRecord, 'current' | 'previous'> & { versions: (FileVersion & { v: number })[] };

export async function exportFiles(): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  for (const raw of await db().files.toArray()) {
    const f = await open(raw);
    const before = await previousText(f);
    const { current, previous, ...rest } = f;
    out.push({ ...rest, versions: [...(previous && before !== undefined ? [{ ...previous, text: before, v: 1 }] : []), { ...current, v: previous && before !== undefined ? 2 : 1 }] });
  }
  return out;
}
/** Keep only well-formed file records (with their newest two versions) */
export function cleanFiles(raw: unknown): ExportedFile[] {
  if (!Array.isArray(raw)) return [];
  const isStr = (x: unknown): x is string => typeof x === 'string';
  const out: ExportedFile[] = [];
  for (const f of raw as any[]) {
    if (!f || !isStr(f.id) || !isStr(f.name) || !Array.isArray(f.versions)) continue;
    const versions = f.versions
      .filter((v: any) => v && isStr(v.text) && Number.isFinite(v.v))
      .map((v: any) => ({
        v: v.v,
        at: Number.isFinite(v.at) ? v.at : Date.now(),
        text: v.text.slice(0, MAX_FILE_CHARS),
        by: v.by === 'user' || v.by === 'upload' ? v.by : 'model'
      }))
      .slice(-2);
    if (!versions.length) continue;
    const name = cleanFileName(f.name);
    out.push({
      id: f.id,
      name,
      mime: mimeFromName(name),
      kind: f.kind === 'upload' ? 'upload' : 'document',
      conversationId: isStr(f.conversationId) ? f.conversationId : undefined,
      createdAt: Number.isFinite(f.createdAt) ? f.createdAt : Date.now(),
      updatedAt: Number.isFinite(f.updatedAt) ? f.updatedAt : Date.now(),
      size: versions[versions.length - 1].text.length,
      ...(isStr(f.source) ? { source: f.source.slice(0, 100) } : {}),
      ...(isStr(f.url) && /^https:\/\//.test(f.url) ? { url: f.url.slice(0, 2000) } : {}),
      versions
    });
  }
  return out;
}

/** Add files that do not exist yet; returns how many were added */
export async function importFiles(files: ExportedFile[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (await db().files.get(f.id)) continue;
    const { record, previousText } = fromVersions(f);
    const textRec = previousText === undefined ? null : await seal('fileVersions', { id: record.id, fileId: record.id, text: previousText });
    const rec = await seal('files', record);
    await db().transaction('rw', db().files, db().fileVersions, async () => {
      if (textRec) await db().fileVersions.put(textRec);
      await db().files.put(rec);
    });
    n++;
  }
  if (n) storeChanged('files');
  return n;
}

registerDataTable<ExportedFile>({
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
});
