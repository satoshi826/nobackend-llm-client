// The file manager's items: files and images in one list, with filtering and sorting (pure)
import { extOf, isInside } from '../../lib/paths';
import type { FileRecord, Origin } from '../../lib/db/schema';
import type { ImageEntry } from '../../lib/db/catalog';
import type { FilerOrder, FilerSort, FilerView } from './state';
import { locale } from '../../lib/i18n';
import { t } from './messages';

/** Made in a chat ('document'), or brought in by the user ('upload': from the device or the web) */
export type ItemKind = 'document' | 'upload';
const kindOf = (o: Origin): ItemKind => (o.kind === 'made' ? 'document' : 'upload');

export type FilerItem =
  | { type: 'file'; key: string; id: string; name: string; kind: ItemKind; ext: string; size: number; updatedAt: number; conversationId?: string; file: FileRecord }
  | { type: 'image'; key: string; id: string; name: string; kind: ItemKind; ext: string; size: number; updatedAt: number; conversationId?: string; messageId?: string; origin: Origin; video: boolean };

/** Stored images and videos (videos are kept with the images) */
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

export function toItems(files: FileRecord[], images: ImageEntry[], convTitle: (id: string) => string | undefined): FilerItem[] {
  return [
    ...files.map((f): FilerItem => ({ type: 'file', key: `f:${f.id}`, id: f.id, name: f.name, kind: kindOf(f.origin), ext: f.fromPdf ? 'pdf' : extOf(f.name) || 'txt', size: f.size, updatedAt: f.updatedAt, conversationId: f.conversationId, file: f })),
    ...images.map((im): FilerItem => {
      const ext = IMAGE_EXT[im.mime] ?? 'png';
      const d = new Date(im.createdAt);
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
      const video = im.mime.startsWith('video/');
      // A made image has no path: its shown name is not one either, so a '/' in the chat's title makes no folder
      const name = im.path ?? `${((im.conversationId && convTitle(im.conversationId)) || t(video ? 'videoName' : 'imageName')).replace(/\//g, '／')} ${stamp}.${ext}`;
      return { type: 'image', key: `i:${im.id}`, id: im.id, name, kind: kindOf(im.origin), ext, size: im.size, updatedAt: im.createdAt, conversationId: im.conversationId, messageId: im.messageId, origin: im.origin, video };
    })
  ];
}

export function inView(it: FilerItem, view: FilerView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'text':
      return it.type === 'file';
    case 'image':
      return it.type === 'image';
    default:
      return it.kind === view;
  }
}

/**
 * direct: only the items right inside the folder (browsing it), not those in its folders. A query matches names and
 * the start of texts at once, and the whole texts of the files in `contentHits` (searched apart: texts are not in lists)
 */
export function filterItems(
  items: FilerItem[],
  o: { view: FilerView; conversationId: string | null; folder?: string | null; direct?: boolean; query: string; contentHits?: Set<string> | null }
): FilerItem[] {
  const q = o.query.trim().toLowerCase();
  return items.filter(
    (it) =>
      inView(it, o.view) &&
      (!o.conversationId || it.conversationId === o.conversationId) &&
      (o.direct ? directlyIn(it, o.folder ?? '') : !o.folder || isInside(it.name, o.folder)) &&
      (!q || it.name.toLowerCase().includes(q) || (it.type === 'file' && (it.file.preview.toLowerCase().includes(q) || !!o.contentHits?.has(it.id))))
  );
}

/** The direction a sort starts in: newest and largest first, names and types from A */
export const NATURAL_ORDER: Record<FilerSort, FilerOrder> = { updated: 'desc', name: 'asc', type: 'asc', size: 'desc' };

