// What the user does to folders and files: new folders, moving, renaming, deleting, editing, downloading
import { effect, signal } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import { moveFolder } from '../../../lib/db/paths';
import { catalogSpace, withTakenPaths, type FileEntry } from '../../../lib/db/catalog';
import { baseName, cleanFileName, cleanFolderName, extOf, folderOf, freeFolder, freePath, isInside, mimeFromName, pathFree, pathKey } from '../../../lib/paths';
import { removeFiles } from '../../../state/media';
import { conversations, showChat, startNewChat, updateConversation } from '../../../state/conversations';
import { mainView, showToast } from '../../../state/ui';
import { t } from '../messages';
import { pendingAttachments } from './imports';
import { fileList } from './lists';
import { closeFileView, filerFolder, openFolder } from './navigation';

/** Folders made with "New folder" that nothing was put in yet (until the app is opened again) */
export const newFolders = signal<string[]>([]);

// A new folder that something was put in is a folder like any other: it is listed from what it holds
effect(() => {
  void fileList.value;
  const keep = newFolders.peek().filter((p) => !catalogSpace.holds(pathKey(p)));
  if (keep.length !== newFolders.peek().length) newFolders.value = keep;
});

/** New folders under `from` now live under `to` ('' drops them) */
function moveNewFolders(from: string, to: string | null) {
  newFolders.value = newFolders.value.flatMap((p) => (!isInside(p, from) ? [p] : to === null ? [] : [to + p.slice(from.length)]));
}

/** Forget new folders inside these folders (they were deleted) */
export function dropNewFolders(folders: string[]) {
  for (const f of folders) moveNewFolders(f, null);
}

/** Make a new folder in `parent` (shown there, empty, to drop or move things into); false (after a toast) when that name is in use */
export async function createFolder(parent: string, raw: string): Promise<boolean> {
  const name = cleanFolderName(raw);
  if (!name) return false;
  const path = parent + name;
  return withTakenPaths(async (space) => {
    if (freeFolder(path, space) !== path || newFolders.value.some((f) => pathKey(f) === pathKey(path))) {
      showToast(t('folder.exists', { name: path }), 'error');
      return false;
    }
    newFolders.value = [...newFolders.value, path];
    return true;
  });
}

/**
 * Rename or move a folder: everything inside it, the new folders in it, and the working folder of the chats that use
 * it, follow. False (after a toast) when the new place is not free. A change of case alone is a rename too
 */
export async function renameFolder(from: string, raw: string): Promise<boolean> {
  const to = cleanFolderName(raw);
  if (!to || to === from) return false;
  // Into itself, it would never end
  if (pathKey(to) !== pathKey(from) && isInside(to, from)) {
    showToast(t('folder.intoItself'), 'error');
    return false;
  }
  const ok = await withTakenPaths(async (space) => {
    const holds = space.holds(pathKey(from));
    if (!holds) {
      // Only a new folder, with nothing in it yet: a name on screen
      if (pathKey(to) !== pathKey(from) && freeFolder(to, space) !== to) return false;
      return newFolders.value.some((p) => isInside(p, from));
    }
    return moveFolder(from, to);
  });
  if (!ok) {
    showToast(t('folder.taken', { name: to }), 'error');
    return false;
  }
  moveNewFolders(from, to);
  for (const c of conversations.value) if (c.workDir && isInside(c.workDir, from)) await updateConversation({ workDir: to + c.workDir.slice(from.length) }, c.id);
  if (filerFolder.value && isInside(filerFolder.value, from)) openFolder(to + filerFolder.value.slice(from.length));
  return true;
}

/** Move files into `folder` ('' is the top), keeping their names; a name already there gets a number */
export async function moveItems(ids: string[], folder: string) {
  await withTakenPaths(async (space) => {
    for (const id of ids) {
      // Read inside the queue: what is saved now, not what was listed
      const f = await fdb.getFile(id);
      if (!f) continue;
      const path = freePath(folder + baseName(f.path), space, id);
      if (f.path !== path) await fdb.putFile({ ...f, path });
    }
  });
}

/** A folder as the file manager lists it: its path ('a/b/') and its name */
export interface FolderRef {
  path: string;
  name: string;
}

/**
 * Move folders (with all they hold) and files into `target`. A folder never goes into itself, and one already right
 * in the target stays
 */
export async function moveEntries(folders: FolderRef[], ids: string[], target: string) {
  for (const f of folders) if (!isInside(target, f.path) && pathKey(folderOf(f.path.slice(0, -1))) !== pathKey(target)) await renameFolder(f.path, target + f.name);
  if (ids.length) await moveItems(ids, target);
}

/** What deleting goes through with: the folders chosen, and every file chosen or inside them */
export interface Removal {
  folders: string[];
  ids: string[];
}

/** What deleting these takes: a folder goes with everything inside it */
export function planRemoval(folders: string[], ids: string[]): Removal {
  const inFolders = (path: string) => folders.some((f) => isInside(path, f));
  return { folders, ids: [...new Set([...ids, ...(fileList.value ?? []).filter((f) => inFolders(f.path)).map((f) => f.id)])] };
}

/** Delete what a removal takes (asked first by the caller); the open folder, when it went, gives way to its parent */
export async function removeEntries(r: Removal) {
  if (r.ids.length) await deleteFiles(r.ids);
  dropNewFolders(r.folders);
  const open = filerFolder.value;
  if (open && r.folders.some((f) => isInside(open, f))) openFolder(folderOf(open.slice(0, -1)) || null);
}

/** Rename a file (its name in its folder); false (after a toast) when that path is in use */
export async function renameItem(it: { id: string; path: string }, raw: string): Promise<boolean> {
  return renameFile(it.id, folderOf(it.path) + raw);
}

/** Start a new chat whose working folder is `folder`, so its model works on the files already there */
export async function chatInFolder(folder: string) {
  startNewChat();
  await updateConversation({ workDir: folder }, null);
  showChat();
}

export async function saveUserText(id: string, text: string) {
  await fdb.setText(id, text, 'user');
}

/**
 * Rename a file (the name may move it into other folders); false when another file has that path. A text file takes
 * the type its new extension says; any other keeps its type, its bytes being what they are
 */
export async function renameFile(id: string, name: string): Promise<boolean> {
  return withTakenPaths(async (space) => {
    const f = await fdb.getFile(id);
    if (!f) return false;
    const clean = cleanFileName(name, extOf(f.path) || 'md');
    if (!pathFree(clean, space, id)) {
      showToast(t('rename.taken', { name: clean }), 'error');
      return false;
    }
    await fdb.putFile({ ...f, path: clean, ...(f.kind === 'text' ? { mime: mimeFromName(clean), updatedAt: Date.now() } : {}) });
    return true;
  });
}

/** Delete files: the answers that showed one keep an empty slot, and attachments waiting to be sent let go of them */
export async function deleteFiles(ids: string[]) {
  await removeFiles(ids);
  pendingAttachments.value = pendingAttachments.value.filter((a) => !ids.includes(a.fileId));
  const v = mainView.value;
  if (v.kind === 'file' && v.id && ids.includes(v.id)) closeFileView();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a file as it is stored (a text file: its current text, or the text given) */
export async function downloadFile(f: FileEntry, text?: string) {
  const blob = f.kind === 'text' ? new Blob([text ?? (await fdb.readText(f.id))], { type: `${f.mime};charset=utf-8` }) : await fdb.readBytes(f.id);
  if (blob) download(blob, f.path);
}
