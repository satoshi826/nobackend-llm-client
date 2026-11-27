// Files feature: state and actions (Files tab, attachments in the input box, file tools for the model).
// Depends on core state; core state never imports this module (it registers itself through extension points).
import { effect, signal } from '@preact/signals';
import * as fdb from '../../lib/db/files';
import { folderNameFor, freeFolder, freePath, isInside, moveIntoWorkDirs, pathFree, pathKey, renumberTakenPaths, withTakenPaths } from '../../lib/db/paths';
import { getSetting, newId, setSetting } from '../../lib/db/repo';
import { getImage, listImages, putImage } from '../../lib/db/images';
import type { Attachment, Conversation, FileRecord, ImageSource, MessageRecord } from '../../lib/db/schema';
import type { ImageMeta } from './filer';
import { filesVersion, imagesVersion } from '../../state/stored';
import { conversations, currentConv, showChat, startNewChat, updateConversation } from '../../state/conversations';
import { registerDataLoader } from '../../state/lifecycle';
import { defineFeatureSettings, pickLegacy } from '../../state/feature-settings';
import { mainView, showToast, sidebarOpen, sidebarTab, type MainViewState } from '../../state/ui';
import { registerRoute, setHash } from '../../state/router';
import { registerToolProvider } from '../../state/tool-registry';
import { extractText } from './extract';
import { filesNote, makeFileTools } from './tools';
import { formatNumber } from '../../lib/i18n';
import { t } from './messages';
import { fetchFromWeb } from '../../state/fetch-page';
import type { Fetched } from '../../lib/fetcher/protocol';
import type { SandboxPage } from '../../lib/sandbox/client';

/** Let chat models write and read files (create_file / append_file / edit_file / read_file) */
export const fileSettings = defineFeatureSettings('files', { fileTools: true }, (old) => pickLegacy(old, { fileTools: true }));

/** Characters of an attached file put directly into the message; the rest is read with read_file */
export const ATTACH_INLINE_CHARS = 60_000;

// ---- file list ----
export const fileList = signal<FileRecord[] | null>(null);

let filesLoading: { v: number; p: Promise<void> } | null = null;
/** Reload the file list (calls for the same change share one load) */
export function refreshFiles(): Promise<void> {
  const v = filesVersion.value;
  if (filesLoading && filesLoading.v === v) return filesLoading.p;
  const p = fdb.listFiles().then((l) => {
    fileList.value = l;
  });
  filesLoading = { v, p };
  return p;
}

/** Stored images (metadata only), for the file manager */
export const imageList = signal<ImageMeta[] | null>(null);
let imagesLoading: { v: number; p: Promise<void> } | null = null;
export function refreshImages(): Promise<void> {
  const v = imagesVersion.value;
  if (imagesLoading && imagesLoading.v === v) return imagesLoading.p;
  const p = listImages().then((l) => {
    imageList.value = l;
  });
  imagesLoading = { v, p };
  return p;
}

/** Text a page's preview receives from its site at most (characters) */
const PAGE_TEXT_LIMIT = 5_000_000;

/**
 * A page's site: the nearest folder at or above it that has an index.html, else its own folder; '' for a page at
 * the top, which has none ('a/b/index.html' makes 'a/b/' a site for every page under it)
 */
export function siteOf(pagePath: string, paths: string[]): string {
  const have = new Set(paths.map(pathKey));
  for (let dir = fdb.folderOf(pagePath); dir; dir = fdb.folderOf(dir.slice(0, -1))) if (have.has(pathKey(`${dir}index.html`))) return dir;
  return fdb.folderOf(pagePath);
}

/**
 * What a page's preview may load by relative path: the texts and named images of its site, keyed by their path in
 * it ('/' in the page is the site's top). Nothing outside the site, so a page cannot read unrelated files. Texts stop
 * at PAGE_TEXT_LIMIT
 */
