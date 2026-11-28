// Changes to paths in storage (one at a time: catalog.ts withTakenPaths): moving a folder with what it holds; numbering
// paths two files share; and (development only, goes before the first release) giving conversations from before
// working folders one.
import { db, type Conversation, type FileRecord } from './schema';
import { seal } from './sealed';
import { filesChanged } from './changes';
import { allFiles, catalogFile, catalogSpace, isTemporary, putFile as catalogPut, recordOf, withTakenPaths, type FileEntry } from './catalog';
import { putFile } from './files';
import { folderNameFor, freeFolder, freePath, isInside, pathFree, pathKey, type PathSpace } from '../paths';

/**
 * Give everything inside folder `from` ('a/b/') the folder `to` instead ('c/'), keeping their paths below it (and
 * their dates). Refused (false) when a path it would take belongs to something that stays. Stored records change in
 * one transaction. Call it inside withTakenPaths; the conversations whose working folder it was are the caller's to
 * change
 */
export async function moveFolder(from: string, to: string): Promise<boolean> {
  const moving = allFiles().filter((f) => isInside(f.path, from));
  const ids = new Set(moving.map((f) => f.id));
  const renamed = moving.map((f) => ({ ...recordOf(f), path: to + f.path.slice(from.length) }));
  // Free against what stays: the moving paths do not block each other
  const staying: PathSpace = {
    ownerOf: (k) => {
      const id = catalogSpace.ownerOf(k);
      return id && !ids.has(id) ? id : undefined;
    },
    holds: (f) => allFiles().some((x) => !ids.has(x.id) && pathKey(x.path).startsWith(f))
  };
  if (!renamed.length || renamed.some((r) => !pathFree(r.path, staying))) return false;
  const stored: FileRecord[] = [];
  for (const r of renamed) {
    if (isTemporary(r.id)) await putFile(r);
    else stored.push(r);
  }
  const recs = await Promise.all(stored.map((f) => seal('files', f)));
  if (recs.length) await db().files.bulkPut(recs);
  for (const f of stored) catalogPut(f);
  filesChanged();
  return true;
}

/** Give a number to every path that another file already has (two tabs at once, imports). Returns how many */
export async function renumberTakenPaths(): Promise<number> {
  return withTakenPaths(async () => {
    const seen = new Map<string, string>();
    const clash = allFiles().filter((f) => {
      const k = pathKey(f.path);
      if (seen.has(k)) return true;
      seen.set(k, f.id);
      return false;
    });
    for (const o of clash) {
      // Not excepting itself: the index may list this one or the other under the shared path, and both count as taken
      const path = freePath(o.path, catalogSpace);
      const f = catalogFile(o.id);
      if (f) await putFile({ ...f, path });
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
    // Each conversation's files, gathered once (a conversation's moves change only its own files' paths)
    const byConversation = new Map<string, FileEntry[]>();
    for (const f of allFiles()) {
      if (!f.conversationId || isTemporary(f.id) || f.kind !== 'text') continue;
      const list = byConversation.get(f.conversationId);
      if (list) list.push(f);
      else byConversation.set(f.conversationId, [f]);
    }
    for (const c of convs) {
      if (c.workDir || c.temporary) continue;
      const files = byConversation.get(c.id)?.sort((a, b) => a.createdAt - b.createdAt);
      if (!files) continue;
      const mine = new Set(files.map((f) => f.id));
      const top = files[0].path.slice(0, files[0].path.indexOf('/') + 1);
      const topOf = (p: string) => p.slice(0, p.indexOf('/') + 1);
      const ownTop =
        !!top &&
        files.every((f) => pathKey(topOf(f.path)) === pathKey(top)) &&
        allFiles().every((f) => mine.has(f.id) || !isInside(f.path, top));
      const folder = ownTop ? top : freeFolder(folderNameFor(files[0].path, c.createdAt), catalogSpace);
      const next = { ...c, workDir: folder };
      const moved = ownTop ? [] : files.map((f) => ({ ...recordOf(f), path: folder + f.path }));
      const fileRecs = await Promise.all(moved.map((f) => seal('files', f)));
      const convRec = await seal('conversations', next);
      await db().transaction('rw', db().files, db().conversations, async () => {
        if (fileRecs.length) await db().files.bulkPut(fileRecs);
        await db().conversations.put(convRec);
      });
      for (const f of moved) catalogPut(f);
      changed.push(next);
    }
  });
  if (changed.length) filesChanged();
  return changed;
}
