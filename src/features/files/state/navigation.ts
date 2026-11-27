// The file manager (#/files) and a file's or an image's page (#/f/<id>, #/i/<id>) in the main area
import {  signal } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import {  catalogImage, ensureCatalog, isTemporary } from '../../../lib/db/catalog';
import {  cleanFolderName, folderOf } from '../../../lib/paths';
import { getSetting, setSetting } from '../../../lib/db/repo';
import {  showChat } from '../../../state/conversations';
import { mainView, sidebarOpen, sidebarTab, type MainViewState } from '../../../state/ui';
import { pushHash, registerRoute, setHash } from '../../../state/router';
import { imageList } from './lists';

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

/**
 * The sidebar's Files tab chosen: the file manager as it was left. The sidebar stays open (on a phone it is a drawer),
 * as it does when the chats tab is chosen: picking a tab is not picking a place yet
 */
export function selectFilesTab() {
  mainView.value = { kind: 'files' };
  sidebarTab.value = 'files';
  pushHash(filerHash());
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

/** Where "back" goes from a file's or an image's page: the screen it was opened from */
let returnTo: MainViewState = { kind: 'files' };
const PAGES = ['file', 'image'];

export async function openFile(id: string) {
  const cur = mainView.value;
  if (!PAGES.includes(cur.kind)) returnTo = cur.kind === 'chat' ? { kind: 'chat' } : { kind: 'files' };
  mainView.value = { kind: 'file', id };
  sidebarOpen.value = false;
  // Its own place in the history, so Back leads to the folder it was opened from
  if (fdb.isTemporaryFile(id)) setHash('');
  else pushHash(`#/f/${id}`);
}

export const fileReturnsToChat = () => returnTo.kind === 'chat';

/** The images an image's page steps through (as the list it was opened from showed them); empty: the images of its folder */
export const imageSiblings = signal<string[]>([]);

/**
 * The images an image's page steps through: those it was opened with that are still there, else the images of its
 * folder (newest first, as listed)
 */
export function imagesToStep(id: string): string[] {
  const images = imageList.value ?? [];
  const listed = imageSiblings.value.filter((s) => images.some((x) => x.id === s));
  if (listed.length) return listed;
  const own = images.find((x) => x.id === id);
  return own ? images.filter((x) => folderOf(x.path) === folderOf(own.path)).map((x) => x.id) : [];
}

/** Show an image or a video on its own page, from the Files tab (siblings: the images listed with it, in order) */
export function openImage(id: string, siblings: string[] = []) {
  const cur = mainView.value;
  if (!PAGES.includes(cur.kind)) returnTo = cur.kind === 'chat' ? { kind: 'chat' } : { kind: 'files' };
  const stepping = cur.kind === 'image';
  imageSiblings.value = siblings;
  mainView.value = { kind: 'image', id };
  sidebarOpen.value = false;
  // Its own place in the history, so Back leads to the folder it was opened from (one of a temporary chat has none);
  // stepping to the next image takes the same place, so Back does not walk through every image seen
  if (isTemporary(id)) setHash('');
  else if (stepping) setHash(`#/i/${id}`);
  else pushHash(`#/i/${id}`);
}

registerRoute({
  pattern: /^#\/i\/([\w-]+)$/,
  open: async (m) => {
    await ensureCatalog();
    if (!catalogImage(m[1])) return;
    returnTo = { kind: 'files' };
    imageSiblings.value = [];
    sidebarTab.value = 'files';
    mainView.value = { kind: 'image', id: m[1] };
    sidebarOpen.value = false;
    setHash(m[0]);
  }
});

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
