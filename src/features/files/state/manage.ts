// What the user does to folders, files and images: new folders, moving, renaming, deleting, editing, downloading
import { effect, signal } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import { moveFolder } from '../../../lib/db/paths';
import {  catalogImage, catalogSpace, withTakenPaths } from '../../../lib/db/catalog';
import { baseName, cleanFileName, cleanFolderName, extOf, folderOf, freeFolder, freePath, isInside, mimeFromName, pathFree, pathKey } from '../../../lib/paths';
import { getImage, renameImages } from '../../../lib/db/images';
import { deleteMedia } from '../../../state/media';
import type {  FileRecord } from '../../../lib/db/schema';
import { conversations, showChat, startNewChat, updateConversation } from '../../../state/conversations';
import { mainView, showToast } from '../../../state/ui';
import { t } from '../messages';
import { pendingAttachments } from './imports';
import { fileList, imageList } from './lists';
import { closeFileView, filerFolder, openFolder } from './navigation';

/** Folders made with "New folder" that nothing was put in yet (until the app is opened again) */
export const newFolders = signal<string[]>([]);

// A new folder that something was put in is a folder like any other: it is listed from what it holds
effect(() => {
  void fileList.value;
  void imageList.value;
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

/** Move files and images into `folder` ('' is the top), keeping their names; a name already there gets a number */
export async function moveItems(items: { id: string; type: 'file' | 'image' }[], folder: string) {
  await withTakenPaths(async (space) => {
    for (const it of items) {
      // Read inside the queue: what is saved now, not what was listed
      const f = it.type === 'file' ? await fdb.getFile(it.id) : undefined;
      const now = f?.name ?? catalogImage(it.id)?.path;
      if (!now) continue;
      const path = freePath(folder + baseName(now), space, it.id);
      if (f) {
        if (f.name !== path) await fdb.putFile({ ...f, name: path });
      } else if (now !== path) await renameImages([{ id: it.id, path }]);
    }
  });
}

/** A folder as the file manager lists it: its path ('a/b/') and its name */
export interface FolderRef {
  path: string;
  name: string;
}

/**
 * Move folders (with all they hold) and files and images into `target`. A folder never goes into itself, and one
 * already right in the target stays
 */
export async function moveEntries(folders: FolderRef[], items: { id: string; type: 'file' | 'image' }[], target: string) {
  for (const f of folders) if (!isInside(target, f.path) && pathKey(folderOf(f.path.slice(0, -1))) !== pathKey(target)) await renameFolder(f.path, target + f.name);
  if (items.length) await moveItems(items, target);
}

/** What deleting goes through with: the folders chosen, and every file and image chosen or inside them */
export interface Removal {
  folders: string[];
  fileIds: string[];
  imageIds: string[];
}

/** What deleting these takes: a folder goes with everything inside it */
export function planRemoval(folders: string[], items: { id: string; type: 'file' | 'image' }[]): Removal {
  const inFolders = (path: string) => folders.some((f) => isInside(path, f));
  const fileIds = new Set([...items.filter((i) => i.type === 'file').map((i) => i.id), ...(fileList.value ?? []).filter((f) => inFolders(f.name)).map((f) => f.id)]);
  const imageIds = new Set([...items.filter((i) => i.type === 'image').map((i) => i.id), ...(imageList.value ?? []).filter((im) => inFolders(im.path)).map((im) => im.id)]);
  return { folders, fileIds: [...fileIds], imageIds: [...imageIds] };
}

/** Delete what a removal takes (asked first by the caller); the open folder, when it went, gives way to its parent */
export async function removeEntries(r: Removal) {
  if (r.fileIds.length) await deleteFiles(r.fileIds);
  if (r.imageIds.length) await deleteMedia(r.imageIds);
  dropNewFolders(r.folders);
  const open = filerFolder.value;
  if (open && r.folders.some((f) => isInside(open, f))) openFolder(folderOf(open.slice(0, -1)) || null);
}

/** Rename a file or an image (its name in its folder); false (after a toast) when that path is in use */
export async function renameItem(it: { id: string; type: 'file' | 'image'; name: string }, raw: string): Promise<boolean> {
  const path = folderOf(it.name) + cleanFileName(raw, extOf(it.name) || (it.type === 'image' ? 'png' : 'md'));
  if (it.type === 'file') return renameFile(it.id, path);
  return withTakenPaths(async (space) => {
    if (!pathFree(path, space, it.id)) {
      showToast(t('rename.taken', { name: path }), 'error');
      return false;
    }
    await renameImages([{ id: it.id, path }]);
    return true;
  });
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

/** Rename a file (the name may move it into other folders); false when another file or image has that path */
export async function renameFile(id: string, name: string): Promise<boolean> {
  return withTakenPaths(async (space) => {
    const f = await fdb.getFile(id);
    if (!f) return false;
    const clean = cleanFileName(name, extOf(f.name) || 'md');
    if (!pathFree(clean, space, id)) {
      showToast(t('rename.taken', { name: clean }), 'error');
      return false;
    }
    await fdb.putFile({ ...f, name: clean, mime: mimeFromName(clean), updatedAt: Date.now() });
    return true;
  });
}

export async function deleteFiles(ids: string[]) {
  await fdb.deleteFiles(ids);
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

/** Download a file (its current text, or the text given) */
export async function downloadFile(f: FileRecord, text?: string) {
  download(new Blob([text ?? (await fdb.readText(f.id))], { type: `${f.mime};charset=utf-8` }), f.name);
}

/** Download an image or a video as it is stored */
export async function downloadImage(id: string, name: string) {
  const blob = await getImage(id);
  if (blob) download(blob, name);
}
