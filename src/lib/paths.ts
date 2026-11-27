// Paths of files and named images: one namespace across the whole app. A path is a name with folders
// ('todo-app/js/app.js'); a folder is the shared start of names, with a closing '/'. Two paths are the same when they
// match in NFC with case folded (so 'Todo/' and 'todo/' are never two folders, which would collide on a disk or in a
// zip), and a file's path is never another's folder. Pure functions: what is taken comes in as a PathSpace.

/** Folders a path may hold, and the length of a whole path */
const MAX_FOLDERS = 7;
const MAX_PATH = 200;

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

/** The parts of a raw path: NFC, no control characters, `\` as `/`, without empty, `.`, `..` and drive-letter parts */
function pathParts(raw: string): string[] {
  return (
    raw
      // One form for the same text (a Mac gives names in NFD), so names a model writes match names from a disk
      .normalize('NFC')
      // oxlint-disable-next-line no-control-regex -- control characters are what it removes
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
 * Clean a file name coming from a model, a disk or a backup into a path: folders separated by `/` (a `\` counts as
 * one), in NFC, with no empty, `.` or `..` parts and no control characters, at most 7 folders deep and 200 characters
 * long; the last part gets an extension when it has none
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

/** The form paths are compared in */
export const pathKey = (path: string): string => path.normalize('NFC').toLowerCase();

/** Whether a path lies inside a folder ('a/b/'; '' holds everything) */
export const isInside = (path: string, folder: string): boolean => pathKey(path).startsWith(pathKey(folder));

const MEDIA_EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** The extension for an image's or a video's type */
export const extOfMime = (mime: string): string => MEDIA_EXT[mime] ?? (mime.startsWith('video/') ? 'mp4' : 'png');

/** A name from a local time, to the second, for what is made with no name of its own: '20261127-160816.webp' */
export function timeName(at: number, ext: string): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.${ext}`;
}

/** A folder named by a local date: '2026-11-27/' */
export function dateFolder(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}/`;
}

/** A folder's name when no one chose one: after a file ('report.md' → 'report/'), else by the date */
export function folderNameFor(path: string, at: number): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return cleanFolderName(dot > 0 ? base.slice(0, dot) : base) || dateFolder(at);
}

/** Something that has a path: a file or a named image */
export interface PathOwner {
  id: string;
  path: string;
}

/** What is taken, asked by path key: who has a path, and whether a folder holds anything */
export interface PathSpace {
  ownerOf(key: string): string | undefined;
  /** A folder key, with its closing '/' */
  holds(folderKey: string): boolean;
}

/** A PathSpace over a list (the catalog keeps its own) */
export function spaceOf(owners: PathOwner[]): PathSpace {
  const by = new Map<string, string>();
  const folders = new Set<string>();
  for (const o of owners) {
    const k = pathKey(o.path);
    by.set(k, o.id);
    for (let i = k.indexOf('/'); i >= 0; i = k.indexOf('/', i + 1)) folders.add(k.slice(0, i + 1));
  }
  return { ownerOf: (k) => by.get(k), holds: (f) => folders.has(f) };
}

/** The keys of the folders a path lies in, from the top ('a/', 'a/b/') */
function folderKeys(k: string): string[] {
  const out: string[] = [];
  for (let i = k.indexOf('/'); i >= 0; i = k.indexOf('/', i + 1)) out.push(k.slice(0, i + 1));
  return out;
}

/** Whether something may take `path`: no one else has it or keeps things in it, and none of its folders is a file */
export function pathFree(path: string, space: PathSpace, exceptId?: string): boolean {
  const k = pathKey(path);
  const owner = space.ownerOf(k);
  if (owner && owner !== exceptId) return false;
  if (space.holds(`${k}/`)) return false;
  return folderKeys(k).every((f) => {
    const o = space.ownerOf(f.slice(0, -1));
    return !o || o === exceptId;
  });
}

/** `folder` ('todo-app/'), or the first 'todo-app (2)/', ... that holds nothing, is no file's path, and lies in no file */
export function freeFolder(folder: string, space: PathSpace, alsoUsed: (folderKey: string) => boolean = () => false): string {
  const used = (f: string) => {
    const k = pathKey(f);
    return space.holds(k) || !!space.ownerOf(k.slice(0, -1)) || alsoUsed(k) || folderKeys(k.slice(0, -1)).some((a) => !!space.ownerOf(a.slice(0, -1)));
  };
  if (!used(folder)) return folder;
  for (let n = 2; n < 10_000; n++) {
    const next = `${folder.slice(0, -1)} (${n})/`;
    if (!used(next)) return next;
  }
  throw new Error(`No free folder for ${folder}`);
}

/**
 * `path`, or the first free 'name (2).ext', 'name (3).ext', ... When one of its folders is a file, that folder gets the
 * number instead ('x.md/y.md' with a file 'x.md' → 'x.md (2)/y.md'), since no name inside it could ever be free
 */
export function freePath(path: string, space: PathSpace, exceptId?: string): string {
  if (pathFree(path, space, exceptId)) return path;
  let dir = folderOf(path);
  const parts = dir.split('/').slice(0, -1);
  for (let i = 0; i < parts.length; i++) {
    const at = parts.slice(0, i + 1).join('/');
    const owner = space.ownerOf(pathKey(at));
    if (owner && owner !== exceptId) {
      dir = freeFolder(`${at}/`, space) + parts.slice(i + 1).map((p) => `${p}/`).join('');
      break;
    }
  }
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  if (pathFree(dir + base, space, exceptId)) return dir + base;
  for (let n = 2; n < 10_000; n++) {
    const next = `${dir}${stem} (${n})${ext}`;
    if (pathFree(next, space, exceptId)) return next;
  }
  throw new Error(`No free path for ${path}`);
}
