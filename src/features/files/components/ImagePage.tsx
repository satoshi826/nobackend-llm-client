// An image or a video on its own page in the Files tab: the same header as its folder, its tools in the bar under it,
// and a way to the images listed with it
import { useEffect, useState } from 'preact/hooks';
import { folderOf } from '../../../lib/paths';
import { Button, Icon, IconButton, Spinner, TextField } from '../../../components/ui';
import { useImageViewer, ViewerStage, type LightboxItem, type ViewerTool } from '../../images';
import { closeFileView, fileReturnsToChat, imagesToStep, openFolder, openImage } from '../state';
import { useFilerItems } from './filer-items';
import { ActionMenu, FolderCrumbs, SourceChat, SubBar, type MenuAction } from './common';
import { FilesHeader } from './FilesHeader';
import { t } from '../messages';

export function ImagePage({ id = '' }: { id?: string }) {
  const all = useFilerItems();
  const it = all?.find((x): x is Extract<typeof x, { type: 'image' }> => x.type === 'image' && x.id === id);
  const siblings = imagesToStep(id);
  const at = siblings.indexOf(id);
  const go = (d: number) => siblings.length > 1 && openImage(siblings[(at + d + siblings.length) % siblings.length], siblings);
  const item: LightboxItem | undefined = it && { blobId: it.id, conversationId: it.conversationId, messageId: it.messageId, name: it.name, video: it.video };
  const viewer = useImageViewer(item, {
    leave: () => {},
    deleted: () => {
      const rest = siblings.filter((s) => s !== id);
      if (rest.length) openImage(rest[Math.min(at, rest.length - 1)], rest);
      else closeFileView();
    },
    // Its chat is a link beside its name, not one of its tools
    fromGallery: false
  });
  const [prompt, setPrompt] = useState('');
  useEffect(() => setPrompt(''), [id]);
  // Arrow keys step through the images (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
      <SubBar
        start={
          <>
            {/* The same order as on a file's page: edit (what makes a new image from this one), download, delete, the rest in the menu */}
            {/* The pencil, as Edit on a file's page; editing by instructions (the wand) comes first in it */}
            <ActionMenu
              start
              icon="edit"
              text={t('image.edit')}
              pressed={viewer.editing}
              actions={[...viewer.tools.filter((x) => x.id === 'edit'), ...viewer.tools.filter((x) => x.makesNew && x.id !== 'edit')].filter(usable).map(asAction)}
            />
            {viewer.tools
              .filter((x) => x.id === 'download')
              .map((x) => (
                <IconButton key={x.id} label={x.label} onClick={x.run}>
                  <Icon name={x.icon} />
                </IconButton>
              ))}
            {viewer.tools
              .filter((x) => x.id === 'delete')
              .map((x) => (
                <IconButton key={x.id} variant="remove" label={x.label} onClick={x.run}>
                  <Icon name={x.icon} />
                </IconButton>
              ))}
            <ActionMenu start actions={viewer.tools.filter((x) => !x.makesNew && !['open-chat', 'download', 'delete'].includes(x.id)).filter(usable).map(asAction)} />
          </>
        }
        center={
          <>
            <Icon name={it.video ? 'video' : 'image'} class="size-4 shrink-0 text-muted" />
            <span class="truncate text-sm font-medium text-ink-strong">{it.name.slice(folder.length)}</span>
            <SourceChat conversationId={it.conversationId} />
            {siblings.length > 1 && at >= 0 && (
              <span class="shrink-0 text-xs text-muted tabular-nums">
                {at + 1} / {siblings.length}
              </span>
            )}
          </>
        }
        end={
          <>
            {siblings.length > 1 && (
              <>
                <IconButton label={t('image.prev')} onClick={() => go(-1)}>
                  <Icon name="chevron-left" class="size-5" />
                </IconButton>
                <IconButton label={t('image.next')} onClick={() => go(1)}>
                  <Icon name="chevron-right" class="size-5" />
                </IconButton>
              </>
            )}
            {/* Back to where it was opened from: the chat, or the Files tab */}
            <IconButton label={fileReturnsToChat() ? t('file.backToChat') : t('file.close')} onClick={closeFileView}>
              <Icon name="x" class="size-5" />
            </IconButton>
          </>
        }
      />
      {viewer.editing && (
        <form
          class="mx-auto flex w-full max-w-2xl gap-2 px-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) viewer.submitEdit(prompt);
          }}
        >
          <TextField compact class="min-w-0 flex-1" placeholder={t('image.editPlaceholder')} value={prompt} autoFocus aria-label={t('image.editLabel')} onInput={(e) => setPrompt((e.target as HTMLInputElement).value)} />
          <Button variant="primary" type="submit" disabled={!prompt.trim()}>
            <Icon name="wand" />
            {t('image.editSubmit')}
          </Button>
        </form>
      )}
      <div class="flex min-h-0 flex-1 items-center justify-center p-3 text-muted sm:p-4 md:pl-1">
        <ViewerStage viewer={viewer} />
      </div>
      {viewer.promptText && <p class="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-muted">{viewer.promptText}</p>}
    </main>
  );
}

// Tools that cannot run now (while an answer is written) are left out of the menus
const usable = (x: ViewerTool) => !x.disabled;

/** A tool as a menu item, named for a menu (the toolbar's short labels need their context there) */
const asAction = (x: ViewerTool): MenuAction => ({
  icon: x.icon,
  label: x.id.startsWith('upscale-') ? t('image.upscale', { scale: x.text ?? '' }) : x.id === 'edit' ? t('image.editByPrompt') : x.label,
  note: x.cost,
  run: x.run
});
