// File storage: documents written by the model and files the user uploaded (text only).
// Files of temporary chats stay in memory. With a passphrase, names and contents are encrypted (sealed.ts).
import { db, type FileRecord, type FileVersion } from './schema';
import { seal, unseal } from './sealed';

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

export const currentVersion = (f: FileRecord): FileVersion => f.versions[f.versions.length - 1];
export const currentText = (f: FileRecord): string => currentVersion(f)?.text ?? '';

/** A new file record (not saved) */
export function newFile(o: { id: string; name: string; kind: FileRecord['kind']; text: string; by: FileVersion['by']; conversationId?: string; source?: string; mime?: string }): FileRecord {
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
    versions: [{ v: 1, at: now, text: o.text, by: o.by }]
  };
}

/** The record with a new version appended (old versions beyond MAX_VERSIONS are dropped) */
export function withVersion(f: FileRecord, text: string, by: FileVersion['by'], note?: string): FileRecord {
  const now = Date.now();
  const v = (currentVersion(f)?.v ?? 0) + 1;
  const versions = [...f.versions, { v, at: now, text, by, ...(note ? { note } : {}) }].slice(-MAX_VERSIONS);
  return { ...f, versions, size: text.length, updatedAt: now };
}

export async function putFile(f: FileRecord, temporary = false): Promise<void> {
  if (temporary || mem.has(f.id)) {
    mem.set(f.id, f);
    return;
  }
  await db().files.put(await seal('files', f));
}

export async function getFile(id: string): Promise<FileRecord | undefined> {
  const m = mem.get(id);
  if (m) return m;
  const r = await db().files.get(id);
  return r ? unseal(r) : undefined;
}

/** All files, most recently changed first */
export async function listFiles(): Promise<FileRecord[]> {
  const stored = await Promise.all((await db().files.orderBy('updatedAt').reverse().toArray()).map((f) => unseal(f)));
  return [...mem.values(), ...stored].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  for (const id of ids) mem.delete(id);
  await db().files.bulkDelete(ids);
}

export function isTemporaryFile(id: string): boolean {
  return mem.has(id);
}

/** Files of a temporary chat disappear with it */
export function forgetTemporaryFiles(conversationId: string) {
  for (const [k, f] of mem) if (f.conversationId === conversationId) mem.delete(k);
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

// ---- backup ----
export async function exportFiles(): Promise<FileRecord[]> {
  return Promise.all((await db().files.toArray()).map((f) => unseal(f)));
}

/** Keep only well-formed file records */
export function cleanFiles(raw: unknown): FileRecord[] {
  if (!Array.isArray(raw)) return [];
  const isStr = (x: unknown): x is string => typeof x === 'string';
  const out: FileRecord[] = [];
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
      versions
    });
  }
  return out;
}

/** Add files that do not exist yet; returns how many were added */
export async function importFiles(files: FileRecord[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (await db().files.get(f.id)) continue;
    await db().files.put(await seal('files', f));
    n++;
  }
  return n;
}