export async function pageOf(page: FileRecord): Promise<SandboxPage> {
  await Promise.all([fileList.value ? null : refreshFiles(), imageList.value ? null : refreshImages()]);
  const files = fileList.value ?? [];
  const images = (imageList.value ?? []).filter((im) => im.info?.name);
  const site = siteOf(page.name, [...files.map((f) => f.name), ...images.map((im) => im.info!.name)]);
  const out: Record<string, string | Blob> = {};
  if (!site) return { path: page.name, files: out };
  let chars = 0;
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (f.id === page.id || !isInside(f.name, site)) continue;
    const text = fdb.currentText(f);
    if (chars + text.length > PAGE_TEXT_LIMIT) continue;
    chars += text.length;
    out[f.name.slice(site.length)] = text;
  }
  for (const im of images) {
    if (!isInside(im.info!.name, site)) continue;
    const blob = await getImage(im.id).catch(() => null);
    if (blob) out[im.info!.name.slice(site.length)] = blob;
  }
  return { path: page.name.slice(site.length), files: out };
}

// Lists already loaded follow every change to the stored files and images (whoever made it)
effect(() => {
  void filesVersion.value;
  if (fileList.peek()) void refreshFiles();
});
effect(() => {
  void imagesVersion.value;
  if (imageList.peek()) void refreshImages();
});

export const getFile = fdb.getFile;

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
/** Only items inside this folder ('todo-app/') */
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

export function openFiler(view?: FilerView, conversationId?: string | null, folder?: string | null) {
  if (view) filerView.value = view;
  if (conversationId !== undefined) filerConversation.value = conversationId;
  if (folder !== undefined) filerFolder.value = folder;
  mainView.value = { kind: 'files' };
  sidebarTab.value = 'files';
  sidebarOpen.value = false;
  setHash('#/files');
}

/** The Files tab showing what is inside a folder */
export function openFolder(folder: string) {
  openFiler('all', null, folder);
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
  setHash(fdb.isTemporaryFile(id) ? '' : `#/f/${id}`);
}

export const fileReturnsToChat = () => returnTo.kind === 'chat';

export function closeFileView() {
  if (returnTo.kind === 'chat') showChat();
  else openFiler();
}

