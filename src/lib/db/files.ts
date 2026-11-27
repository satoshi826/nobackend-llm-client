// File storage: documents a model wrote, files the user brought in, data a page saved (text only). A file's record
// (files) holds what lists show; its texts live apart (fileTexts): the current one, and the one before its last change
// (for undo), nothing older. Lists and path checks read the catalog (catalog.ts), which these writers keep up to date;
// a text is read only when it is needed. Files of temporary chats stay in memory. With a passphrase, names, origins,
// previews and texts are encrypted (sealed.ts).
import { db, PREVIEW_CHARS, textBytes, type FileRecord, type Origin, type SavedBy, type TextStamp } from './schema';
import { seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';
import { registerDataTable } from './data-tables';
import { storeChanged } from './changes';
import { allFiles, catalogFile, dropFile, ensureCatalog, isTemporary, putFile as catalogPut, resetCatalog } from './catalog';
import { cleanFileName, mimeFromName } from '../paths';

/** Upper bound for one file's text */
export const MAX_FILE_CHARS = 2_000_000;

type Which = 'current' | 'previous';
const textId = (id: string, which: Which) => `${id}:${which}`;
/** Texts of temporary files, by text id */
const memTexts = new Map<string, string>();

/** A file's record for a text (not saved) */
export function newFile(o: { id: string; name: string; origin: Origin; text: string; by: SavedBy; conversationId?: string; fromPdf?: boolean; mime?: string }): FileRecord {
  const now = Date.now();
  return {
    id: o.id,
    name: o.name,
    mime: o.mime ?? mimeFromName(o.name),
    origin: o.origin,
    ...(o.fromPdf ? { fromPdf: true } : {}),
    ...(o.conversationId ? { conversationId: o.conversationId } : {}),
    createdAt: now,
    updatedAt: now,
    bytes: textBytes(o.text),
    preview: o.text.slice(0, PREVIEW_CHARS),
    current: { at: now, by: o.by }
  };
}

/** Write a record and the texts that changed with it, in one transaction (or in memory for a temporary file) */
async function write(f: FileRecord, texts: Partial<Record<Which, string>>, inMemory: boolean): Promise<FileRecord> {
  if (inMemory) {
    for (const [w, text] of Object.entries(texts)) memTexts.set(textId(f.id, w as Which), text);
  } else {
    // Encrypt first: a transaction ends as soon as it waits on anything but the database
    const rows = await Promise.all(Object.entries(texts).map(([w, text]) => seal('fileTexts', { id: textId(f.id, w as Which), fileId: f.id, text })));
    const rec = await seal('files', f);
    await db().transaction('rw', db().files, db().fileTexts, async () => {
      if (rows.length) await db().fileTexts.bulkPut(rows);
      await db().files.put(rec);
    });
  }
  catalogPut(f, inMemory);
  storeChanged('files');
  return f;
}

/** Save a new file with its text */
export async function createFile(f: FileRecord, text: string, temporary = false): Promise<FileRecord> {
  await ensureCatalog();
  return write(f, { current: text }, temporary);
}

/** Save a file's record itself (a rename, a move); its texts stay */
export async function putFile(f: FileRecord): Promise<FileRecord> {
  await ensureCatalog();
  return write(f, {}, isTemporary(f.id));
}

export async function getFile(id: string): Promise<FileRecord | undefined> {
  await ensureCatalog();
  return catalogFile(id);
}

/** All files, most recently changed first */
export async function listFiles(): Promise<FileRecord[]> {
  await ensureCatalog();
  return allFiles();
}

/** A file's current text, or the one before its last change ('' when there is none) */
export async function readText(id: string, which: Which = 'current'): Promise<string> {
  const m = memTexts.get(textId(id, which));
  if (m !== undefined) return m;
  const row = await db().fileTexts.get(textId(id, which));
  return row ? (await unseal(row)).text : '';
}

/** The current texts of several files, by id (read together) */
export async function readTexts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const stored = ids.filter((id) => {
    const m = memTexts.get(textId(id, 'current'));
    if (m !== undefined) out.set(id, m);
    return m === undefined;
  });
  const rows = await db().fileTexts.bulkGet(stored.map((id) => textId(id, 'current')));
  const opened = await Promise.all(rows.map((r) => (r ? unseal(r) : null)));
  stored.forEach((id, i) => out.set(id, opened[i]?.text ?? ''));
  return out;
}

/**
 * Save a new current text. The one it replaces becomes the previous text, unless keepPrevious (appending to a file
 * being written, a page saving its data): then the previous text stays as it was. now: its time, when the caller
 * must know it before the change is heard of
 */
