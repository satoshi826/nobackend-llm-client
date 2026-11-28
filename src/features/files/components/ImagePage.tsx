// An image or a video on its own page in the Files tab: the same header as its folder, then the viewer every image
// opens in (components/media), with the chat it was made in beside its name, stepping through the images listed with it
import { folderOf } from '../../../lib/paths';
import { Button, Icon, Spinner } from '../../../components/ui';
import { MediaViewer } from '../../../components/media/Viewer';
import type { MediaItem } from '../../../state/media';
import { closeFileView, fileReturnsToChat, imagesToStep, openFolder, openImage } from '../state';
import { useFilerItems } from '../filer/use-items';
import { FolderCrumbs, SourceChat } from './common';
import { FilesHeader } from './FilesHeader';
import { t } from '../messages';

export function ImagePage({ id = '' }: { id?: string }) {
  const all = useFilerItems();
  const it = all?.find((x): x is Extract<typeof x, { type: 'image' }> => x.type === 'image' && x.id === id);
  const siblings = imagesToStep(id);
  const at = Math.max(0, siblings.indexOf(id));

  if (!all)
    return (
      <main class="grid flex-1 place-items-center text-sm text-muted">
        <Spinner class="size-5" />
      </main>
    );
  if (!it)
    return (
      <main class="grid flex-1 place-items-center text-sm text-muted">
        <div class="text-center">
          <p>{t('image.notFound')}</p>
          <Button class="mt-3" variant="outline" onClick={closeFileView}>
            <Icon name="chevron-left" />
            {t('file.back')}
          </Button>
        </div>
      </main>
    );
  const folder = folderOf(it.name);
  const item: MediaItem = { fileId: it.id, conversationId: it.conversationId, messageId: it.messageId, name: it.name, video: it.video };
  return (
    <main class="flex min-w-0 flex-1 flex-col">
      <FilesHeader
        title={
          <div class="flex min-w-0 flex-1 items-center px-1">
            <FolderCrumbs folder={folder} />
          </div>
        }
        searchIn={folder}
        onSearch={() => openFolder(folder || null)}
      />
      <div class="flex min-h-0 flex-1 flex-col pt-1 md:pr-3">
        <MediaViewer
          item={item}
          at={{ index: at, total: Math.max(1, siblings.length) }}
          step={(d) => siblings.length > 1 && openImage(siblings[(at + d + siblings.length) % siblings.length], siblings)}
          // Back to where it was opened from: the chat, or the Files tab
          close={closeFileView}
          closeLabel={fileReturnsToChat() ? t('file.backToChat') : t('file.close')}
          deleted={() => {
            const rest = siblings.filter((s) => s !== id);
            if (rest.length) openImage(rest[Math.min(at, rest.length - 1)], rest);
            else closeFileView();
          }}
          aside={<SourceChat conversationId={it.conversationId} />}
        />
      </div>
    </main>
  );
}
