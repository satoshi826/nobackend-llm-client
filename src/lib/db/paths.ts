// Paths: one namespace for the names of files and named images (uploaded or fetched ones), across the whole app.
// A path is a file name with folders ('todo-app/js/app.js', cleaned by cleanFileName); a folder is the shared start of
// names, with a closing '/'. Two paths are the same when they match in NFC with case folded, so a folder never splits
// into 'Todo/' and 'todo/' (one folder on a Mac disk, in a zip). A file's path is never another one's folder.
import { db, type BlobRecord, type Conversation, type FileRecord } from './schema';
import { seal } from './sealed';
import { storeChanged } from './changes';
import { baseName, cleanFolderName, getFile, isTemporaryFile, listFiles, putFile } from './files';
import { listImages, renameImages, renamedImageRecord } from './images';

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

/** A folder named by a local date: '2026-11-27/' */
export function dateFolder(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}/`;
}

/** A working folder's name when no one chose one: after a file ('report.md' → 'report/'), else by the date */
export function folderNameFor(path: string, at: number): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return cleanFolderName(dot > 0 ? base.slice(0, dot) : base) || dateFolder(at);
}

/** The top folder of a path ('todo/' for 'todo/js/a.js'; '' for a path at the top) */
const topFolder = (path: string) => path.slice(0, path.indexOf('/') + 1);

/**
 * Data from before working folders: give each stored conversation that has files, and no working folder, one. When
 * all of them sit in one top folder that holds nothing else, that folder is it, and nothing moves; else they move
 * into a folder named after the first of them (relative paths between them keep their shape). Images stay where
 * they are: a user put them there. One transaction per conversation, so a stop halfway leaves each conversation
 * moved or untouched. Returns the conversations it changed
 */
export async function moveIntoWorkDirs(convs: Conversation[]): Promise<Conversation[]> {
  const changed: Conversation[] = [];
  for (const c of convs) {
    if (c.workDir || c.temporary) continue;
    const fileIds = (await db().files.where('conversationId').equals(c.id).primaryKeys()) as string[];
    const files = (await Promise.all(fileIds.map((id) => getFile(id)))).filter((f) => !!f).sort((a, b) => a.createdAt - b.createdAt);
    if (!files.length) continue;
    const mine = new Set(files.map((f) => f.id));
    const taken = await takenPaths();
    const top = topFolder(files[0].name);
    const ownTop = !!top && files.every((f) => pathKey(topFolder(f.name)) === pathKey(top)) && taken.every((o) => mine.has(o.id) || !isInside(o.path, top));
    const folder = ownTop ? top : freeFolder(folderNameFor(files[0].name, c.createdAt), taken);
    const fileRecs = ownTop ? [] : await Promise.all(files.map((f) => seal('files', { ...f, name: folder + f.name })));
    const next = { ...c, workDir: folder };
    const convRec = await seal('conversations', next);
    await db().transaction('rw', db().files, db().conversations, async () => {
      if (fileRecs.length) await db().files.bulkPut(fileRecs);
      await db().conversations.put(convRec);
    });
    changed.push(next);
  }
  if (changed.length) storeChanged('files');
  return changed;
}

/** Give a number to every path that another file or image already has (data from before paths were unique, imports) */
export async function renumberTakenPaths(): Promise<number> {
  const all = await takenPaths();
  const kept: PathOwner[] = [];
  const files: FileRecord[] = [];
  const images: { id: string; name: string }[] = [];
  for (let i = 0; i < all.length; i++) {
    const o = all[i];
    if (!pathFree(o.path, kept)) {
      const path = freePath(o.path, [...kept, ...all.slice(i + 1)]);
      const f = await getFile(o.id);
      if (f) files.push({ ...f, name: path, updatedAt: Date.now() });
      else images.push({ id: o.id, name: path });
      o.path = path;
    }
    kept.push(o);
  }
  for (const f of files) await putFile(f, isTemporaryFile(f.id));
  await renameImages(images);
  return files.length + images.length;
}

/**
 * Give everything inside folder `from` ('a/b/') the folder `to` instead ('c/'): its files and named images, keeping
 * their paths below it. Refused (false) when a path it would take belongs to something that stays. Stored records
 * change in one transaction. The conversations whose working folder it was are the caller's to change
 */
export async function moveFolder(from: string, to: string): Promise<boolean> {
  const taken = await takenPaths();
  const moving = taken.filter((o) => isInside(o.path, from));
  const staying = taken.filter((o) => !isInside(o.path, from));
  const renamed = moving.map((o) => ({ id: o.id, path: to + o.path.slice(from.length) }));
  if (!renamed.length || renamed.some((r) => !pathFree(r.path, staying))) return false;
  const now = Date.now();
  const fileRecs: FileRecord[] = [];
  const imageRecs: BlobRecord[] = [];
  const memImages: { id: string; name: string }[] = [];
  for (const r of renamed) {
    const f = await getFile(r.id);
    if (f && isTemporaryFile(f.id)) await putFile({ ...f, name: r.path, updatedAt: now }, true);
    else if (f) fileRecs.push(await seal('files', { ...f, name: r.path, updatedAt: now }));
    else {
      const im = await renamedImageRecord(r.id, () => r.path);
      if (im) imageRecs.push(im);
      else memImages.push({ id: r.id, name: r.path });
    }
  }
  await db().transaction('rw', db().files, db().blobs, async () => {
    if (fileRecs.length) await db().files.bulkPut(fileRecs);
    if (imageRecs.length) await db().blobs.bulkPut(imageRecs);
  });
  await renameImages(memImages);
  storeChanged('files');
  storeChanged('images');
  return true;
}
