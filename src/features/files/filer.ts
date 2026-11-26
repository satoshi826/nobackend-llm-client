// The file manager's items: files and images in one list, with filtering and sorting (pure)
import { currentText, extOf } from '../../lib/db/files';
import type { BlobRecord, FileRecord } from '../../lib/db/schema';
import type { FilerSort, FilerView } from './state';
import { locale } from '../../lib/i18n';
import { t } from './messages';

export type ImageMeta = Omit<BlobRecord, 'blob' | 'enc'>;

export type FilerItem =
  | { type: 'file'; key: string; id: string; name: string; kind: FileRecord['kind']; ext: string; size: number; updatedAt: number; conversationId?: string; file: FileRecord }
  | { type: 'image'; key: string; id: string; name: string; ext: string; size: number; updatedAt: number; conversationId: string; messageId: string };

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export function toItems(files: FileRecord[], images: ImageMeta[], convTitle: (id: string) => string | undefined): FilerItem[] {
  return [
    ...files.map((f): FilerItem => ({ type: 'file', key: `f:${f.id}`, id: f.id, name: f.name, kind: f.kind, ext: f.source?.startsWith('PDF') ? 'pdf' : extOf(f.name) || 'txt', size: f.size, updatedAt: f.updatedAt, conversationId: f.conversationId, file: f })),
    ...images.map((im): FilerItem => {
      const ext = IMAGE_EXT[im.mime] ?? 'png';
      const d = new Date(im.createdAt);
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
      return { type: 'image', key: `i:${im.id}`, id: im.id, name: `${convTitle(im.conversationId) ?? t('imageName')} ${stamp}.${ext}`, ext, size: im.size, updatedAt: im.createdAt, conversationId: im.conversationId, messageId: im.messageId };
    })
  ];
}

export const RECENT_MS = 7 * 86400_000;

export function inView(it: FilerItem, view: FilerView, now = Date.now()): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'recent':
      return now - it.updatedAt < RECENT_MS;
    case 'image':
      return it.type === 'image';
    default:
      return it.type === 'file' && it.kind === view;
  }
}

// Lowercased text of each file record for search (records are replaced when they change, so the object is the key):
// typing in the search box does not lowercase every file again on each keystroke
const lowerText = new WeakMap<FileRecord, string>();
function searchText(f: FileRecord): string {
  let s = lowerText.get(f);
  if (s === undefined) lowerText.set(f, (s = currentText(f).toLowerCase()));
  return s;
}

export function filterItems(items: FilerItem[], o: { view: FilerView; conversationId: string | null; query: string }, now = Date.now()): FilerItem[] {
  const q = o.query.trim().toLowerCase();
  return items.filter(
    (it) =>
      inView(it, o.view, now) &&
      (!o.conversationId || it.conversationId === o.conversationId) &&
      (!q || it.name.toLowerCase().includes(q) || (it.type === 'file' && searchText(it.file).includes(q)))
  );
}

export function sortItems(items: FilerItem[], sort: FilerSort): FilerItem[] {
  const byName = (a: FilerItem, b: FilerItem) => a.name.localeCompare(b.name, locale());
  const cmp: Record<FilerSort, (a: FilerItem, b: FilerItem) => number> = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    name: byName,
    type: (a, b) => a.ext.localeCompare(b.ext) || byName(a, b),
    // Images are measured in bytes and files in characters: compare files with files and images with images
    size: (a, b) => (a.type === b.type ? b.size - a.size : a.type === 'file' ? -1 : 1)
  };
  return [...items].sort(cmp[sort]);
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
  if (ext === 'md' || ext === 'markdown') t = t.replace(/^#{1,6}\s+/gm, '').replace(/[*_`>]/g, '');
  return t.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n').slice(0, max);
}
