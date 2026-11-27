// Files feature: state and actions (Files tab, attachments in the input box, file tools for the model).
// Depends on core state; core state never imports this module (it registers itself through extension points).
import { effect, signal } from '@preact/signals';
import * as fdb from '../../lib/db/files';
import { moveFolder, moveIntoWorkDirs, renumberTakenPaths, withTakenPaths } from '../../lib/db/paths';
import { atPath, catalogSpace } from '../../lib/db/catalog';
import { baseName, cleanFileName, cleanFolderName, extOf, folderNameFor, folderOf, freeFolder, freePath, isInside, mimeFromName, pathFree, pathKey } from '../../lib/paths';
import { getSetting, newId, setSetting } from '../../lib/db/repo';
import { getImage, listImages, putImage, renameImages } from '../../lib/db/images';
import type { ImageEntry } from '../../lib/db/catalog';
import type { Attachment, Conversation, FileRecord, MessageRecord, Origin } from '../../lib/db/schema';
import { filesVersion, imagesVersion } from '../../state/stored';
import { conversations, currentConv, showChat, startNewChat, updateConversation } from '../../state/conversations';
import { registerDataLoader } from '../../state/lifecycle';
import { defineFeatureSettings, pickLegacy } from '../../state/feature-settings';
import { mainView, showToast, sidebarOpen, sidebarTab, type MainViewState } from '../../state/ui';
import { pushHash, registerRoute, setHash } from '../../state/router';
import { registerToolProvider } from '../../state/tool-registry';
import { extractText } from './extract';
import { filesNote, makeFileTools, MAX_MATCHES, type Match } from './tools';
import { formatNumber } from '../../lib/i18n';
import { t } from './messages';
import { fetchFromWeb } from '../../state/fetch-page';
import type { Fetched } from '../../lib/fetcher/protocol';
import { cleanStorage, inspectPage, runJavaScript, type SandboxPage } from '../../lib/sandbox/client';

/** Let chat models work on the files of their working folder (the file tools) */
export const fileSettings = defineFeatureSettings('files', { fileTools: true }, (old) => pickLegacy(old, { fileTools: true }));

/** Characters of an attached file put directly into the message; the rest is read with read_file */
export const ATTACH_INLINE_CHARS = 60_000;

// ---- what lists show: files and images without their contents, from the catalog (lib/db/catalog.ts) ----
export const fileList = signal<FileRecord[] | null>(null);
export const imageList = signal<ImageEntry[] | null>(null);

/** Bring the lists up to date (the catalog is in memory once loaded, so this is cheap) */
export async function refreshFiles(): Promise<void> {
  fileList.value = await fdb.listFiles();
}
export async function refreshImages(): Promise<void> {
  imageList.value = await listImages();
}

// Lists already shown follow every change to the stored files and images (whoever made it)
effect(() => {
  void filesVersion.value;
  if (fileList.peek()) void refreshFiles();
});
effect(() => {
  void imagesVersion.value;
  if (imageList.peek()) void refreshImages();
});

export const getFile = fdb.getFile;

/** Lowercased texts for searching inside files, by id with the change they belong to (read the first time a search needs them) */
const searchTexts = new Map<string, { at: number; text: string }>();

/** The files whose whole text holds `query` (read only for a search: lists carry no texts) */
export async function searchContents(query: string): Promise<Set<string>> {
  const q = query.trim().toLowerCase();
  const files = await fdb.listFiles();
  const stale = files.filter((f) => searchTexts.get(f.id)?.at !== f.updatedAt);
  for (let i = 0; i < stale.length; i += 200) {
    const part = stale.slice(i, i + 200);
    const texts = await fdb.readTexts(part.map((f) => f.id));
    for (const f of part) searchTexts.set(f.id, { at: f.updatedAt, text: (texts.get(f.id) ?? '').toLowerCase() });
  }
  return new Set(files.filter((f) => searchTexts.get(f.id)?.text.includes(q)).map((f) => f.id));
}
/** A file's current text (or the one before its last change) */
export const readText = fdb.readText;

