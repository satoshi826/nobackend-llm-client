// Pages: their site, the files it gives them, and their localStorage
import { effect } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import { atPath, withTakenPaths } from '../../../lib/db/catalog';
import {  folderOf, isInside, pathFree, pathKey } from '../../../lib/paths';
import {  newId } from '../../../lib/db/repo';
import { getImage, listImages } from '../../../lib/db/images';
import type {  FileRecord } from '../../../lib/db/schema';
import {  showToast } from '../../../state/ui';
import { t } from '../messages';
import { cleanStorage, type SandboxPage } from '../../../lib/sandbox/client';
import { fileList, imageList } from './lists';

/** Text a page's preview receives from its site at most (characters) */
const PAGE_TEXT_LIMIT = 5_000_000;

/** Every path in use (files and images), for working out sites */
const allPaths = () => [...(fileList.value ?? []).map((f) => f.name), ...(imageList.value ?? []).map((im) => im.path)];

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
  const site = siteOf(page.name, [...files.map((f) => f.name), ...images.map((im) => im.path)]);
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
    if (!allowed(im.path)) continue;
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
  for (const im of imageList.value ?? []) if (isInside(im.path, site)) parts.push(`${im.id}:${im.path}`);
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
