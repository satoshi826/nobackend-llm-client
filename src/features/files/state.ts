// Files feature: state and actions (Files tab, attachments in the input box, file tools for the model).
// Depends on core state; core state never imports this module (it registers itself through extension points).
import { signal } from '@preact/signals';
import * as fdb from '../../lib/db/files';
import { getSetting, newId, setSetting } from '../../lib/db/repo';
import { listImages, putImage } from '../../lib/db/images';
import type { Attachment, Conversation, FileRecord, ImageSource, MessageRecord } from '../../lib/db/schema';
import type { ImageMeta } from './filer';
import { imagesVersion } from '../images';
import { showChat } from '../../state/conversations';
import { defineFeatureSettings, pickLegacy } from '../../state/feature-settings';
import { mainView, showToast, sidebarOpen, sidebarTab, type MainViewState } from '../../state/ui';
import { registerRoute, setHash } from '../../state/router';
import { registerToolProvider } from '../../state/tool-registry';
import { extractText } from './extract';
import { FILE_TOOL_NAMES, filesNote, makeFileTools, type FileToolDetails } from './tools';
import { formatNumber } from '../../lib/i18n';
import { t } from './messages';
import { fetchFromWeb, type Fetched } from '../../state/fetch-page';

/** Let chat models write and read files (create_file / append_file / edit_file / read_file) */
export const fileSettings = defineFeatureSettings('files', { fileTools: true }, (old) => pickLegacy(old, { fileTools: true }));

/** Characters of an attached file put directly into the message; the rest is read with read_file */
export const ATTACH_INLINE_CHARS = 60_000;

// ---- file list ----
/** Bumped on every change, so open views reload */
export const filesVersion = signal(0);
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

function changed() {
  filesVersion.value++;
  if (fileList.value) void refreshFiles();
}

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

export function openFiler(view?: FilerView, conversationId?: string | null) {
  if (view) filerView.value = view;
  if (conversationId !== undefined) filerConversation.value = conversationId;
  mainView.value = { kind: 'files' };
  sidebarTab.value = 'files';
  sidebarOpen.value = false;
  setHash('#/files');
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
  changed();
}

/** Make an old version current again (as a new version, so nothing is lost) */
export async function restoreVersion(id: string, v: number) {
  const f = await fdb.getFile(id);
  const text = f && (await fdb.versionText(f, v));
  if (!f || text === undefined) return;
  await fdb.addVersion(f, text, 'user', t('note.restored', { v }));
  changed();
}

export async function renameFile(id: string, name: string) {
  const f = await fdb.getFile(id);
  if (!f) return;
  const clean = fdb.cleanFileName(name, fdb.extOf(f.name) || 'md');
  await fdb.putFile({ ...f, name: clean, mime: fdb.mimeFromName(clean), updatedAt: Date.now() });
  changed();
}

export async function deleteFiles(ids: string[]) {
  await fdb.deleteFiles(ids);
  pendingAttachments.value = pendingAttachments.value.filter((a) => !ids.includes(a.fileId));
  const v = mainView.value;
  if (v.kind === 'file' && v.id && ids.includes(v.id)) closeFileView();
  changed();
}