/** How many files there are, and their characters (temporary ones not counted) */
export const fileUsage = fdb.fileUsage;

// ---- pages: their site, the files it gives them, and their localStorage ----
/** Text a page's preview receives from its site at most (characters) */
const PAGE_TEXT_LIMIT = 5_000_000;

/** Every path in use (files and images), for working out sites */
const allPaths = () => [...(fileList.value ?? []).map((f) => f.name), ...(imageList.value ?? []).flatMap((im) => (im.path ? [im.path] : []))];

/**
 * A page's site: the nearest folder at or above it that has an index.html, else its own folder; '' for a page at
 * the top, which has none ('a/b/index.html' makes 'a/b/' a site for every page under it)
 */
export function siteOf(pagePath: string, paths: string[]): string {
  const have = new Set(paths.map(pathKey));
  for (let dir = folderOf(pagePath); dir; dir = folderOf(dir.slice(0, -1))) if (have.has(pathKey(`${dir}index.html`))) return dir;
  return folderOf(pagePath);
}

/** The file a site's pages keep their localStorage in, at the site's top */
export const STORAGE_FILE = 'localStorage.json';

/** What the app knows about each storage file it writes (by path key) */
interface StorageState {
  /** The items it saved last (a page shown again starts from them) */
  items: Record<string, string> | null;
  /** The updatedAt of each of its own writes: a different one is someone else's change */
  stamps: Set<number>;
}
const storageStates = new Map<string, StorageState>();
const storageState = (path: string) => {
  const k = pathKey(path);
  let st = storageStates.get(k);
  if (!st) storageStates.set(k, (st = { items: null, stamps: new Set() }));
  return st;
};

