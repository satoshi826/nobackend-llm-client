// The full-size view of an image or a video, one for every place that opens one: over the chat (Lightbox) and the
// Files tab's page. Top: its name and place in the set, then download, copy prompt, delete and close. Middle: the
// item, stepped with the side buttons, arrow keys or a swipe. Bottom: its prompt, and what features make from it.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { baseName } from '../../lib/paths';
import { removeFiles, lightbox, openChatOf, promptOf, savedPathOf, type MediaItem } from '../../state/media';
import { isStreaming } from '../../state/runs';
import { showToast } from '../../state/ui';
import { askConfirm } from '../ConfirmDialog';
import { copyText } from '../clipboard';
import { useDialog } from '../dialog';
import { mediaActions, textOf, type MediaAction } from '../extensions';
import { Button, Icon, IconButton, Spinner, TextField, cx, useSwipeStep } from '../ui';
import { releaseMediaUrls, useBlobUrl, useImageUrl } from './urls';
import { t } from './messages';

/** Ask, then delete images and videos (the viewer, the file manager) */
export async function confirmDeleteMedia(ids: string[]): Promise<boolean> {
  const ok = await askConfirm({
    title: ids.length > 1 ? t('delete.titleMany', { n: ids.length }) : t('delete.titleOne'),
    message: t('delete.message'),
    confirmLabel: t('delete.confirm'),
    danger: true
  });
  if (!ok) return false;
  await removeFiles(ids);
  releaseMediaUrls(ids);
  showToast(ids.length > 1 ? t('delete.doneMany', { n: ids.length }) : t('delete.doneOne'));
  return true;
}