export async function setText(id: string, text: string, by: SavedBy, keepPrevious = false, now = Date.now()): Promise<FileRecord> {
  await ensureCatalog();
  const f = catalogFile(id);
  if (!f) throw new Error(`No file ${id}`);
  const stamp: TextStamp = { at: now, by };
  const next: FileRecord = { ...f, current: stamp, bytes: textBytes(text), preview: text.slice(0, PREVIEW_CHARS), updatedAt: now, ...(keepPrevious ? {} : { previous: f.current }) };
  const texts: Partial<Record<Which, string>> = { current: text };
  if (!keepPrevious) texts.previous = await readText(id);
  return write(next, texts, isTemporary(id));
}

export async function deleteFiles(ids: string[]): Promise<void> {
  await ensureCatalog();
  for (const id of ids) {
    memTexts.delete(textId(id, 'current'));
    memTexts.delete(textId(id, 'previous'));
    dropFile(id);
  }
  await db().transaction('rw', db().files, db().fileTexts, async () => {
    await db().fileTexts.where('fileId').anyOf(ids).delete();
    await db().files.bulkDelete(ids);
  });
  storeChanged('files');
}

export const isTemporaryFile = (id: string): boolean => isTemporary(id);

/** Files of a temporary chat disappear with it */
export function forgetTemporaryFiles(conversationId: string) {
  for (const f of allFiles()) {
    if (f.conversationId !== conversationId || !isTemporary(f.id)) continue;
    memTexts.delete(textId(f.id, 'current'));
    memTexts.delete(textId(f.id, 'previous'));
    dropFile(f.id);
  }
  storeChanged('files');
}

export async function fileUsage(): Promise<{ count: number; bytes: number }> {
  const files = (await listFiles()).filter((f) => !isTemporary(f.id));
  return { count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) };
}

/** Encrypt (to: a key) or decrypt (to: null) every file record and text */
async function resealFiles(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  // Converted first (under the old key), so nothing in an older shape is written in the clear
  await ensureCatalog();
  const rows = await db().files.toArray();
  let done = 0;
  for (const raw of rows) {
    const f = await unseal(raw, from);
    const texts = await db().fileTexts.where('fileId').equals(f.id).toArray();
    const resealed = await Promise.all(texts.map(async (x) => seal('fileTexts', await unseal(x, from), to)));
    const rec = await seal('files', f, to);
    await db().transaction('rw', db().files, db().fileTexts, async () => {
      if (resealed.length) await db().fileTexts.bulkPut(resealed);
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
export type ExportedFile = Omit<FileRecord, 'current' | 'previous' | 'preview' | 'bytes'> & { versions: ExportedVersion[] };

export async function exportFiles(): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  for (const f of await listFiles()) {
    if (isTemporary(f.id)) continue;
    const { current, previous, preview: _p, bytes: _b, ...rest } = f;
    const [text, before] = await Promise.all([readText(f.id), previous ? readText(f.id, 'previous') : Promise.resolve(undefined)]);
    out.push({ ...rest, versions: [...(previous && before !== undefined ? [{ ...previous, text: before, v: 1 }] : []), { ...current, text, v: previous ? 2 : 1 }] });
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
    // Older backups: kind ('document' | 'upload'), url, source ('PDF から抽出')
    const url = o?.kind === 'web' ? o.url : f.url;
    const origin: Origin = isStr(url) && url.startsWith('https://') ? { kind: 'web', url: url.slice(0, 2000) } : o?.kind === 'upload' || f.kind === 'upload' ? { kind: 'upload' } : { kind: 'made' };
    out.push({
      id: f.id,
      name,
      mime: mimeFromName(name),
      origin,
      ...(f.fromPdf === true || (isStr(f.source) && f.source.startsWith('PDF')) ? { fromPdf: true } : {}),
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
  for (const f of files) {
    if (await db().files.get(f.id)) continue;
    const { versions, ...rest } = f;
    const current = versions[versions.length - 1];
    const before = versions.length > 1 ? versions[versions.length - 2] : undefined;
    const record: FileRecord = {
      ...rest,
      bytes: textBytes(current.text),
      preview: current.text.slice(0, PREVIEW_CHARS),
      current: { at: current.at, by: current.by },
      ...(before ? { previous: { at: before.at, by: before.by } } : {})
    };
    const rows = await Promise.all([
      seal('fileTexts', { id: textId(f.id, 'current'), fileId: f.id, text: current.text }),
      ...(before ? [seal('fileTexts', { id: textId(f.id, 'previous'), fileId: f.id, text: before.text })] : [])
    ]);
    const rec = await seal('files', record);
    await db().transaction('rw', db().files, db().fileTexts, async () => {
      await db().fileTexts.bulkPut(rows);
      await db().files.put(rec);
    });
    n++;
  }
  // Read again with what came in
  if (n) {
    resetCatalog();
    storeChanged('files');
  }
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