/** A storage file's items; anything else than an object of strings (a broken edit, say) counts as empty */
function parseStorage(text: string): Record<string, string> {
  try {
    return cleanStorage(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

/**
 * What a page's preview may load by relative path: the texts and images of its site, keyed by their path in it ('/'
 * in the page is the site's top), and its localStorage. Nothing outside the site, so a page cannot read unrelated
 * files; with `within` (a model trying a page), nothing outside that folder either. Texts stop at PAGE_TEXT_LIMIT
 */
export async function pageOf(page: FileRecord, within?: string): Promise<SandboxPage> {
  const [files, images] = await Promise.all([fdb.listFiles(), listImages()]);
  const site = siteOf(page.name, [...files.map((f) => f.name), ...images.flatMap((im) => (im.path ? [im.path] : []))]);
  const out: Record<string, string | Blob> = {};
  if (!site) return { path: page.name, files: out };
  const allowed = (path: string) => isInside(path, site) && (within === undefined || isInside(path, within));
  const inSite = files.filter((f) => f.id !== page.id && allowed(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const texts = await fdb.readTexts(inSite.map((f) => f.id));
  let chars = 0;
  for (const f of inSite) {
    const text = texts.get(f.id) ?? '';
    if (chars + text.length > PAGE_TEXT_LIMIT) continue;
    chars += text.length;
    out[f.name.slice(site.length)] = text;
  }
  for (const im of images) {
    if (!im.path || !allowed(im.path)) continue;
    const blob = await getImage(im.id).catch(() => null);
    if (blob) out[im.path.slice(site.length)] = blob;
  }
  const storagePath = `${site}${STORAGE_FILE}`;
  const st = storageState(storagePath);
  const stored = files.find((f) => pathKey(f.name) === pathKey(storagePath));
  const first = st.items ?? (stored ? parseStorage(await fdb.readText(stored.id)) : {});
  return {
    path: page.name.slice(site.length),
    files: out,
    storage: {
      // What it saved last, so showing the page again (or over the whole window) starts from its latest data
      items: () => st.items ?? first,
      save: (items) => void saveStorage(storagePath, items, page)
    }
  };
}

/** Keep a page's localStorage in its site's storage file (made on the first write; it keeps no previous text) */
async function saveStorage(path: string, items: Record<string, string>, page: FileRecord) {
  const st = storageState(path);
  st.items = items;
  const text = JSON.stringify(items);
  // Escapes can make the JSON longer than the items: what a file cannot hold is not saved (and said so)
  if (text.length > fdb.MAX_FILE_CHARS) return showToast(t('storage.tooBig'), 'error');
  try {
    await withTakenPaths(async (space) => {
      const at = atPath(path);
      if (at?.kind === 'file') {
        // Known as its own before the change is heard of, so the page showing it is not loaded again
        const now = Date.now();
        st.stamps.add(now);
        await fdb.setText(at.file.id, text, 'user', true, now);
      } else if (!at && pathFree(path, space)) {
        const f = fdb.newFile({ id: newId(), name: path, origin: { kind: 'made' }, text, by: 'user', conversationId: page.conversationId });
        st.stamps.add(f.updatedAt);
        await fdb.createFile(f, text, fdb.isTemporaryFile(page.id));
      }
    });
  } catch (e) {
    showToast(t('storage.failed', { message: (e as Error).message }), 'error');
  }
}

/**
 * What a page's preview depends on, as a short text: the site's files and images as they are now. Its storage file
 * counts only when someone else changed it (a page's own saves never reload it). The preview loads again when this
 * changes
 */
export function siteSignature(page: FileRecord): string {
  const files = fileList.value ?? [];
  const site = siteOf(page.name, allPaths());
  if (!site) return '';
  const storageKey = pathKey(`${site}${STORAGE_FILE}`);
  const parts: string[] = [site];
  for (const f of files) {
    if (!isInside(f.name, site)) continue;
    if (pathKey(f.name) !== storageKey) parts.push(`${f.id}:${f.name}:${f.updatedAt}`);
    else if (!storageState(f.name).stamps.has(f.updatedAt)) parts.push(`storage:${f.updatedAt}`);
  }
  for (const im of imageList.value ?? []) if (im.path && isInside(im.path, site)) parts.push(`${im.id}:${im.path}`);
  return parts.sort().join('|');
}

/** Someone else changed a storage file: pages start from it again, not from what they saved last */
effect(() => {
  for (const f of fileList.value ?? []) {
    const st = storageStates.get(pathKey(f.name));
    if (st && !st.stamps.has(f.updatedAt)) st.items = null;
  }
});
// A deleted storage file: what the pages saved is gone too
effect(() => {
  const names = new Set((fileList.value ?? []).map((f) => pathKey(f.name)));
  for (const [k, st] of storageStates) if (!names.has(k)) st.items = null;
});

// ---- the file manager (#/files) and single files (#/f/<id>) in the main area ----
export type FilerView = 'all' | 'text' | 'image' | 'document' | 'upload';
export type FilerSort = 'updated' | 'name' | 'type' | 'size';
export type FilerOrder = 'asc' | 'desc';
export interface FilerPrefs {
  layout: 'grid' | 'list';
  sort: FilerSort;
  order: FilerOrder;
}

export const filerView = signal<FilerView>('all');
/** Only items made in / attached to this conversation */
export const filerConversation = signal<string | null>(null);
/** The folder open ('todo-app/'; null is the top) */
export const filerFolder = signal<string | null>(null);
export const filerQuery = signal('');
export const filerPrefs = signal<FilerPrefs>({ layout: 'grid', sort: 'updated', order: 'desc' });

const PREFS_KEY = 'ui:filer';
let prefsLoaded = false;
export async function loadFilerPrefs() {
  if (prefsLoaded) return;
  prefsLoaded = true;
  filerPrefs.value = { ...filerPrefs.value, ...(await getSetting<Partial<FilerPrefs>>(PREFS_KEY, {})) };
}
export async function setFilerPrefs(patch: Partial<FilerPrefs>) {
  filerPrefs.value = { ...filerPrefs.value, ...patch };
  await setSetting(PREFS_KEY, filerPrefs.value);
}

const FILER_VIEWS: FilerView[] = ['all', 'text', 'image', 'document', 'upload'];

/**
 * The Files tab in one of its three ways of showing things: by type (view), by chat (conversationId), or by folder
 * (view 'all', no chat; folder null is the top). Choosing one leaves the others. A new place is pushed onto the
 * browser's history, so Back returns to where this was
 */
export function openFiler(view?: FilerView, conversationId?: string | null, folder?: string | null) {
  showFiler(view, conversationId, folder);
  pushHash(filerHash());
}

function showFiler(view?: FilerView, conversationId?: string | null, folder?: string | null) {
  if (view) filerView.value = view;
  if (conversationId !== undefined) filerConversation.value = conversationId;
  if (folder !== undefined) filerFolder.value = folder;
  mainView.value = { kind: 'files' };
  sidebarTab.value = 'files';
  sidebarOpen.value = false;
}

/** The hash of what the Files tab shows ('#/files/todo-app/js/', '#/files?type=text', '#/files?chat=<id>'), so a reload reopens it */
const filerHash = () => {
  if (filerConversation.value) return `#/files?chat=${encodeURIComponent(filerConversation.value)}`;
  if (filerView.value !== 'all') return `#/files?type=${filerView.value}`;
  const f = filerFolder.value;
  return f ? `#/files/${f.split('/').map(encodeURIComponent).join('/')}` : '#/files';
};

/** Open a folder (null: the top) */
export function openFolder(folder: string | null) {
  openFiler('all', null, folder);
}

/** Show what a hash names (a reload, Back, a link), and write the hash back in its own form (starting clears it) */
function restoreFiler(view: FilerView, conversationId: string | null, folder: string | null) {
  showFiler(view, conversationId, folder);
  setHash(filerHash());
}

registerRoute({
  pattern: /^#\/files\/?(?:\?(type|chat)=([^&]*))?$/,
  open: (m) => {
    if (m[1] === 'type' && FILER_VIEWS.includes(m[2] as FilerView)) restoreFiler(m[2] as FilerView, null, null);
    else if (m[1] === 'chat') restoreFiler('all', decodeURIComponent(m[2]), null);
    else restoreFiler('all', null, null);
  }
});
registerRoute({
  pattern: /^#\/files\/(.+\/)$/,
  open: (m) => {
    let folder: string;
    try {
      folder = m[1].split('/').map(decodeURIComponent).join('/');
    } catch {
      return restoreFiler('all', null, null);
    }
    restoreFiler('all', null, cleanFolderName(folder) || null);
  }
});

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

/**
 * Move files and images into `folder` ('' is the top); a name already there gets a number. Each comes with the name it
 * is shown by: an image made in a chat has no path yet, and gets that name as its first
 */
export async function moveItems(items: { id: string; type: 'file' | 'image'; name: string }[], folder: string) {
  await withTakenPaths(async (space) => {
    for (const it of items) {
      // Read inside the queue: what is saved now, not what was listed
      const f = it.type === 'file' ? await fdb.getFile(it.id) : undefined;
      const now = f?.name ?? it.name;
      const path = freePath(folder + baseName(cleanFileName(now, 'png')), space, it.id);
      if (f) {
        if (f.name !== path) await fdb.putFile({ ...f, name: path });
      } else if (it.type === 'image') await renameImages([{ id: it.id, path }]);
    }
  });
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

/** Where "back" goes from a file: the screen it was opened from */
let returnTo: MainViewState = { kind: 'files' };

export async function openFile(id: string) {
  const cur = mainView.value;
  if (cur.kind !== 'file') returnTo = cur.kind === 'chat' ? { kind: 'chat' } : { kind: 'files' };
  mainView.value = { kind: 'file', id };
  sidebarOpen.value = false;
  // Its own place in the history, so Back leads to the folder it was opened from
  if (fdb.isTemporaryFile(id)) setHash('');
  else pushHash(`#/f/${id}`);
}

export const fileReturnsToChat = () => returnTo.kind === 'chat';

export function closeFileView() {
  if (returnTo.kind === 'chat') showChat();
  else openFiler();
}

registerRoute({
  pattern: /^#\/f\/([\w-]+)$/,
  open: async (m) => {
    if (!(await fdb.getFile(m[1]))) return;
    returnTo = { kind: 'files' };
    sidebarTab.value = 'files';
    mainView.value = { kind: 'file', id: m[1] };
    sidebarOpen.value = false;
    setHash(m[0]);
  }
});

// ---- editing by the user ----
export async function saveUserText(id: string, text: string) {
  await fdb.setText(id, text, 'user');
}

/** Go back to the text before the last change (again: forward to it) */
export async function undoLastChange(id: string) {
  await fdb.swapPrevious(id);
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

// ---- attachments in the input box ----
export interface PendingAttachment {
  fileId: string;
  name: string;
  chars?: number;
  reading?: boolean;
}

export const pendingAttachments = signal<PendingAttachment[]>([]);

const setPending = (id: string, patch: Partial<PendingAttachment> | null) => {
  pendingAttachments.value = patch === null ? pendingAttachments.value.filter((a) => a.fileId !== id) : pendingAttachments.value.map((a) => (a.fileId === id ? { ...a, ...patch } : a));
};

/** Files being read from the device (shown as placeholders in the file manager) */
export const importing = signal<{ id: string; name: string }[]>([]);

/** Read one file from the user's device (or the web) into `folder` ('' or 'a/'); returns the record, or null (after a toast) */
async function importOne(file: File, id: string, temporary: boolean, url?: string, conversationId?: string, folder = ''): Promise<FileRecord | null> {
  try {
    const ex = await extractText(file);
    const rec = await withTakenPaths(async (space) => {
      // A name already in use gets a number: 'notes (2).md'
      const name = freePath(cleanFileName(folder + file.name, 'txt'), space);
      const rec = fdb.newFile({ id, name, origin: url ? { kind: 'web', url } : { kind: 'upload' }, text: ex.text, by: 'upload', fromPdf: ex.fromPdf, conversationId });
      // A pdf's text is stored as text; keep the original extension visible but treat it as plain text
      if (rec.mime === 'application/pdf') rec.mime = 'text/plain';
      return fdb.createFile(rec, ex.text, temporary);
    });
    if (ex.truncated) showToast(t('import.truncated', { name: file.name, n: formatNumber(fdb.MAX_FILE_CHARS) }), 'error');
    return rec;
  } catch (e) {
    showToast((e as Error).message, 'error');
    return null;
  }
}

/** Images kept as they are; SVG is refused, since it can carry scripts */
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif|avif)$/;
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function importImage(file: File, id: string, origin: Origin, conv?: Conversation, folder = ''): Promise<string | null> {
  if (!IMAGE_MIME.test(file.type)) {
    showToast(t(file.type === 'image/svg+xml' ? 'import.svg' : 'extract.unsupported', { name: file.name }), 'error');
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast(t('extract.tooBig', { max: formatNumber(MAX_IMAGE_BYTES / 1024 / 1024) }), 'error');
    return null;
  }
  return withTakenPaths(async (space) => {
    const path = freePath(cleanFileName(folder + file.name, IMAGE_EXT[file.type]), space);
    await putImage({ id, mime: file.type, conversationId: conv?.id, info: { path, origin } }, file, !!conv?.temporary);
    return path;
  });
}

// ---- fetching from the web (through the fetch page: state/fetch-page.ts) ----
/** Keep what was fetched in the conversation's working folder (so its tools can read it): a file, or an image */
async function saveFetched(r: Fetched, conv: Conversation): Promise<{ kind: 'file'; file: FileRecord } | { kind: 'image'; name: string } | null> {
  const file = new File([r.data], r.name, { type: r.mime });
  const id = newId();
  const dir = await ensureWorkDir(conv.id, r.name);
  if (r.mime.startsWith('image/')) {
    const path = await importImage(file, id, { kind: 'web', url: r.url }, conv, dir);
    return path ? { kind: 'image', name: path.slice(dir.length) } : null;
  }
  const rec = await importOne(file, id, !!conv.temporary, r.url, conv.id, dir);
  return rec ? { kind: 'file', file: rec } : null;
}

/** Upload from the file manager into `folder` ('' is the top; not attached to anything): images as images, the rest as text (PDFs too) */
export async function importFromDevice(files: File[], folder = '') {
  const jobs = files.map((f) => ({ id: newId(), file: f }));
  importing.value = [...importing.value, ...jobs.map((j) => ({ id: j.id, name: j.file.name }))];
  const done = await Promise.all(
    jobs.map(async (j) => {
      const r = j.file.type.startsWith('image/') ? !!(await importImage(j.file, j.id, { kind: 'upload' }, undefined, folder)) : !!(await importOne(j.file, j.id, false, undefined, undefined, folder));
      importing.value = importing.value.filter((x) => x.id !== j.id);
      return r;
    })
  );
  const n = done.filter(Boolean).length;
  if (n) showToast(n === 1 ? t('import.doneOne') : t('import.done', { n: formatNumber(n) }));
}

/** Read files from the user's device, keep them in the Files tab, and attach them to the next message */
export async function uploadFiles(files: File[], conv: Conversation) {
  await Promise.all(
    files.map(async (file) => {
      const id = newId();
      pendingAttachments.value = [...pendingAttachments.value, { fileId: id, name: file.name, reading: true }];
      const rec = await importOne(file, id, !!conv.temporary);
      if (rec) setPending(id, { reading: false, chars: rec.size });
      else setPending(id, null);
    })
  );
}

/** Attach several saved files and go back to the chat */
export async function useInChat(ids: string[]) {
  for (const id of ids) await attachExisting(id);
  showChat();
}

/** Attach a file that is already in the Files tab */
export async function attachExisting(id: string) {
  // Image and video prompts take no files: back to chat, where the attachment shows and is sent
  const conv = currentConv.value;
  if (conv.imageMode || conv.videoMode) await updateConversation({ imageMode: false, videoMode: false });
  if (pendingAttachments.value.some((a) => a.fileId === id)) return;
  const f = await fdb.getFile(id);
  if (f) pendingAttachments.value = [...pendingAttachments.value, { fileId: f.id, name: f.name, chars: f.size }];
}

export function detach(id: string) {
  setPending(id, null);
}

/** Snapshot the attached files for the message being sent, and clear the input box's list */
export async function takeAttachments(): Promise<Attachment[]> {
  const ready = pendingAttachments.value.filter((a) => !a.reading);
  if (!ready.length) return [];
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.reading);
  const out: Attachment[] = [];
  for (const a of ready) {
    const f = await fdb.getFile(a.fileId);
    if (!f) continue;
    const text = await fdb.readText(f.id);
    // A long one is cut after a whole line, so the model can go on with read_file from the next line
    const cut = text.length > ATTACH_INLINE_CHARS ? text.slice(0, text.lastIndexOf('\n', ATTACH_INLINE_CHARS) + 1 || ATTACH_INLINE_CHARS) : text;
    out.push({ fileId: f.id, name: f.name, mime: f.mime, text: cut, totalChars: text.length });
  }
  return out;
}

// ---- the working folder: the one folder a conversation's model reads and writes ----
/** The conversation's working folder as it is now ('todo-app/'; '' before its first file) */
export function workDirOf(convId: string): string {
  return conversations.value.find((x) => x.id === convId)?.workDir ?? '';
}

/**
 * The conversation's working folder, made now if it has none: named `name` (the model's choice, one level), else
 * after the file that makes it (`firstFile`). Not one that another chat works in, even while it is empty
 */
async function ensureWorkDir(convId: string, firstFile: string, name = ''): Promise<string> {
  return (
    workDirOf(convId) ||
    withTakenPaths(async (space) => {
      // Another call may have made it while this one waited its turn
      const made = workDirOf(convId);
      if (made) return made;
      const others = conversations.value.flatMap((c) => (c.id !== convId && c.workDir ? [pathKey(c.workDir)] : []));
      const used = (k: string) => others.some((o) => o.startsWith(k) || k.startsWith(o));
      const dir = freeFolder(cleanFolderName(name.replace(/[\\/]/g, '-')) || folderNameFor(firstFile, Date.now()), space, used);
      await updateConversation({ workDir: dir }, convId);
      return dir;
    })
  );
}

/** Files attached to the conversation's messages: the model may read them, wherever they are */
function attachedIds(history: MessageRecord[]): Set<string> {
  return new Set(history.flatMap((m) => (m.attachments ?? []).map((a) => a.fileId)));
}

/** A file the model of a conversation may read: by id, or by path in its working folder (else undefined) */
async function readableFile(convId: string, history: MessageRecord[], ref: string): Promise<FileRecord | undefined> {
  const dir = workDirOf(convId);
  const byId = await fdb.getFile(ref);
  if (byId) return (dir && isInside(byId.name, dir)) || attachedIds(history).has(byId.id) ? byId : undefined;
  if (!dir) return undefined;
  await fdb.listFiles();
  const at = atPath(dir + cleanFileName(ref, extOf(ref) || 'md'));
  return at?.kind === 'file' ? at.file : undefined;
}

/** A file this conversation's model may read (in its working folder, or attached): its path and text, for other features' tools */
export async function conversationFile(conv: Conversation, history: MessageRecord[], ref: string): Promise<{ name: string; text: string } | undefined> {
  const f = await readableFile(conv.id, history, ref);
  return f && { name: relativeTo(workDirOf(conv.id), f.name), text: await fdb.readText(f.id) };
}

/** A path as the model sees it: relative to the working folder (whole when outside it) */
const relativeTo = (dir: string, path: string) => (dir && isInside(path, dir) ? path.slice(dir.length) : path);

/**
 * Lines of the working folder's files that match a pattern from the model. It runs in a sandbox worker, stopped
 * after RUN_TIMEOUT_MS: a pattern that backtracks without end must not freeze the app
 */
async function searchFolder(dir: string, pattern: string, ignoreCase: boolean, only: string | null): Promise<Match[]> {
  if (!dir) return [];
  const pick = only ? new RegExp(only, 'i') : null;
  const inDir = (await fdb.listFiles()).filter((f) => isInside(f.name, dir) && (!pick || pick.test(f.name.slice(dir.length))));
  const texts = await fdb.readTexts(inDir.map((f) => f.id));
  const files: Record<string, string> = {};
  for (const f of inDir) files[f.name.slice(dir.length)] = texts.get(f.id) ?? '';
  const code = `const re = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(ignoreCase ? 'i' : '')});
const out = [];
for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  const lines = text.split('\\n');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    out.push({ path, line: i + 1, text: lines[i].slice(0, 2000) });
    if (out.length > ${MAX_MATCHES}) return out;
  }
}
return out;`;
  const r = await runJavaScript(code, { files });
  if (r.error || r.result === undefined) throw new Error(t('tool.searchFailed', { message: r.error ?? '' }));
  return JSON.parse(r.result) as Match[];
}

function fileTools(conv: Conversation, history: MessageRecord[]) {
  const dir = () => workDirOf(conv.id);
  /** A file the model may change: one in the working folder (one attached from outside is only read) */
  const inFolder = async (id: string) => {
    const f = await fdb.getFile(id);
    if (!f) throw new Error(t('tool.notFound'));
    if (!dir() || !isInside(f.name, dir())) throw new Error(t('tool.readOnly', { name: f.name }));
    return f;
  };
  return makeFileTools(
    {
      async fetch(url, signal) {
        const r = await fetchFromWeb(url, 'save', signal);
        return r && (await saveFetched(r, conv));
      },
      async create(path, text, folder) {
        const d = await ensureWorkDir(conv.id, path, folder);
        return withTakenPaths(async (space) => {
          const full = d + path;
          const at = atPath(full);
          // One file per path: writing to a path the folder has replaces that file's text
          if (at?.kind === 'file') return { file: await fdb.setText(at.file.id, text, 'model'), replaced: true };
          if (!pathFree(full, space)) throw new Error(t('tool.pathTaken', { name: path }));
          const f = fdb.newFile({ id: newId(), name: full, origin: { kind: 'made' }, text, by: 'model', conversationId: conv.id });
          return { file: await fdb.createFile(f, text, !!conv.temporary), replaced: false };
        });
      },
      get: (ref) => readableFile(conv.id, history, ref),
      text: (f) => fdb.readText(f.id),
      async update(id, text, append) {
        return fdb.setText((await inFolder(id)).id, text, 'model', append);
      },
      async list() {
        const d = dir();
        if (!d) return [];
        const [files, images] = await Promise.all([fdb.listFiles(), listImages()]);
        return [
          ...files.filter((f) => isInside(f.name, d)).map((f) => ({ path: f.name.slice(d.length), kind: 'file' as const, size: f.size })),
          ...images.flatMap((im) => (im.path && isInside(im.path, d) ? [{ path: im.path.slice(d.length), kind: 'image' as const, size: im.size }] : []))
        ];
      },
      search: (pattern, ignoreCase, only) => searchFolder(dir(), pattern, ignoreCase, only),
      async move(id, to) {
        await inFolder(id);
        const full = dir() + to;
        return withTakenPaths(async (space) => {
          // Read inside the queue: an edit waiting before this one is kept
          const f = await inFolder(id);
          if (!pathFree(full, space, id)) throw new Error(t('tool.moveTaken', { name: to }));
          return fdb.putFile({ ...f, name: full, mime: mimeFromName(full) });
        });
      },
      async remove(id) {
        await inFolder(id);
        await deleteFiles([id]);
      },
      async inspect(f, waitMs, script, signal) {
        // Only what lies in the working folder, even when the page's site reaches above it
        const page = await pageOf(f, dir());
        const items = page.storage?.items() ?? {};
        // Its data as the user's preview has it, but what it stores while being tried is not kept
        return inspectPage(await fdb.readText(f.id), { ...page, storage: { items: () => items, save: () => {} } }, { waitMs, script, signal });
      },
      pathOf: (f) => relativeTo(dir(), f.name)
    },
    { hasFolder: !!dir() }
  );
}

/** Files of the working folder listed in the system prompt at most (the rest are found with list_files) */
const NOTE_FILES = 200;

registerToolProvider({
  id: 'files',
  // Until the working folder exists only write_file and fetch_file; once a file made it (in this answer too) all
  tools: ({ conv, history }) => (fileSettings.value.value.fileTools ? fileTools(conv, history) : []),
  dynamicTools: ({ conv, history }) => (fileSettings.value.value.fileTools && workDirOf(conv.id) ? fileTools(conv, history) : []),
  systemNote({ conv }) {
    const dir = workDirOf(conv.id);
    if (!fileSettings.value.value.fileTools || !dir) return undefined;
    // The list is loaded with the conversation (below); while it loads, only the folder is named
    const files = fileList.value?.filter((f) => isInside(f.name, dir)).map((f) => ({ id: f.id, path: f.name.slice(dir.length), size: f.size })) ?? null;
    return filesNote(dir, files, NOTE_FILES);
  }
});

// The system note lists the working folder's files from the file list: loaded once a conversation with one is open
effect(() => {
  if (currentConv.value.workDir && !fileList.peek()) void refreshFiles();
});

// Once the data can be read (and after an import): the catalog loads (converting data in older shapes), conversations
// from before working folders get one (development only, goes before release), and paths two things share get a number
registerDataLoader(async () => {
  await fdb.listFiles();
  const moved = await moveIntoWorkDirs(conversations.value);
  if (moved.length) conversations.value = conversations.value.map((c) => moved.find((m) => m.id === c.id) ?? c);
  await renumberTakenPaths();
  if (fileList.peek()) await refreshFiles();
  if (imageList.peek()) await refreshImages();
});
