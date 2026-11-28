// Pages: their site, the files it gives them, and their localStorage
import { effect } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import { atPath, withTakenPaths, type FileEntry } from '../../../lib/db/catalog';
import { folderOf, isInside, pathFree, pathKey } from '../../../lib/paths';
import { newId } from '../../../lib/db/repo';
import { showToast } from '../../../state/ui';
import { t } from '../messages';
import { cleanStorage, type SandboxPage } from '../../../lib/sandbox/client';
import { PAGE_API } from '../../../lib/fetcher/config';
import { pageApi } from './page-api';
import { fileList } from './lists';

/** Text a page's preview receives from its site at most (characters) */
const PAGE_TEXT_LIMIT = 5_000_000;

/** Every path in use, for working out sites */
const allPaths = () => (fileList.value ?? []).map((f) => f.path);

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

/**
 * Files the shown pages wrote themselves (their localStorage, and nbl.files with the experimental page api), by path
 * key: such a write does not load the page again (siteSignature)
 */
interface OwnWrites {
  /** The updatedAt of each of the pages' writes: a different one is someone else's change */
  stamps: Set<number>;
  /** The file's updatedAt before the pages' writes since someone else's last change; null for a file a page made */
  before: number | null;
}
const ownWrites = new Map<string, OwnWrites>();
const ownWrite = (path: string, f: FileEntry) => {
  const w = ownWrites.get(pathKey(path));
  return w?.stamps.has(f.updatedAt) ? w : undefined;
};

/** The items each storage file's pages saved last, by path key (a page shown again starts from them) */
const storageItems = new Map<string, Record<string, string> | null>();

/**
 * Write a text file of a site as its pages do (made when missing, keeping no previous text). false when the path is
 * taken by a file that is not text, or by a folder
 */
export async function writeAsPage(path: string, text: string, page: FileEntry): Promise<boolean> {
  return withTakenPaths(async (space) => {
    const at = atPath(path);
    const k = pathKey(path);
    const w = ownWrites.get(k) ?? { stamps: new Set<number>(), before: null };
    if (at?.kind === 'text') {
      if (!w.stamps.has(at.updatedAt)) w.before = at.updatedAt;
      // Known as its own before the change is heard of, so the page showing it is not loaded again
      const now = Date.now();
      w.stamps.add(now);
      ownWrites.set(k, w);
      await fdb.setText(at.id, text, 'user', true, now);
      return true;
    }
    if (at || !pathFree(path, space)) return false;
    const f = fdb.newFile({ id: newId(), path, origin: { kind: 'made' }, text, by: 'user', conversationId: page.conversationId });
    w.before = null;
    w.stamps.add(f.updatedAt);
    ownWrites.set(k, w);
    await fdb.createFile(f, text, fdb.isTemporaryFile(page.id));
    return true;
  });
}

/** A storage file's items; anything else than an object of strings (a broken edit, say) counts as empty */
function parseStorage(text: string): Record<string, string> {
  try {
    return cleanStorage(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

/**
 * What a page's preview may load by relative path: the files of its site, keyed by their path in it ('/' in the page
 * is the site's top), texts as text and the rest as bytes, and its localStorage. Nothing outside the site, so a page
 * cannot read unrelated files; with `within` (a model trying a page), nothing outside that folder either. Texts stop
 * at PAGE_TEXT_LIMIT
 */
export async function pageOf(page: FileEntry, within?: string): Promise<SandboxPage> {
  const files = await fdb.listFiles();
  const site = siteOf(page.path, files.map((f) => f.path));
  const out: Record<string, string | Blob> = {};
  if (!site) return { path: page.path, files: out };
  const inSite = files.filter((f) => f.id !== page.id && isInside(f.path, site) && (within === undefined || isInside(f.path, within))).sort((a, b) => a.path.localeCompare(b.path));
  const texts = await fdb.readTexts(inSite.filter((f) => f.kind === 'text').map((f) => f.id));
  let chars = 0;
  for (const f of inSite) {
    if (f.kind !== 'text') {
      const blob = await fdb.readBytes(f.id).catch(() => null);
      if (blob) out[f.path.slice(site.length)] = blob;
      continue;
    }
    const text = texts.get(f.id) ?? '';
    if (chars + text.length > PAGE_TEXT_LIMIT) continue;
    chars += text.length;
    out[f.path.slice(site.length)] = text;
  }
  const storagePath = `${site}${STORAGE_FILE}`;
  const storageKey = pathKey(storagePath);
  const stored = files.find((f) => pathKey(f.path) === storageKey);
  const first = storageItems.get(storageKey) ?? (stored ? parseStorage(await fdb.readText(stored.id)) : {});
  return {
    path: page.path.slice(site.length),
    files: out,
    storage: {
      // What it saved last, so showing the page again (or over the whole window) starts from its latest data
      items: () => storageItems.get(storageKey) ?? first,
      save: (items) => void saveStorage(storagePath, items, page)
    },
    // Only for a page the user shows, never one a model tries
    ...(PAGE_API && within === undefined ? { api: pageApi(page, site, (path, text) => writeAsPage(path, text, page)) } : {})
  };
}

/** Keep a page's localStorage in its site's storage file (made on the first write) */
async function saveStorage(path: string, items: Record<string, string>, page: FileEntry) {
  storageItems.set(pathKey(path), items);
  const text = JSON.stringify(items);
  // Escapes can make the JSON longer than the items: what a file cannot hold is not saved (and said so)
  if (text.length > fdb.MAX_FILE_CHARS) return showToast(t('storage.tooBig'), 'error');
  try {
    await writeAsPage(path, text, page);
  } catch (e) {
    showToast(t('storage.failed', { message: (e as Error).message }), 'error');
  }
}

/**
 * What a page's preview depends on, as a short text: the site's files as they are now. A file the pages wrote
 * themselves counts as it was before (one they made, not at all), so their own writes never reload them. The preview
 * loads again when this changes
 */
export function siteSignature(page: FileEntry): string {
  const files = fileList.value ?? [];
  const site = siteOf(page.path, allPaths());
  if (!site) return '';
  const parts: string[] = [site];
  for (const f of files) {
    if (!isInside(f.path, site)) continue;
    const own = ownWrite(f.path, f);
    if (!own) parts.push(`${f.id}:${f.path}:${f.updatedAt}`);
    else if (own.before !== null) parts.push(`${f.id}:${f.path}:${own.before}`);
  }
  return parts.sort().join('|');
}

/** Someone else changed a storage file: pages start from it again, not from what they saved last */
effect(() => {
  for (const f of fileList.value ?? []) {
    const k = pathKey(f.path);
    if (storageItems.get(k) && !ownWrite(f.path, f)) storageItems.set(k, null);
  }
});
// A deleted storage file: what the pages saved is gone too
effect(() => {
  const names = new Set((fileList.value ?? []).map((f) => pathKey(f.path)));
  for (const k of storageItems.keys()) if (!names.has(k)) storageItems.set(k, null);
});
