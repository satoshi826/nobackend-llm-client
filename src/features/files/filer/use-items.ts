// What the file manager and the sidebar's Files panel share. Kept out of Filer.tsx so the sidebar does not
// pull the file manager into the first load (the file manager is loaded when first opened).
import { useEffect, useMemo } from 'preact/hooks';
import { conversationTitles } from '../../../state/conversations';
import { toItems, type FilerItem } from './items';
import { fileList, refreshFiles, type FilerView } from '../state';
import type { IconName } from '../../../components/ui';
import { t } from '../messages';

const VIEW_KEYS = { all: 'view.all', text: 'view.text', image: 'view.image', document: 'view.document', upload: 'view.upload' } as const;
export const viewLabel = (v: FilerView) => t(VIEW_KEYS[v]);
/** One icon per kind, wherever kinds appear (filters, cards, the list, a file's header) */
export const VIEW_ICONS: Record<FilerView, IconName> = { all: 'files', text: 'file', image: 'image', document: 'sparkle', upload: 'upload' };

/** A conversation's title (undefined for one that is gone); a component reading it draws again only when a title changes */
export const convTitle = (id?: string) => (id ? conversationTitles.value.get(id) : undefined);

/** Every file (shared by the file manager and the sidebar's counts); loaded on first use, then kept up to date by state/lists */
export function useFilerItems(): FilerItem[] | null {
  useEffect(() => {
    if (!fileList.peek()) void refreshFiles();
  }, []);
  const files = fileList.value;
  return useMemo(() => (files ? toItems(files) : null), [files]);
}
