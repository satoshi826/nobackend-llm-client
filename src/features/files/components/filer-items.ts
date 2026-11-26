// What the file manager and the sidebar's Files panel share. Kept out of Filer.tsx so the sidebar does not
// pull the file manager into the first load (the file manager is loaded when first opened).
import { useEffect, useMemo } from 'preact/hooks';
import { conversations } from '../../../state/conversations';
import { imagesVersion } from '../../images';
import { toItems, type FilerItem } from '../filer';
import { fileList, filesVersion, imageList, refreshFiles, refreshImages, type FilerView } from '../state';
import { getLang } from '../../../lib/i18n';
import type { IconName } from '../../../components/ui';
import { t } from '../messages';

const VIEW_KEYS = { all: 'view.all', text: 'view.text', image: 'view.image', document: 'view.document', upload: 'view.upload' } as const;
export const viewLabel = (v: FilerView) => t(VIEW_KEYS[v]);
/** One icon per kind, wherever kinds appear (filters, cards, the list, a file's header) */
export const VIEW_ICONS: Record<FilerView, IconName> = { all: 'files', text: 'file', image: 'image', document: 'sparkle', upload: 'upload' };

export const convTitle = (id?: string) => (id ? conversations.value.find((c) => c.id === id)?.title : undefined);

/** Files and images (shared by the file manager and the sidebar's counts) */
export function useFilerItems(): FilerItem[] | null {
  useEffect(() => {
    void refreshFiles();
  }, [filesVersion.value]);
  useEffect(() => {
    void refreshImages();
  }, [imagesVersion.value]);
  const files = fileList.value;
  const images = imageList.value;
  return useMemo(() => (files && images ? toItems(files, images, convTitle) : null), [files, images, conversations.value, getLang()]);
}
