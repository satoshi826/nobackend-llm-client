// Paths: one namespace for the names of files and named images (uploaded or fetched ones), across the whole app.
// A path is a file name with folders ('todo-app/js/app.js', cleaned by cleanFileName); a folder is the shared start of
// names, with a closing '/'. Two paths are the same when they match in NFC with case folded, so a folder never splits
// into 'Todo/' and 'todo/' (one folder on a Mac disk, in a zip). A file's path is never another one's folder.
import { listFiles } from './files';
import { listImages } from './images';

/** Something that has a path: a file or a named image */
export interface PathOwner {
  id: string;
  path: string;
}

/** The form paths are compared in */
export const pathKey = (path: string): string => path.normalize('NFC').toLowerCase();

/** Whether a path lies inside a folder ('a/b/'; '' holds everything) */
export const isInside = (path: string, folder: string): boolean => pathKey(path).startsWith(pathKey(folder));

/** The paths in use: every file (temporary ones too) and every named image */
export async function takenPaths(): Promise<PathOwner[]> {
  const [files, images] = await Promise.all([listFiles(), listImages()]);
  return [...files.map((f) => ({ id: f.id, path: f.name })), ...images.flatMap((im) => (im.info?.name ? [{ id: im.id, path: im.info.name }] : []))];
}

/** Whether a file may take `path`: no one else has it, uses it as a folder, or has a file where it has a folder */
export function pathFree(path: string, taken: PathOwner[], exceptId?: string): boolean {
  const k = pathKey(path);
  return taken.every((o) => {
    if (o.id === exceptId) return true;
    const ok = pathKey(o.path);
    return ok !== k && !ok.startsWith(`${k}/`) && !k.startsWith(`${ok}/`);
  });
}

/** `path`, or the first free 'name (2).ext', 'name (3).ext', ... in the same folder */
export function freePath(path: string, taken: PathOwner[], exceptId?: string): string {
  if (pathFree(path, taken, exceptId)) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (pathFree(next, taken, exceptId)) return next;
  }
}

/** `folder` ('todo-app/'), or the first 'todo-app (2)/', ... that nothing is inside of and that is no file's path */
export function freeFolder(folder: string, taken: PathOwner[]): string {
  const used = (f: string) => taken.some((o) => isInside(o.path, f) || pathKey(o.path) === pathKey(f.slice(0, -1)));
  if (!used(folder)) return folder;
  for (let n = 2; ; n++) {
    const next = `${folder.slice(0, -1)} (${n})/`;
    if (!used(next)) return next;
  }
}

let queue: Promise<unknown> = Promise.resolve();
/**
 * Run `fn` with the paths in use, one call at a time, so two saves started together cannot pick the same free path.
 * `fn` should save what it names before it returns
 */
export function withTakenPaths<T>(fn: (taken: PathOwner[]) => Promise<T>): Promise<T> {
  const run = queue.then(async () => fn(await takenPaths()));
  queue = run.catch(() => undefined);
  return run;
}