export function sortItems(items: FilerItem[], sort: FilerSort, order: FilerOrder = NATURAL_ORDER[sort]): FilerItem[] {
  const dir = order === 'asc' ? 1 : -1;
  const byName = (a: FilerItem, b: FilerItem) => a.name.localeCompare(b.name, locale());
  const cmp: Record<FilerSort, (a: FilerItem, b: FilerItem) => number> = {
    updated: (a, b) => dir * (a.updatedAt - b.updatedAt),
    name: (a, b) => dir * byName(a, b),
    type: (a, b) => dir * (a.ext.localeCompare(b.ext) || byName(a, b)),
    // Images are measured in bytes and files in characters: files come first, each group in the chosen direction
    size: (a, b) => (a.type === b.type ? dir * (a.size - b.size) : a.type === 'file' ? -1 : 1)
  };
  return [...items].sort(cmp[sort]);
}

/** A folder as the file manager shows it: its path ('a/b/'), its name ('b'), what is inside it and when it last changed */
export interface FolderItem {
  path: string;
  name: string;
  count: number;
  updatedAt: number;
}

/** The folders right inside `folder` ('' is the top) that hold items, by their paths (case folded into one) */
export function foldersIn(items: FilerItem[], folder: string): FolderItem[] {
  const m = new Map<string, FolderItem>();
  for (const it of items) {
    if (!isInside(it.name, folder)) continue;
    const rest = it.name.slice(folder.length);
    const slash = rest.indexOf('/');
    if (slash < 0) continue;
    const path = folder + rest.slice(0, slash + 1);
    const g = m.get(path.toLowerCase()) ?? { path, name: rest.slice(0, slash), count: 0, updatedAt: 0 };
    g.count++;
    g.updatedAt = Math.max(g.updatedAt, it.updatedAt);
    m.set(path.toLowerCase(), g);
  }
  return [...m.values()];
}

/** Every folder that holds items, at any depth, in path order */
export function allFolders(items: FilerItem[]): string[] {
  const m = new Map<string, string>();
  for (const it of items) for (let i = it.name.indexOf('/'); i >= 0; i = it.name.indexOf('/', i + 1)) {
    const path = it.name.slice(0, i + 1);
    if (!m.has(path.toLowerCase())) m.set(path.toLowerCase(), path);
  }
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}

/** Items right inside `folder` ('' is the top), not in a folder below it */
export const directlyIn = (it: FilerItem, folder: string) => isInside(it.name, folder) && !it.name.slice(folder.length).includes('/');

/** Top folders that have items ('todo-app/'), most recent first */
export function foldersWithItems(items: FilerItem[]): { folder: string; count: number; latest: number }[] {
  const m = new Map<string, { folder: string; count: number; latest: number }>();
  for (const it of items) {
    const slash = it.name.indexOf('/');
    if (slash < 0) continue;
    const folder = it.name.slice(0, slash + 1);
    // One entry per folder whatever the case of its name (paths compare with case folded)
    const g = m.get(folder.toLowerCase()) ?? { folder, count: 0, latest: 0 };
    g.count++;
    g.latest = Math.max(g.latest, it.updatedAt);
    m.set(folder.toLowerCase(), g);
  }
  return [...m.values()].sort((a, b) => b.latest - a.latest);
}

/** Conversations that have items, most recent first */
export function conversationsWithItems(items: FilerItem[]): { id: string; count: number; latest: number }[] {
  const m = new Map<string, { count: number; latest: number }>();
  for (const it of items) {
    if (!it.conversationId) continue;
    const g = m.get(it.conversationId) ?? { count: 0, latest: 0 };
    g.count++;
    g.latest = Math.max(g.latest, it.updatedAt);
    m.set(it.conversationId, g);
  }
  return [...m].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.latest - a.latest);
}

/** The first lines of a text file, for a card preview */
export function previewText(text: string, ext: string, max = 280): string {
  let t = text.slice(0, max * 2);
  if (ext === 'md' || ext === 'markdown') t = t.replace(/^#{1,6}\s+/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/[*_`>]/g, '');
  return t.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n').slice(0, max);
}
