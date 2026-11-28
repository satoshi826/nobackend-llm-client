// Skill storage with its files: a skill's record (skills) and its files (skillFiles: bytes at paths inside the skill's
// folder). With a passphrase a file's path, type and size are encrypted like any record (sealed.ts), and its bytes are
// encrypted apart, as bytes. A file's bytes are read only when they are needed.
import { db, type Skill, type SkillFileRecord } from './schema';
import { currentDataKey, seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';
import { isStoredAs, openStored, storedBytes } from './bytes';
import type { DataTable } from './data-tables';
import { cleanSkillPath, MAX_SKILL_FILE_BYTES, skillFilesProblem, type SkillFile } from '../skills/files';
import { pathKey } from '../paths';
import { TranslatedError } from '../i18n';

/** A stored file of a skill, as lists show it */
export interface SkillFileEntry extends SkillFile {
  id: string;
}

/** A file a skill is saved with: one it has (by id, maybe at a new path), or new bytes */
export type SkillFileWrite = { id: string; path: string } | { path: string; mime: string; data: Blob };

/** Skills by name */
export const listSkills = async (): Promise<Skill[]> => Promise.all((await db().skills.orderBy('name').toArray()).map((s) => unseal(s)));

const entryOf = (r: SkillFileRecord): SkillFileEntry => ({ id: r.id, path: r.path, mime: r.mime, bytes: r.bytes });

/** A skill's files, by path (their bytes stay unread) */
export async function listSkillFiles(skillId: string): Promise<SkillFileEntry[]> {
  const rows = await Promise.all((await db().skillFiles.where('skillId').equals(skillId).toArray()).map((r) => unseal(r)));
  return rows.map(entryOf).sort((a, b) => a.path.localeCompare(b.path));
}

/** A stored file's bytes, typed by its type; undefined when there is no such file */
export async function readSkillFileData(id: string): Promise<Blob | undefined> {
  const row = await db().skillFiles.get(id);
  if (!row) return undefined;
  const r = await unseal(row);
  return openStored(r.data, r.mime, currentDataKey());
}

/**
 * Save a skill; with files, they become its files (the ones it had and the list leaves out are deleted), all in one
 * transaction. Throws when the files cannot be one skill's (lib/skills/files.ts)
 */
export async function putSkill(s: Skill, files?: SkillFileWrite[]): Promise<void> {
  const key = currentDataKey();
  const rec = await seal('skills', s);
  if (!files) {
    await db().skills.put(rec);
    return;
  }
  const had = new Map((await Promise.all((await db().skillFiles.where('skillId').equals(s.id).toArray()).map((r) => unseal(r)))).map((r) => [r.id, r]));
  const next: SkillFileRecord[] = [];
  for (const f of files) {
    const path = cleanSkillPath(f.path);
    if ('id' in f) {
      const old = had.get(f.id);
      if (old) next.push({ ...old, path });
    } else next.push({ id: crypto.randomUUID(), skillId: s.id, path, mime: f.mime, bytes: f.data.size, data: await storedBytes(f.data, key) });
  }
  const problem = skillFilesProblem(next);
  if (problem) throw new TranslatedError(() => skillFilesProblem(next)!);
  // Encrypt first: a transaction ends as soon as it waits on anything but the database
  const rows = await Promise.all(next.map((r) => seal('skillFiles', r)));
  const keep = new Set(next.map((r) => r.id));
  const gone = [...had.keys()].filter((id) => !keep.has(id));
  await db().transaction('rw', db().skills, db().skillFiles, async () => {
    await db().skills.put(rec);
    if (gone.length) await db().skillFiles.bulkDelete(gone);
    await db().skillFiles.bulkPut(rows);
  });
}

/** Delete a skill and its files */
export async function deleteSkill(id: string): Promise<void> {
  await db().transaction('rw', db().skills, db().skillFiles, async () => {
    await db().skillFiles.where('skillId').equals(id).delete();
    await db().skills.delete(id);
  });
}

/** Encrypt (to: a key) or decrypt (to: null) every skill file; safe to re-run after an interruption */
async function resealSkillFiles(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  const ids = (await db().skillFiles.toCollection().primaryKeys()) as string[];
  let done = 0;
  for (const id of ids) {
    const row = await db().skillFiles.get(id);
    if (row && !isStoredAs(row.data, from, to)) {
      const r = await unseal(row, from);
      const data = await openStored(r.data, r.mime, from);
      await db().skillFiles.put(await seal('skillFiles', { ...r, data: await storedBytes(data, to) }, to));
    }
    onProgress?.(++done, ids.length);
  }
}

// ---- Backups ----
export interface ExportedSkillFile {
  id: string;
  skillId: string;
  path: string;
  mime: string;
  /** The bytes (in a backup file: an entry of its zip) */
  data: Blob;
}

async function exportSkillFiles(): Promise<ExportedSkillFile[]> {
  const out: ExportedSkillFile[] = [];
  for (const row of await db().skillFiles.toArray()) {
    const r = await unseal(row);
    out.push({ id: r.id, skillId: r.skillId, path: r.path, mime: r.mime, data: await openStored(r.data, r.mime, currentDataKey()) });
  }
  return out;
}

/** Add files whose skill is here and that it does not have yet (by id or by path), as long as the skill's limits allow */
async function importSkillFiles(list: ExportedSkillFile[]): Promise<number> {
  const key = currentDataKey();
  let n = 0;
  const bySkill = new Map<string, ExportedSkillFile[]>();
  for (const f of list) bySkill.set(f.skillId, [...(bySkill.get(f.skillId) ?? []), f]);
  for (const [skillId, files] of bySkill) {
    if (!(await db().skills.get(skillId))) continue;
    const have: { path: string; bytes: number }[] = await listSkillFiles(skillId);
    const rows: SkillFileRecord[] = [];
    for (const f of files) {
      if (await db().skillFiles.get(f.id)) continue;
      const next = [...have, { path: f.path, bytes: f.data.size }];
      if (have.some((h) => pathKey(h.path) === pathKey(f.path)) || skillFilesProblem(next)) continue;
      have.push({ path: f.path, bytes: f.data.size });
      rows.push({ id: f.id, skillId, path: f.path, mime: f.mime, bytes: f.data.size, data: await storedBytes(f.data, key) });
    }
    await db().skillFiles.bulkPut(await Promise.all(rows.map((r) => seal('skillFiles', r))));
    n += rows.length;
  }
  return n;
}

const cleanPath = (raw: string): string | undefined => {
  try {
    return cleanSkillPath(raw);
  } catch {
    return undefined;
  }
};

export const skillFilesTable: DataTable<ExportedSkillFile> = {
  key: 'skillFiles',
  exportRows: () => exportSkillFiles(),
  clean: (raw, { files }) =>
    (Array.isArray(raw) ? raw : []).flatMap((f: any): ExportedSkillFile[] => {
      if (!f || typeof f.id !== 'string' || typeof f.skillId !== 'string' || typeof f.path !== 'string' || typeof f.mime !== 'string' || typeof f.data?.file !== 'string') return [];
      const path = cleanPath(f.path);
      const data = files.get(f.data.file);
      return path && data && data.size <= MAX_SKILL_FILE_BYTES ? [{ id: f.id, skillId: f.skillId, path, mime: f.mime.slice(0, 100), data }] : [];
    }),
  importRows: (rows) => importSkillFiles(rows),
  reseal: resealSkillFiles
};
