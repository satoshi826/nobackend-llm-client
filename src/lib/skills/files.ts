// A skill's files: what a skill keeps beside its SKILL.md (scripts/fill.js, reference/forms.md, assets/logo.png), at
// paths inside the skill's folder. Pure functions: cleaning a path, the limits, and whether a file is text.
import { formatBytes, formatNumber, TranslatedError } from '../i18n';
import { baseName, extOf, folderOf, isTextMime, mimeFromName, pathKey } from '../paths';
import { t } from './messages';

/** One file's size, all of a skill's files together, and how many files one skill keeps */
export const MAX_SKILL_FILE_BYTES = 5 * 1024 ** 2;
export const MAX_SKILL_BYTES = 20 * 1024 ** 2;
export const MAX_SKILL_FILES = 200;
/** Folders a path may hold, and the length of a whole path (as for working folders: lib/paths.ts) */
const MAX_FOLDERS = 7;
const MAX_PATH = 200;

/** A skill's body, at the top of its folder: never one of its files */
export const SKILL_MD = 'SKILL.md';

/** A file of a skill, as lists show it */
export interface SkillFile {
  path: string;
  mime: string;
  bytes: number;
}

/**
 * Clean a path inside a skill's folder ('scripts\\fill.js' → 'scripts/fill.js'): NFC, no control characters, `\` as
 * `/`, no empty or `.` parts. Throws when it would leave the folder (`..`, a leading `/`, a drive letter), is empty, or
 * is deeper or longer than a working folder's paths may be: nothing is cut or renamed, since other files may name it
 */
export function cleanSkillPath(raw: string): string {
  // oxlint-disable-next-line no-control-regex -- control characters are what it removes
  const s = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '');
  const parts = s.split(/[\\/]/).map((p) => p.trim());
  if (/^[\\/]/.test(s) || parts.some((p) => p === '..' || /^[a-z]:$/i.test(p))) throw new TranslatedError(() => t('files.escapes', { path: raw }));
  const kept = parts.filter((p) => p && p !== '.');
  if (!kept.length) throw new TranslatedError(() => t('files.noPath'));
  const path = kept.join('/');
  if (kept.length - 1 > MAX_FOLDERS || path.length > MAX_PATH) throw new TranslatedError(() => t('files.tooDeep', { path, folders: MAX_FOLDERS, max: MAX_PATH }));
  return path;
}

/** Why these files cannot be one skill's (too many, too large, a path twice, a file used as a folder), or null */
export function skillFilesProblem(files: readonly { path: string; bytes: number }[]): string | null {
  if (files.length > MAX_SKILL_FILES) return t('files.tooMany', { max: formatNumber(MAX_SKILL_FILES) });
  const big = files.find((f) => f.bytes > MAX_SKILL_FILE_BYTES);
  if (big) return t('files.tooBig', { path: big.path, max: formatBytes(MAX_SKILL_FILE_BYTES) });
  if (files.reduce((n, f) => n + f.bytes, 0) > MAX_SKILL_BYTES) return t('files.totalTooBig', { max: formatBytes(MAX_SKILL_BYTES) });
  const keys = new Map<string, string>();
  for (const f of files) {
    const k = pathKey(f.path);
    if (k === pathKey(SKILL_MD)) return t('files.reserved');
    if (keys.has(k)) return t('files.twice', { path: f.path });
    keys.set(k, f.path);
  }
  for (const f of files) {
    const k = pathKey(f.path);
    for (let i = k.indexOf('/'); i >= 0; i = k.indexOf('/', i + 1)) {
      const folder = keys.get(k.slice(0, i));
      if (folder) return t('files.fileIsFolder', { path: folder });
    }
  }
  return null;
}

/** The first free path like `path` among `taken` (path keys): 'a.js', then 'a (2).js', ... */
export function freeSkillPath(path: string, taken: ReadonlySet<string>): string {
  if (!taken.has(pathKey(path))) return path;
  const dir = folderOf(path);
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  for (let n = 2; ; n++) {
    const next = `${dir}${stem} (${n})${ext}`;
    if (!taken.has(pathKey(next))) return next;
  }
}

/** Types of text files beyond lib/paths.ts's (code a skill may hold) */
const CODE_MIME: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/x-typescript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  css: 'text/css',
  svg: 'image/svg+xml'
};

const BINARY_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  zip: 'application/zip'
};

export { isTextMime };

/** A file's type: a text type when its bytes are UTF-8 with no NUL, else one by its extension (application/octet-stream when unknown) */
export async function skillFileMime(path: string, data: Blob): Promise<string> {
  const ext = extOf(path);
  const bytes = new Uint8Array(await data.arrayBuffer());
  let text = !bytes.includes(0);
  if (text) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = false;
    }
  }
  if (!text) return BINARY_MIME[ext] ?? 'application/octet-stream';
  const mime = CODE_MIME[ext] ?? mimeFromName(path);
  return isTextMime(mime) ? mime : 'text/plain';
}
