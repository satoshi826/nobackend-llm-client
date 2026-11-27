// File storage: documents written by the model and files the user uploaded (text only).
// A file record holds the current version; earlier versions' texts live in their own table (fileVersions), so
// listing files or saving a new version never loads or rewrites the history.
// Files of temporary chats stay in memory. With a passphrase, names and contents are encrypted (sealed.ts).
import { db, type FileRecord, type FileVersion, type FileVersionInfo, type FileVersionText } from './schema';
import { currentDataKey, seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';
import { registerDataTable } from './data-tables';
import { storeChanged } from './changes';

/** Versions kept per file (older ones are dropped) */
export const MAX_VERSIONS = 30;
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

/** Clean a file name coming from a model or a disk: no paths, no control characters, bounded length */
export function cleanFileName(raw: string, fallbackExt = 'md'): string {
  let n = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()!
    .trim()
    .slice(0, 120);
  if (!n || n === '.' || n === '..') n = 'untitled';
  if (!extOf(n)) n = `${n}.${fallbackExt}`;
  return n;
}

export const currentVersion = (f: FileRecord): FileVersion => f.current;
export const currentText = (f: FileRecord): string => f.current.text;
/** Every version without its text, oldest first */
export const versionsOf = (f: FileRecord): FileVersionInfo[] => [...f.history, info(f.current)];

const info = ({ text: _t, ...rest }: FileVersion): FileVersionInfo => rest;
const textId = (fileId: string, v: number) => `${fileId}:${v}`;

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
    current: { v: 1, at: now, text: o.text, by: o.by },
    history: []
  };
}

/**
 * The record with a new current version (pure). archived: the version it replaces, whose text must be kept apart;
 * dropped: versions beyond MAX_VERSIONS whose texts can go
 */
export function withVersion(f: FileRecord, text: string, by: FileVersion['by'], note?: string): { next: FileRecord; archived: FileVersion; dropped: number[] } {
  const now = Date.now();
  const history = [...f.history, info(f.current)];
  const dropped = history.splice(0, Math.max(0, history.length - (MAX_VERSIONS - 1))).map((x) => x.v);
  const next: FileRecord = { ...f, current: { v: f.current.v + 1, at: now, text, by, ...(note ? { note } : {}) }, history, size: text.length, updatedAt: now };
  return { next, archived: f.current, dropped };
}

/** Earlier versions' texts of temporary files */
const memTexts = new Map<string, string>();

/** Save a new current version: the replaced one's text goes to fileVersions, versions beyond the limit are dropped */
export async function addVersion(f: FileRecord, text: string, by: FileVersion['by'], note?: string): Promise<FileRecord> {
  const { next, archived, dropped } = withVersion(f, text, by, note);
  if (mem.has(f.id)) {
    memTexts.set(textId(f.id, archived.v), archived.text);
    for (const v of dropped) memTexts.delete(textId(f.id, v));
    mem.set(f.id, next);
    storeChanged('files');
    return next;
  }
  // Encrypt first: a transaction ends as soon as it waits on anything but the database
  const textRec = await seal('fileVersions', { id: textId(f.id, archived.v), fileId: f.id, v: archived.v, text: archived.text });
  const rec = await seal('files', next);
  await db().transaction('rw', db().files, db().fileVersions, async () => {
    await db().fileVersions.put(textRec);
    if (dropped.length) await db().fileVersions.bulkDelete(dropped.map((v) => textId(f.id, v)));
    await db().files.put(rec);
  });
  storeChanged('files');
  return next;
}

/** The text of one version (the current one is in the record; earlier ones are read on demand) */
export async function versionText(f: FileRecord, v: number): Promise<string | undefined> {
  if (v === f.current.v) return f.current.text;
  if (mem.has(f.id)) return memTexts.get(textId(f.id, v));
  const r = await db().fileVersions.get(textId(f.id, v));
  return r ? (await unseal(r)).text : undefined;
}

/** Save the record itself (a new file, a rename). New versions go through addVersion */
export async function putFile(f: FileRecord, temporary = false): Promise<void> {
  if (temporary || mem.has(f.id)) mem.set(f.id, f);
  else await db().files.put(await seal('files', f));
  storeChanged('files');
}

/** A stored record in the shape before v9 (every version inside), once opened */
type LegacyFile = Omit<FileRecord, 'current' | 'history'> & { versions: FileVersion[] };
const isLegacy = (r: unknown): r is LegacyFile => Array.isArray((r as LegacyFile).versions);

function splitLegacy(r: LegacyFile): { record: FileRecord; texts: FileVersionText[] } {
  const { versions, ...rest } = r;
  const all = versions.slice(-MAX_VERSIONS);
  const current = all[all.length - 1];
  const earlier = all.slice(0, -1);
  return {
    record: { ...rest, current, history: earlier.map(info) },
    texts: earlier.map((x) => ({ id: textId(r.id, x.v), fileId: r.id, v: x.v, text: x.text }))
  };
}

/** Open a stored record; one still in the old shape is converted and written back in the new one (under `key`) */
async function open(raw: FileRecord, key: DataKey | null = currentDataKey()): Promise<FileRecord> {
  const r = await unseal(raw, key);
  if (!isLegacy(r)) return r;
  const { record, texts } = splitLegacy(r);
  const sealed = await Promise.all(texts.map((x) => seal('fileVersions', x, key)));
  const rec = await seal('files', record, key);
  await db().transaction('rw', db().files, db().fileVersions, async () => {
    if (sealed.length) await db().fileVersions.bulkPut(sealed);
    await db().files.put(rec);
  });
  return record;
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
    for (const k of memTexts.keys()) if (k.startsWith(`${id}:`)) memTexts.delete(k);
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
    for (const t of memTexts.keys()) if (t.startsWith(`${k}:`)) memTexts.delete(t);
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

/** Encrypt (to: a key) or decrypt (to: null) every file and version text; old-shape records are converted on the way */
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

// ---- backup (every version, in the shape older backups use too) ----
export type ExportedFile = Omit<FileRecord, 'current' | 'history'> & { versions: FileVersion[] };

export async function exportFiles(): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  for (const raw of await db().files.toArray()) {
    const f = await open(raw);
    const earlier: FileVersion[] = [];
    for (const h of f.history) {
      const text = await versionText(f, h.v);
      if (text !== undefined) earlier.push({ ...h, text });
    }
    const { current, history: _h, ...rest } = f;
    out.push({ ...rest, versions: [...earlier, current] });
  }
  return out;
}
/** Keep only well-formed file records */
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
        by: v.by === 'user' || v.by === 'upload' ? v.by : 'model',
        ...(isStr(v.note) ? { note: v.note.slice(0, 200) } : {})
      }))
      .slice(-MAX_VERSIONS);
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
    const { record, texts } = splitLegacy(f);
    const sealed = await Promise.all(texts.map((x) => seal('fileVersions', x)));
    const rec = await seal('files', record);
    await db().transaction('rw', db().files, db().fileVersions, async () => {
      if (sealed.length) await db().fileVersions.bulkPut(sealed);
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
