// Changes to paths in storage: one at a time against the catalog's index, so two saves started together never take
// the same path; moving a folder with what it holds; numbering paths two things share; and (development only, goes
// before the first release) giving conversations from before working folders one.
import { db, type BlobRecord, type Conversation, type FileRecord } from './schema';
import { seal } from './sealed';
import { storeChanged } from './changes';
import { allFiles, allImages, catalogFile, catalogSpace, ensureCatalog, isTemporary, putFile as catalogPutFile, putImage as catalogPutImage, imageEntry, infoOf } from './catalog';
import { putFile, getFile } from './files';
import { renameImages, renamedImageRecord } from './images';
import { folderNameFor, freeFolder, freePath, isInside, pathFree, pathKey, type PathSpace } from '../paths';

let queue: Promise<unknown> = Promise.resolve();
/**
 * Run `fn` with the paths in use, one call at a time, so two saves started together cannot take the same path. `fn`
 * should save what it names, and read the records it changes, before it returns
 */
export function withTakenPaths<T>(fn: (space: PathSpace) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await ensureCatalog();
    return fn(catalogSpace);
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Give everything inside folder `from` ('a/b/') the folder `to` instead ('c/'): its files and images with a path,
 * keeping their paths below it (and their dates). Refused (false) when a path it would take belongs to something that
 * stays. Stored records change in one transaction. Call it inside withTakenPaths; the conversations whose working
 * folder it was are the caller's to change
 */
export async function moveFolder(from: string, to: string): Promise<boolean> {
  const moving = [...allFiles().map((f) => ({ id: f.id, path: f.name })), ...allImages().flatMap((im) => (im.path ? [{ id: im.id, path: im.path }] : []))].filter((o) =>
    isInside(o.path, from)
  );
  const ids = new Set(moving.map((o) => o.id));
  const renamed = moving.map((o) => ({ id: o.id, path: to + o.path.slice(from.length) }));
  // Free against what stays: the moving paths do not block each other
  const staying: PathSpace = {
    ownerOf: (k) => {
      const id = catalogSpace.ownerOf(k);
      return id && !ids.has(id) ? id : undefined;
    },
    holds: (f) => allFiles().some((x) => !ids.has(x.id) && pathKey(x.name).startsWith(f)) || allImages().some((x) => !ids.has(x.id) && !!x.path && pathKey(x.path).startsWith(f))
  };
  if (!renamed.length || renamed.some((r) => !pathFree(r.path, staying))) return false;
  const fileRecs: FileRecord[] = [];
  const storedFiles: FileRecord[] = [];
  const imageRecs: BlobRecord[] = [];
  const memImages: { id: string; path: string }[] = [];
  for (const r of renamed) {
    const f = catalogFile(r.id);
    if (f && isTemporary(f.id)) await putFile({ ...f, name: r.path });
    else if (f) {
      storedFiles.push({ ...f, name: r.path });
      fileRecs.push(await seal('files', { ...f, name: r.path }));
    } else {
      const im = await renamedImageRecord(r.id, () => r.path);
      if (im) imageRecs.push(im);
      else memImages.push({ id: r.id, path: r.path });
    }
  }
  await db().transaction('rw', db().files, db().blobs, async () => {
    if (fileRecs.length) await db().files.bulkPut(fileRecs);
    if (imageRecs.length) await db().blobs.bulkPut(imageRecs);
  });
  for (const f of storedFiles) catalogPutFile(f);
  for (const im of imageRecs) catalogPutImage(imageEntry(im, await infoOf(im)));
  await renameImages(memImages);
  storeChanged('files');
  storeChanged('images');
  return true;
}

/** Give a number to every path that another file or image already has (two tabs at once, imports). Returns how many */
export async function renumberTakenPaths(): Promise<number> {
  return withTakenPaths(async () => {
    const owners = [...allFiles().map((f) => ({ id: f.id, path: f.name, file: true })), ...allImages().flatMap((im) => (im.path ? [{ id: im.id, path: im.path, file: false }] : []))];
    const seen = new Map<string, string>();
    const clash = owners.filter((o) => {
      const k = pathKey(o.path);
      if (seen.has(k)) return true;
      seen.set(k, o.id);
      return false;
    });
    for (const o of clash) {
      // Not excepting itself: the index may list this one or the other under the shared path, and both count as taken
      const path = freePath(o.path, catalogSpace);
      const f = o.file ? await getFile(o.id) : undefined;
      if (f) await putFile({ ...f, name: path });
      else await renameImages([{ id: o.id, path }]);
    }
    return clash.length;
  });
}

/**
 * Development only (goes before the first release): give each stored conversation that has files, and no working
 * folder, one. When all its files sit in one top folder that holds nothing else, that folder is it, and nothing moves;
 * else they move into a folder named after the first of them (relative paths between them keep their shape). Images
 * stay where they are. One transaction per conversation. Returns the conversations it changed
 */
export async function moveIntoWorkDirs(convs: Conversation[]): Promise<Conversation[]> {
  const changed: Conversation[] = [];
  await withTakenPaths(async () => {
    for (const c of convs) {
      if (c.workDir || c.temporary) continue;
      const files = allFiles()
        .filter((f) => f.conversationId === c.id && !isTemporary(f.id))
        .sort((a, b) => a.createdAt - b.createdAt);
      if (!files.length) continue;
      const mine = new Set(files.map((f) => f.id));
      const top = files[0].name.slice(0, files[0].name.indexOf('/') + 1);
      const topOf = (p: string) => p.slice(0, p.indexOf('/') + 1);
      const ownTop =
        !!top &&
        files.every((f) => pathKey(topOf(f.name)) === pathKey(top)) &&
        allFiles().every((f) => mine.has(f.id) || !isInside(f.name, top)) &&
        allImages().every((im) => !im.path || !isInside(im.path, top));
      const folder = ownTop ? top : freeFolder(folderNameFor(files[0].name, c.createdAt), catalogSpace);
      const next = { ...c, workDir: folder };
      const moved = ownTop ? [] : files.map((f) => ({ ...f, name: folder + f.name }));
      const fileRecs = await Promise.all(moved.map((f) => seal('files', f)));
      const convRec = await seal('conversations', next);
      await db().transaction('rw', db().files, db().conversations, async () => {
        if (fileRecs.length) await db().files.bulkPut(fileRecs);
        await db().conversations.put(convRec);
      });
      for (const f of moved) catalogPutFile(f);
      changed.push(next);
    }
  });
  if (changed.length) storeChanged('files');
  return changed;
}
