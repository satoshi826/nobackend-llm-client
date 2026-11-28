// Images in answers and grids: thumbnails loaded as they come near the screen, and the grid of a message's images
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { ScrollArea, cx } from '../ui';
import { openLightbox } from '../../state/media';
import { useImageUrl } from './urls';
import { t } from './messages';

/**
 * Whether the element is within a screen or two of what can be seen in its scrolling area: true as it comes near,
 * false again once it is far, so a long list holds only the images around the view (an image let go goes back to the
 * URLs kept unused, so scrolling back a little is instant). The margin is wide, so a scroll back and forth does not
 * load and let go of the same images over and over
 */
function useNearScreen(ref: { current: Element | null }): boolean {
  const area = useContext(ScrollArea);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), { root: area?.current ?? null, rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [area]);
  return near;
}

/** A box's size: its shape, and its width */
type Box = { aspectRatio: string; width: string };

/**
 * A thumbnail's picture, loaded when it comes near the screen. It fills the positioned box that holds it, whose shape
 * the caller fixes, so nothing moves when the image arrives. full: shown whole at full resolution
 */
export function MediaImage({ blobId, alt, full }: { blobId: string; alt: string; full?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref);
  const url = useImageUrl(blobId, full ? 'full' : 'thumb', near);
  return (
    <span ref={ref} class="absolute inset-0">
      {url ? (
        // Not draggable itself: dragging moves what holds it (a file card onto a folder), not a copy of the picture
        <img src={url} alt={alt} draggable={false} class={cx('h-full w-full transition group-hover:scale-[1.02]', full ? 'object-contain' : 'object-cover')} decoding="async" />
      ) : url === null ? (
        <span class="grid h-full w-full place-items-center text-xs text-faint">{t('thumb.failed')}</span>
      ) : null}
    </span>
  );
}

/**
 * An image in a grid or an answer that opens when pressed: its thumbnail in a box of a fixed shape (an aspect class or
 * style). full: shown whole at full resolution (a single image in an answer, whose box has its shape)
 */
export function MediaThumb({ blobId, alt, onOpen, full, class: className, style }: { blobId: string; alt: string; onOpen(e: MouseEvent): void; full?: boolean; class?: string; style?: Box }) {
  return (
    <button type="button" class={cx('group relative overflow-hidden rounded-lg bg-glass-strong', className)} style={style} onClick={onOpen} aria-label={t('thumb.open', { alt })}>
      <MediaImage blobId={blobId} alt={alt} full={full} />
    </button>
  );
}

/** The box of a single image or video in an answer: its own shape (stored with it), at most 28rem wide and high */
export function singleBox(width: number | undefined, height: number | undefined): Box {
  const ratio = width && height ? width / height : 1;
  return { aspectRatio: String(ratio), width: `min(100%, 28rem, ${(28 * ratio).toFixed(3)}rem)` };
}

/** A message's images: one in its own shape, several as a grid of squares. Each opens the viewer over the chat */
export function MediaGrid({ files, owner }: { files: { blobId: string; width?: number; height?: number }[]; owner: { conversationId: string; messageId: string } }) {
  if (!files.length) return null;
  const open = (i: number) => openLightbox(files, i, owner);
  if (files.length === 1) return <MediaThumb blobId={files[0].blobId} alt={t('thumb.alt', { n: 1 })} full class="block" style={singleBox(files[0].width, files[0].height)} onOpen={() => open(0)} />;
  return (
    <div class="grid max-w-xl grid-cols-2 gap-2">
      {files.map((f, i) => (
        <MediaThumb key={f.blobId} blobId={f.blobId} alt={t('thumb.alt', { n: i + 1 })} class="aspect-square" onOpen={() => open(i)} />
      ))}
    </div>
  );
}
