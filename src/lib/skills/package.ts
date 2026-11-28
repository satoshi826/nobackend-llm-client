// Skills brought in from outside: a zip, a folder, or a SKILL.md alone. A skill is a folder holding a SKILL.md; every
// other file under that folder is one of its files, at its path inside it. Nothing is saved here: the user sees each
// skill and its files before saving (they come from others).
import { formatBytes, formatNumber, TranslatedError } from '../i18n';
import { baseName, extOf, folderOf } from '../paths';
import { listZip, ZipError } from '../zip';
import { parseSkillMd, validateSkill, type SkillDraft } from './skill';
import { cleanSkillPath, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, skillFileMime, skillFilesProblem, type SkillFile } from './files';
import { t } from './messages';

/** Largest SKILL.md read */
export const MAX_SKILL_MD_BYTES = 1024 ** 2;
/** Entries a zip or a folder may hold, all skills together (more is refused before anything is read) */
const MAX_ENTRIES = MAX_SKILL_FILES * 5;

/** A file of a skill being brought in, with its bytes */
export interface PackageFile extends SkillFile {
  data: Blob;
}

/** A skill read from outside, not saved */
export interface SkillPackage {
  /** The SKILL.md as it came, for the user to read */
  skillMd: string;
  draft: SkillDraft;
  files: PackageFile[];
}

/** Something picked or dropped: a file at its path ('SKILL.md', 'pdf.zip', or 'my-skill/scripts/a.js' inside a folder) */
export interface ImportSource {
  path: string;
  file: Blob;
}

/** An entry of a zip or a folder, read only when needed */
interface Entry {
  path: string;
  size: number;
  open(): Promise<Blob>;
}

export interface ReadResult {
  packages: SkillPackage[];
  /** Why something could not be read, one line each */
  errors: string[];
}

/** Files of other systems that a zip or a folder may carry, never a skill's */
const isJunk = (path: string) => path.split('/').includes('__MACOSX') || ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(baseName(path));

/**
 * Read what the user picked or dropped: each zip on its own, each SKILL.md (or other .md) alone as a skill without
 * files, and every file inside a folder together
 */
export async function readSkillSources(sources: ImportSource[]): Promise<ReadResult> {
  const out: ReadResult = { packages: [], errors: [] };
  const fail = (name: string, e: unknown) => out.errors.push(t('package.error', { name, error: e instanceof ZipError ? t('package.badZip') : (e as Error).message }));
  const folder: Entry[] = [];
  for (const s of sources) {
    const path = s.path.replace(/\\/g, '/');
    if (path.includes('/')) {
      folder.push({ path, size: s.file.size, open: async () => s.file });
      continue;
    }
    try {
      if (extOf(path) === 'zip') {
        const entries = (await listZip(s.file)).map((e) => ({ path: e.name, size: e.size, open: () => e.open() }));
        await readEntries(entries, path, out);
      } else out.packages.push(await packageOf(s.file, []));
    } catch (e) {
      fail(path, e);
    }
  }
  if (folder.length) await readEntries(folder, folder[0].path.split('/')[0], out).catch((e) => fail(folder[0].path.split('/')[0], e));
  return out;
}

/** The skills among a zip's or a folder's entries: each folder holding a SKILL.md that lies in no other such folder */
async function readEntries(all: Entry[], source: string, out: ReadResult) {
  const entries = all.filter((e) => !e.path.endsWith('/') && !isJunk(e.path));
  if (entries.length > MAX_ENTRIES) throw new TranslatedError(() => t('files.tooMany', { max: formatNumber(MAX_SKILL_FILES) }));
  const roots = entries
    .filter((e) => baseName(e.path).toLowerCase() === 'skill.md')
    .map((e) => folderOf(e.path))
    .sort((a, b) => a.length - b.length)
    .filter((r, i, list) => !list.slice(0, i).some((outer) => r.startsWith(outer)));
  if (!roots.length) throw new TranslatedError(() => t('package.noSkillMd'));
  for (const root of roots) {
    const name = root ? `${source}/${root.slice(0, -1)}` : source;
    try {
      const inside = entries.filter((e) => e.path.startsWith(root));
      const md = inside.find((e) => e.path.slice(root.length).toLowerCase() === 'skill.md')!;
      const rest = inside.filter((e) => e !== md);
      // Sizes the zip gives, checked before anything is read or inflated
      if (rest.length > MAX_SKILL_FILES) throw new TranslatedError(() => t('files.tooMany', { max: formatNumber(MAX_SKILL_FILES) }));
      const big = rest.find((e) => e.size > MAX_SKILL_FILE_BYTES);
      if (big) throw new TranslatedError(() => t('files.tooBig', { path: big.path.slice(root.length), max: formatBytes(MAX_SKILL_FILE_BYTES) }));
      if (rest.reduce((n, e) => n + e.size, 0) > MAX_SKILL_BYTES) throw new TranslatedError(() => t('files.totalTooBig', { max: formatBytes(MAX_SKILL_BYTES) }));
      if (md.size > MAX_SKILL_MD_BYTES) throw new TranslatedError(() => t('package.skillMdTooBig', { max: formatBytes(MAX_SKILL_MD_BYTES) }));
      const files = rest.map((e) => ({ path: cleanSkillPath(e.path.slice(root.length)), entry: e }));
      out.packages.push(await packageOf(await md.open(), files));
    } catch (e) {
      out.errors.push(t('package.error', { name, error: e instanceof ZipError ? t('package.badZip') : (e as Error).message }));
    }
  }
}

/** A skill from its SKILL.md and its files (paths cleaned already); throws when it cannot be one */
async function packageOf(md: Blob, list: { path: string; entry: Entry }[]): Promise<SkillPackage> {
  if (md.size > MAX_SKILL_MD_BYTES) throw new TranslatedError(() => t('package.skillMdTooBig', { max: formatBytes(MAX_SKILL_MD_BYTES) }));
  const skillMd = await md.text();
  const draft = parseSkillMd(skillMd);
  const invalid = validateSkill(draft);
  if (invalid) throw new Error(invalid);
  const files: PackageFile[] = [];
  for (const { path, entry } of list) {
    const data = await entry.open();
    files.push({ path, mime: await skillFileMime(path, data), bytes: data.size, data });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const problem = skillFilesProblem(files);
  if (problem) throw new Error(problem);
  return { skillMd, draft, files };
}