export function downloadFile(f: FileRecord, v: { text: string } = f.current) {
  const url = URL.createObjectURL(new Blob([v.text], { type: `${f.mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
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

/** Read one file from the user's device into the Files tab; returns the record, or null (after a toast) */
async function importOne(file: File, id: string, temporary: boolean, url?: string, conversationId?: string): Promise<FileRecord | null> {
  try {
    const ex = await extractText(file);
    const rec = fdb.newFile({ id, name: fdb.cleanFileName(file.name, 'txt'), kind: 'upload', text: ex.text, by: 'upload', source: ex.source, url, conversationId });
    // A pdf's text is stored as text; keep the original extension visible but treat it as plain text
    if (rec.mime === 'application/pdf') rec.mime = 'text/plain';
    await fdb.putFile(rec, temporary);
    if (ex.truncated) showToast(t('import.truncated', { name: file.name, n: formatNumber(fdb.MAX_FILE_CHARS) }), 'error');
    changed();
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

async function importImage(file: File, id: string, source: ImageSource, conv?: Conversation): Promise<boolean> {
  if (!IMAGE_MIME.test(file.type)) {
    showToast(t(file.type === 'image/svg+xml' ? 'import.svg' : 'extract.unsupported', { name: file.name }), 'error');
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast(t('extract.tooBig', { max: formatNumber(MAX_IMAGE_BYTES / 1024 / 1024) }), 'error');
    return false;
  }
  await putImage({ id, mime: file.type, conversationId: conv?.id, info: { name: fdb.cleanFileName(file.name, IMAGE_EXT[file.type]), source } }, file, !!conv?.temporary);
  imagesVersion.value++;
  return true;
}

/**
 * Bring files into the Files tab (not attached to anything): images are kept as images, everything else as
 * text (PDFs too). source: where they came from (the device, or a web address)
 */
export async function bringIn(files: File[], source: ImageSource = { kind: 'upload' }): Promise<number> {
  const jobs = files.map((f) => ({ id: newId(), file: f }));
  importing.value = [...importing.value, ...jobs.map((j) => ({ id: j.id, name: j.file.name }))];
  const done = await Promise.all(
    jobs.map(async (j) => {
      const r = j.file.type.startsWith('image/') ? await importImage(j.file, j.id, source) : !!(await importOne(j.file, j.id, false, source.kind === 'web' ? source.url : undefined));
      importing.value = importing.value.filter((x) => x.id !== j.id);
      return r;
    })
  );
  return done.filter(Boolean).length;
}

// ---- fetching from the web (through the fetch page: state/fetch-page.ts) ----
/** What a fetch became: a file the model can read, or an image */
export type SavedFetch = { kind: 'file'; file: FileRecord } | { kind: 'image'; id: string; name: string };

/** Keep what was fetched in the Files tab (in a chat: as part of that chat, so its tools can read it) */
export async function saveFetched(r: Fetched, conv?: Conversation): Promise<SavedFetch | null> {
  const file = new File([r.data], r.name, { type: r.mime });
  const id = newId();
  if (r.mime.startsWith('image/')) return (await importImage(file, id, { kind: 'web', url: r.url }, conv)) ? { kind: 'image', id, name: file.name } : null;
  const rec = await importOne(file, id, !!conv?.temporary, r.url, conv?.id);
  return rec ? { kind: 'file', file: rec } : null;
}

/** Upload from the file manager */
export async function importFromDevice(files: File[]) {
  const n = await bringIn(files);
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

// ---- tools for the model ----
/** Files the model may use in a conversation: attached to it, or created / changed by file tools in it */
/** A file this conversation may read (made, fetched or attached in it): its name and current text, for other features' tools */
export async function conversationFile(conv: Conversation, history: MessageRecord[], id: string): Promise<{ name: string; text: string } | undefined> {
  const f = await fdb.getFile(id);
  if (!f || (f.conversationId !== conv.id && !filesInHistory(history).has(id))) return undefined;
  return { name: f.name, text: fdb.currentText(f) };
}

export function filesInHistory(history: MessageRecord[]): Map<string, { name: string; size: number }> {
  const out = new Map<string, { name: string; size: number }>();
  for (const m of history) {
    for (const a of m.attachments ?? []) out.set(a.fileId, { name: a.name, size: a.totalChars });
    for (const p of m.parts) {
      if (p.type !== 'tool' || !FILE_TOOL_NAMES.includes(p.name)) continue;
      const d = p.uiDetails as FileToolDetails | undefined;
      if (d?.fileId) out.set(d.fileId, { name: d.name, size: d.chars });
    }
  }
  return out;
}

registerToolProvider({
  id: 'files',
  tools({ conv, history }) {
    if (!fileSettings.value.value.fileTools) return [];
    const scope = new Set(filesInHistory(history).keys());
    return makeFileTools({
      async fetch(url, signal) {
        const r = await fetchFromWeb(url, 'save', signal);
        const saved = r && (await saveFetched(r, conv));
        if (saved?.kind === 'file') {
          scope.add(saved.file.id);
          changed();
        }
        return saved;
      },
      async create(name, text) {
        const f = fdb.newFile({ id: newId(), name, kind: 'document', text, by: 'model', conversationId: conv.id });
        await fdb.putFile(f, !!conv.temporary);
        scope.add(f.id);
        changed();
        return f;
      },
      get: async (id) => (scope.has(id) ? fdb.getFile(id) : undefined),
      async update(id, text, note) {
        const f = await fdb.getFile(id);
        if (!f || !scope.has(id)) throw new Error(t('tool.notFound'));
        const next = await fdb.addVersion(f, text, 'model', note);
        changed();
        return next;
      }
    });
  },
  systemNote({ history }) {
    if (!fileSettings.value.value.fileTools) return undefined;
    return filesNote([...filesInHistory(history)].map(([id, f]) => ({ id, ...f })));
  }
});