registerRoute({ pattern: /^#\/files$/, open: () => openFiler() });
registerRoute({
  pattern: /^#\/f\/([\w-]+)$/,
  open: async (m) => {
    if (!(await fdb.getFile(m[1]))) return;
    returnTo = { kind: 'files' };
    sidebarTab.value = 'files';
    await openFile(m[1]);
  }
});

// ---- editing by the user ----
export async function saveUserVersion(id: string, text: string) {
  const f = await fdb.getFile(id);
  if (!f) return;
  await fdb.addVersion(f, text, 'user', t('note.userEdit'));
}

/** Make an old version current again (as a new version, so nothing is lost) */
export async function restoreVersion(id: string, v: number) {
  const f = await fdb.getFile(id);
  const text = f && (await fdb.versionText(f, v));
  if (!f || text === undefined) return;
  await fdb.addVersion(f, text, 'user', t('note.restored', { v }));
}

/** Rename a file (the name may move it into other folders); false when another file or image has that path */
export async function renameFile(id: string, name: string): Promise<boolean> {
  const f = await fdb.getFile(id);
  if (!f) return false;
  const clean = fdb.cleanFileName(name, fdb.extOf(f.name) || 'md');
  return withTakenPaths(async (taken) => {
    if (!pathFree(clean, taken, id)) {
      showToast(t('rename.taken', { name: clean }), 'error');
      return false;
    }
    await fdb.putFile({ ...f, name: clean, mime: fdb.mimeFromName(clean), updatedAt: Date.now() });
    return true;
  });
}

export async function deleteFiles(ids: string[]) {
  await fdb.deleteFiles(ids);
  pendingAttachments.value = pendingAttachments.value.filter((a) => !ids.includes(a.fileId));
  const v = mainView.value;
  if (v.kind === 'file' && v.id && ids.includes(v.id)) closeFileView();
}

export function downloadFile(f: FileRecord, v: { text: string } = f.current) {
  const url = URL.createObjectURL(new Blob([v.text], { type: `${f.mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fdb.baseName(f.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** Read one file from the user's device into the Files tab, in `folder` ('' or 'a/'); returns the record, or null (after a toast) */
async function importOne(file: File, id: string, temporary: boolean, url?: string, conversationId?: string, folder = ''): Promise<FileRecord | null> {
  try {
    const ex = await extractText(file);
    const rec = await withTakenPaths(async (taken) => {
      // A name already in use gets a number: 'notes (2).md'
      const name = freePath(fdb.cleanFileName(folder + file.name, 'txt'), taken);
      const rec = fdb.newFile({ id, name, kind: 'upload', text: ex.text, by: 'upload', source: ex.source, url, conversationId });
      // A pdf's text is stored as text; keep the original extension visible but treat it as plain text
      if (rec.mime === 'application/pdf') rec.mime = 'text/plain';
      await fdb.putFile(rec, temporary);
      return rec;
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

async function importImage(file: File, id: string, source: ImageSource, conv?: Conversation, folder = ''): Promise<boolean> {
  if (!IMAGE_MIME.test(file.type)) {
    showToast(t(file.type === 'image/svg+xml' ? 'import.svg' : 'extract.unsupported', { name: file.name }), 'error');
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast(t('extract.tooBig', { max: formatNumber(MAX_IMAGE_BYTES / 1024 / 1024) }), 'error');
    return false;
  }
  await withTakenPaths(async (taken) => {
    const name = freePath(fdb.cleanFileName(folder + file.name, IMAGE_EXT[file.type]), taken);
    await putImage({ id, mime: file.type, conversationId: conv?.id, info: { name, source } }, file, !!conv?.temporary);
  });
  return true;
}


// ---- fetching from the web (through the fetch page: state/fetch-page.ts) ----
/** Keep what was fetched in the conversation's working folder (so its tools can read it): a file, or an image */
async function saveFetched(r: Fetched, conv: Conversation): Promise<{ kind: 'file'; file: FileRecord } | { kind: 'image'; name: string } | null> {
  const file = new File([r.data], r.name, { type: r.mime });
  const id = newId();
  const dir = await ensureWorkDir(conv.id, r.name);
  if (r.mime.startsWith('image/')) return (await importImage(file, id, { kind: 'web', url: r.url }, conv, dir)) ? { kind: 'image', name: file.name } : null;
  const rec = await importOne(file, id, !!conv.temporary, r.url, conv.id, dir);
  return rec ? { kind: 'file', file: rec } : null;
}

/** Upload from the file manager into the Files tab (not attached to anything): images as images, the rest as text (PDFs too) */
export async function importFromDevice(files: File[]) {
  const jobs = files.map((f) => ({ id: newId(), file: f }));
  importing.value = [...importing.value, ...jobs.map((j) => ({ id: j.id, name: j.file.name }))];
  const done = await Promise.all(
    jobs.map(async (j) => {
      const r = j.file.type.startsWith('image/') ? await importImage(j.file, j.id, { kind: 'upload' }) : !!(await importOne(j.file, j.id, false));
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
    const v = fdb.currentVersion(f);
    out.push({ fileId: f.id, name: f.name, mime: f.mime, version: v.v, text: v.text.slice(0, ATTACH_INLINE_CHARS), totalChars: v.text.length });
  }
  return out;
}

// ---- the working folder: the one folder a conversation's model reads and writes ----
/** The conversation's working folder as it is now ('todo-app/'; '' before its first file) */
export function workDirOf(convId: string): string {
  const c = conversations.value.find((x) => x.id === convId);
  return c?.workDir ? fdb.cleanFolderName(c.workDir) : '';
}

/**
 * The conversation's working folder, made now if it has none: named `name` (the model's choice), else after the
 * file that makes it (`firstFile`)
 */
async function ensureWorkDir(convId: string, firstFile: string, name = ''): Promise<string> {
  return workDirOf(convId) || withTakenPaths(async (taken) => {
    // Another call may have made it while this one waited its turn
    const made = workDirOf(convId);
    if (made) return made;
    const dir = freeFolder(fdb.cleanFolderName(name) || folderNameFor(firstFile, Date.now()), taken);
    await updateConversation({ workDir: dir }, convId);
    return dir;
  });
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
  const key = pathKey(dir + fdb.cleanFileName(ref, fdb.extOf(ref) || 'md'));
  return (await fdb.listFiles()).find((f) => pathKey(f.name) === key);
}

/** A file this conversation's model may read (in its working folder, or attached): its path and text, for other features' tools */
export async function conversationFile(conv: Conversation, history: MessageRecord[], ref: string): Promise<{ name: string; text: string } | undefined> {
  const f = await readableFile(conv.id, history, ref);
  return f && { name: relativeTo(workDirOf(conv.id), f.name), text: fdb.currentText(f) };
}

/** A path as the model sees it: relative to the working folder (whole when outside it) */
const relativeTo = (dir: string, path: string) => (dir && isInside(path, dir) ? path.slice(dir.length) : path);

function fileTools(conv: Conversation, history: MessageRecord[]) {
  const dir = () => workDirOf(conv.id);
  return makeFileTools(
    {
      async fetch(url, signal) {
        const r = await fetchFromWeb(url, 'save', signal);
        return r && (await saveFetched(r, conv));
      },
      async create(path, text, folder) {
        const d = await ensureWorkDir(conv.id, path, folder);
        return withTakenPaths(async (taken) => {
          const full = d + path;
          const key = pathKey(full);
          const same = taken.find((o) => pathKey(o.path) === key);
          // One file per path: writing to a path the folder has makes a new version of that file
          const file = same && (await fdb.getFile(same.id));
          if (file) return { file: await fdb.addVersion(file, text, 'model'), replaced: true };
          if (!pathFree(full, taken)) throw new Error(t('tool.pathTaken', { name: path }));
          const f = fdb.newFile({ id: newId(), name: full, kind: 'document', text, by: 'model', conversationId: conv.id });
          await fdb.putFile(f, !!conv.temporary);
          return { file: f, replaced: false };
        });
      },
      get: (ref) => readableFile(conv.id, history, ref),
      async update(id, text, note) {
        const f = await fdb.getFile(id);
        if (!f) throw new Error(t('tool.notFound'));
        // A file attached from outside the folder is only read: a change goes into a new file in the folder
        if (!dir() || !isInside(f.name, dir())) throw new Error(t('tool.readOnly', { name: f.name }));
        return fdb.addVersion(f, text, 'model', note);
      },
      pathOf: (f) => relativeTo(dir(), f.name)
    },
    { hasFolder: !!dir() }
  );
}

registerToolProvider({
  id: 'files',
  // Until the working folder exists only create_file and fetch_file; once a file made it (in this answer too) all
  tools: ({ conv, history }) => (fileSettings.value.value.fileTools ? fileTools(conv, history) : []),
  dynamicTools: ({ conv, history }) => (fileSettings.value.value.fileTools && workDirOf(conv.id) ? fileTools(conv, history) : []),
  systemNote({ conv }) {
    const dir = workDirOf(conv.id);
    if (!fileSettings.value.value.fileTools || !dir) return undefined;
    // The list is loaded with the conversation (below); while it loads, only the folder is named
    const files = fileList.value?.filter((f) => isInside(f.name, dir)).map((f) => ({ id: f.id, path: f.name.slice(dir.length), size: f.size })) ?? null;
    return filesNote(dir, files);
  }
});

// The system note lists the working folder's files from the file list: loaded once a conversation with one is open
effect(() => {
  if (currentConv.value.workDir && !fileList.peek()) void refreshFiles();
});

// Stored data from before working folders: the files of each conversation move into a folder of their own. Paths
// that two files share (from before paths were unique) get a number: once, and after every import of a backup
let checkedPaths = false;
registerDataLoader(async () => {
  const moved = await moveIntoWorkDirs(conversations.value);
  if (moved.length) conversations.value = conversations.value.map((c) => moved.find((m) => m.id === c.id) ?? c);
  const firstLoad = !checkedPaths;
  checkedPaths = true;
  if (firstLoad && !moved.length && (await getSetting(PATHS_CHECKED, false))) return;
  await renumberTakenPaths();
  await setSetting(PATHS_CHECKED, true);
});
const PATHS_CHECKED = 'files:pathsChecked';