export function MediaViewer({
  item,
  at,
  step,
  close,
  closeLabel = t('viewer.close'),
  deleted,
  aside
}: {
  item: MediaItem;
  /** Its place in the set it steps through */
  at: { index: number; total: number };
  step(d: 1 | -1): void;
  close(): void;
  closeLabel?: string;
  /** It was deleted (show the next one, or close) */
  deleted(): void;
  /** Beside its name (e.g. a link to the chat it was made in) */
  aside?: ComponentChildren;
}) {
  const imageUrl = useImageUrl(item.video ? undefined : item.fileId);
  const videoUrl = useBlobUrl(item.video ? item.fileId : undefined);
  const url = item.video ? videoUrl : imageUrl;
  const [asking, setAsking] = useState<MediaAction | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    setAsking(null);
    setText('');
  }, [item.fileId]);
  const many = at.total > 1;
  // Arrow keys step (not while typing)
  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const swipe = useSwipeStep(many ? step : undefined);

  const path = item.name ?? savedPathOf(item.fileId);
  const prompt = promptOf(item);
  // Made from an image whose bytes are here; each runs in the image's chat
  const actions = !item.video && url ? mediaActions.flatMap((a) => {
        const offer = a.offer(item);
        return offer ? [{ a, title: offer.title }] : [];
      }) : [];
  const busy = isStreaming.value;
  const run = async (a: MediaAction, input?: string) => {
    await openChatOf(item);
    close();
    await a.run(item, input);
  };
  const download = () => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = path ? baseName(path) : `${item.video ? 'video' : 'image'}-${item.fileId.slice(0, 8)}.${item.video ? 'mp4' : 'png'}`;
    link.click();
  };
  const remove = async () => {
    if (await confirmDeleteMedia([item.fileId])) deleted();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center gap-1 px-2 py-1.5">
        <Icon name={item.video ? 'video' : 'image'} class="ml-1.5 size-4 shrink-0 text-muted" />
        <span class="min-w-0 truncate text-sm font-medium text-ink-strong" data-tip={path}>
          {path ? baseName(path) : ''}
        </span>
        {aside}
        {many && (
          <span class="shrink-0 text-xs text-muted tabular-nums">
            {at.index + 1} / {at.total}
          </span>
        )}
        <div class="ml-auto flex shrink-0 items-center">
          {url && (
            <IconButton label={t('viewer.download')} onClick={download}>
              <Icon name="download" />
            </IconButton>
          )}
          {prompt && (
            <IconButton label={t('viewer.copyPrompt')} onClick={() => void copyText(prompt, t('viewer.copied'))}>
              <Icon name="copy" />
            </IconButton>
          )}
          <IconButton variant="remove" label={t(item.video ? 'viewer.deleteVideo' : 'viewer.delete')} onClick={() => void remove()}>
            <Icon name="trash" />
          </IconButton>
          <IconButton label={closeLabel} onClick={close} data-dialog-close>
            <Icon name="x" />
          </IconButton>
        </div>
      </div>
      <div {...swipe} class={cx('relative flex min-h-0 flex-1 items-center justify-center p-2 text-muted', swipe.class)}>
        {url === null ? (
          <p class="text-sm">{t('thumb.failed')}</p>
        ) : !url ? (
          <Spinner class="size-6" />
        ) : item.video ? (
          <video key={url} src={url} controls autoPlay playsInline class="max-h-full max-w-full" />
        ) : (
          <img src={url} alt={prompt || t('viewer.alt')} class="max-h-full max-w-full object-contain" />
        )}
        {many && (
          <>
            <IconButton class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full! bg-glass p-2!" label={t('viewer.prev')} onClick={() => step(-1)}>
              <Icon name="chevron-left" />
            </IconButton>
            <IconButton class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full! bg-glass p-2!" label={t('viewer.next')} onClick={() => step(1)}>
              <Icon name="chevron-right" />
            </IconButton>
          </>
        )}
      </div>
      {(prompt || actions.length > 0) && (
        <div class="mx-auto w-full max-w-3xl space-y-2 px-3 pt-1 pb-3">
          {prompt && <p class="line-clamp-3 text-center text-xs leading-5 break-words text-muted">{prompt}</p>}
          {actions.length > 0 && (
            <div class="flex flex-wrap items-center justify-center gap-1" role="group" aria-label={t('viewer.make')}>
              {actions.map(({ a, title }) => (
                <Button
                  key={a.id}
                  variant="outline"
                  class={cx('px-2.5! py-1.5! text-xs', asking === a && 'border-line-strong! bg-glass-strong!')}
                  title={title}
                  disabled={busy}
                  aria-pressed={a.instruction ? asking === a : undefined}
                  onClick={() => (a.instruction ? setAsking(asking === a ? null : a) : void run(a))}
                >
                  <Icon name={a.icon} class="size-3.5" />
                  {textOf(a.label)}
                </Button>
              ))}
            </div>
          )}
          {asking && (
            <form
              class="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim() && !busy) void run(asking, text.trim());
              }}
            >
              <TextField
                class="min-w-0 flex-1"
                placeholder={textOf(asking.instruction!)}
                aria-label={textOf(asking.label)}
                value={text}
                // Opened by the user to type in it
                autoFocus
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
              />
              <Button variant="primary" type="submit" disabled={!text.trim() || busy}>
                <Icon name={asking.icon} />
                {t('viewer.instructionSubmit')}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** The viewer over the chat (images and videos in answers) */
export function Lightbox() {
  const lb = lightbox.value;
  const item = lb?.items[lb.index];
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => (lightbox.value = null);
  useDialog(rootRef, { onClose: close, active: !!lb });
  if (!lb || !item) return null;
  const step = (d: 1 | -1) => {
    const cur = lightbox.value;
    if (cur) lightbox.value = { ...cur, index: (cur.index + d + cur.items.length) % cur.items.length };
  };
  const deleted = () => {
    const items = lb.items.filter((x) => x.fileId !== item.fileId);
    lightbox.value = items.length ? { items, index: Math.min(lb.index, items.length - 1) } : null;
  };
  return (
    <div ref={rootRef} class="fixed inset-0 z-[70] flex flex-col bg-canvas/95 backdrop-blur-md pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" role="dialog" aria-modal="true" aria-label={t('viewer.label')}>
      <MediaViewer item={item} at={{ index: lb.index, total: lb.items.length }} step={step} close={close} deleted={deleted} />
    </div>
  );
}
