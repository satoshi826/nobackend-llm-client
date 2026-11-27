// Images: thumbnails in answers and the full-size viewer (with upscale / edit / background removal).
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from '../../../components/dialog';
import type { ImageParams, MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { baseName } from '../../../lib/paths';
import { currentId, openConversation } from '../../../state/conversations';
import { isStreaming } from '../../../state/runs';
import { IdleButton } from '../../../components/IdleButton';
import { modal, showToast } from '../../../state/ui';
import { Button, Disclosure, Icon, ScrollArea, Shimmer, Spinner, cx, IconButton, useSwipeStep, type IconName } from '../../../components/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import { copyText } from '../../../components/clipboard';
import {
  deleteImages,
  estimateCost,
  imageActions,
  imageProviderReady,
  imageAction,
  imageModelOf,
  goToImageChat,
  imageWorkOf,
  lightbox,
  loadImage,
  savedPathOf,
  regenerateImage,
  retryWithSuggestion,
  type LightboxItem
} from '../state';
import { t, usd } from '../messages';

type FilePart = Extract<Part, { type: 'file' }>;

/**
 * Object URLs of stored images (decrypted on demand), per image and size. Each is counted while on screen;
 * ones no longer shown are kept for a while (going back to them is instant) and then freed, oldest first
 */
type UrlEntry = { url: Promise<string | null>; users: number };
const urls = new Map<string, UrlEntry>();
const KEEP_UNUSED = 60;

function acquireUrl(key: string, load: () => Promise<Blob | null>): Promise<string | null> {
  let e = urls.get(key);
  if (!e) e = { url: load().then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null), users: 0 };
  // Map order is recency: the most recently used come last
  urls.delete(key);
  urls.set(key, e);
  e.users++;
  return e.url;
}

function releaseUrl(key: string) {
  const e = urls.get(key);
  if (!e) return;
  e.users--;
  let unused = [...urls.values()].filter((x) => x.users <= 0).length;
  for (const [k, x] of urls) {
    if (unused <= KEEP_UNUSED) break;
    if (x.users > 0) continue;
    urls.delete(k);
    unused--;
    void x.url.then((u) => u && URL.revokeObjectURL(u));
  }
}

/** Forget (and free) the object URLs of deleted images */
function releaseImageUrls(ids: string[]) {
  for (const id of ids)
    for (const key of [`full:${id}`, `thumb:${id}`]) {
      const e = urls.get(key);
      urls.delete(key);
      void e?.url.then((u) => u && URL.revokeObjectURL(u));
    }
}

/** Ask, then delete images (also used by the file manager) */
export async function confirmAndDelete(ids: string[]): Promise<boolean> {
  const ok = await askConfirm({
    title: ids.length > 1 ? t('delete.titleMany', { n: ids.length }) : t('delete.titleOne'),
    message: t('delete.message'),
    confirmLabel: t('delete.confirm'),
    danger: true
  });
  if (!ok) return false;
  await deleteImages(ids);
  releaseImageUrls(ids);
  showToast(ids.length > 1 ? t('delete.doneMany', { n: ids.length }) : t('delete.doneOne'));
  return true;
}

/** The object URL of an image: the full image, or its thumbnail. Loads only once `enabled` (e.g. on screen) */
export function useImageUrl(blobId: string | undefined, size: 'full' | 'thumb' = 'full', enabled = true): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(undefined);
    if (!blobId || !enabled) return;
    let alive = true;
    const key = `${size}:${blobId}`;
    void acquireUrl(key, () => loadImage(blobId, size)).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
      releaseUrl(key);
    };
  }, [blobId, size, enabled]);
  return url;
}

/**
 * The object URL of stored bytes (the whole, or the small copy), made when blobId is set and freed when it changes or
 * the component goes: for videos, too large to keep in the image cache
 */
export function useBlobUrl(blobId: string | undefined, size: 'full' | 'thumb' = 'full'): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(undefined);
    if (!blobId) return;
    let made: string | null = null;
    let alive = true;
    void loadImage(blobId, size)
      .then((b) => {
        made = b ? URL.createObjectURL(b) : null;
        if (alive) setUrl(made);
        else if (made) URL.revokeObjectURL(made);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [blobId, size]);
  return url;
}

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

/**
 * An image in a grid or an answer: its thumbnail, loaded when it comes near the screen. The caller gives the box a
 * fixed shape (aspect class), so nothing moves when the image arrives. full: a single image in an answer, shown
 * whole (letterboxed in its box) at full resolution
 */
export function ImageThumb({ blobId, alt, onOpen, full, class: className }: { blobId: string; alt: string; onOpen(): void; full?: boolean; class?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const near = useNearScreen(ref);
  const url = useImageUrl(blobId, full ? 'full' : 'thumb', near);
  return (
    <button ref={ref} type="button" class={cx('group relative overflow-hidden rounded-lg bg-glass-strong', className)} onClick={onOpen} aria-label={t('thumb.open', { alt })}>
      {url ? (
        <img src={url} alt={alt} class={cx('h-full w-full transition group-hover:scale-[1.02]', full ? 'object-contain' : 'object-cover')} decoding="async" />
      ) : url === null ? (
        <span class="grid h-full w-full place-items-center text-xs text-faint">{t('thumb.failed')}</span>
      ) : near ? (
        <span class="grid h-full w-full place-items-center">
          <Spinner class="size-4 text-faint" />
        </span>
      ) : null}
    </button>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span class="tabular-nums">{t('elapsed', { n: Math.max(0, Math.round((now - since) / 1000)) })}</span>;
}

const OP_LABEL = { generate: 'op.generate', upscale: 'op.upscale', edit: 'op.edit', 'remove-bg': 'op.removeBg' } as const;

/** Images a chat model put in its reply (native image output); image answers render their own */
export function ReplyImages({ m }: { m: MessageRecord }) {
  if (m.image) return null;
  const files = m.parts.filter((x): x is FilePart => x.type === 'file' && x.mimeType.startsWith('image/'));
  if (!files.length) return null;
  const items: LightboxItem[] = files.map((f) => ({ blobId: f.blobId, conversationId: m.conversationId, messageId: m.id }));
  return (
    <div class={cx('my-2 grid gap-2', files.length === 1 ? 'max-w-md grid-cols-1' : 'max-w-xl grid-cols-2')}>
      {files.map((f, i) => (
        <ImageThumb
          key={f.blobId}
          blobId={f.blobId}
          alt={t('thumb.alt', { n: i + 1 })}
          full={files.length === 1}
          class={files.length === 1 ? 'aspect-[4/3]' : 'aspect-square'}
          onOpen={() => (lightbox.value = { items, index: i })}
        />
      ))}
    </div>
  );
}

/** An image answer: progress, thumbnails, details, errors and retry options */
/** The images of an image answer (renders nothing for other messages) */
export function ImageAnswer({ m }: { m: MessageRecord }) {
  return m.image ? <ImageAnswerBody m={m} /> : null;
}

function ImageAnswerBody({ m }: { m: MessageRecord }) {
  const img = m.image!;
  const p = img.params;
  const files = m.parts.filter((x): x is FilePart => x.type === 'file');
  const items: LightboxItem[] = files.map((f) => ({ blobId: f.blobId, conversationId: m.conversationId, messageId: m.id }));
  const model = imageModelOf(p.providerId, p.model);
  // Running it again needs its provider's key
  const rerun = imageProviderReady(p.providerId);
  if (m.status === 'streaming')
    return (
      <div class="flex items-center gap-2 text-sm text-muted" role="status">
        <Spinner class="size-4" />
        <Shimmer>{t(OP_LABEL[p.op])}</Shimmer>
        <Elapsed since={m.createdAt} />
      </div>
    );
  return (
    <div class="space-y-2">
      {m.status === 'done' && files.length === 0 && <p class="text-sm text-muted">{t('deleted')}</p>}
      {files.length > 0 && (
        <div class={cx('grid gap-2', files.length === 1 ? 'max-w-md grid-cols-1' : 'max-w-xl grid-cols-2')}>
          {files.map((f, i) => (
            <ImageThumb
              key={f.blobId}
              blobId={f.blobId}
              alt={t('thumb.alt', { n: i + 1 })}
              full={files.length === 1}
          class={files.length === 1 ? 'aspect-[4/3]' : 'aspect-square'}
              onOpen={() => (lightbox.value = { items, index: i })}
            />
          ))}
        </div>
      )}
      {m.status === 'done' && (
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {p.op === 'generate' ? <span>{model?.name ?? p.model}</span> : <span>{p.op === 'upscale' ? t('info.upscale', { scale: p.scale ?? 2 }) : p.op === 'edit' ? t('info.edit') : t('info.removeBg')}</span>}
          {files[0]?.width && (
            <span class="tabular-nums">
              {files[0].width}×{files[0].height}
            </span>
          )}
          {img.seed !== undefined && <span class="tabular-nums">{t('info.seed', { seed: img.seed })}</span>}
          {p.style && <span>{p.style}</span>}
          {img.blurred && <span class="text-warn">{t('info.blurred')}</span>}
          {!!img.violations && <span class="text-warn">{t('info.violations', { n: img.violations })}</span>}
        </div>
      )}
      {img.enhancedPrompt && (
        <Disclosure class="text-xs" summary={t('info.enhanced')}>
          <p class="mt-1 whitespace-pre-wrap text-muted">{img.enhancedPrompt}</p>
        </Disclosure>
      )}
      {m.status === 'done' && p.op === 'generate' && rerun && (
        <div class="flex flex-wrap gap-1.5">
          {/* Same picture again needs a seed (some providers take none) */}
          {img.seed !== undefined && (
            <IdleButton class="text-xs" onClick={() => void regenerateImage(m.id, 'same')} title={t('regen.sameTitle')}>
              <Icon name="refresh" class="size-3.5" />
              {t('regen.same')}
            </IdleButton>
          )}
          <IdleButton class="text-xs" onClick={() => void regenerateImage(m.id, 'new')} title={t('regen.newTitle')}>
            <Icon name="sparkle" class="size-3.5" />
            {t('regen.new')}
          </IdleButton>
        </div>
      )}
      {m.status === 'done' && files.length === 1 && imageActions.some((a) => a.shown()) && (
        <div class="flex flex-wrap gap-1.5">
          {imageActions.filter((a) => a.shown()).map((a) => (
            <IdleButton key={a.id} class="text-xs" variant="outline" title={a.title()} onClick={() => void a.run(files[0].blobId)}>
              <Icon name={a.icon} class="size-3.5" />
              {a.label()}
            </IdleButton>
          ))}
        </div>
      )}
      {img.suggestion && m.status === 'error' && rerun && (
        <div class="flex flex-wrap gap-1.5">
          {img.suggestion.prompt && (
            <IdleButton class="text-xs" variant="outline" onClick={() => void retryWithSuggestion(m.id, 'prompt')} title={img.suggestion.prompt}>
              <Icon name="wand" class="size-3.5" />
              {t('retry.prompt')}
            </IdleButton>
          )}
          {img.suggestion.model && (
            <IdleButton class="text-xs" variant="outline" onClick={() => void retryWithSuggestion(m.id, 'model')}>
              <Icon name="swap" class="size-3.5" />
              {t('retry.model', { model: img.suggestion.model })}
            </IdleButton>
          )}
        </div>
      )}
    </div>
  );
}

/** Thumbnails for images a chat model created with the generate_image tool */
export function ToolImages({ blobIds, conversationId, messageId }: { blobIds: string[]; conversationId: string; messageId: string }) {
  const items = blobIds.map((blobId) => ({ blobId, conversationId, messageId }));
  return (
    <div class={cx('grid gap-2 py-1', blobIds.length === 1 ? 'max-w-md grid-cols-1' : 'max-w-xl grid-cols-2')}>
      {blobIds.map((id, i) => (
        <ImageThumb key={id} blobId={id} alt={t('thumb.alt', { n: i + 1 })} full={blobIds.length === 1} class={blobIds.length === 1 ? 'aspect-[4/3]' : 'aspect-square'} onOpen={() => (lightbox.value = { items, index: i })} />
      ))}
    </div>
  );
}

/** The estimated cost of an edit, for the button titles */
function costText(p: Pick<ImageParams, 'op' | 'providerId' | 'scale'> & { model?: string }): string {
  const cost = estimateCost({ model: '', prompt: '', variants: 1, safeMode: false, format: 'png', ...p });
  return cost === undefined ? t('lb.costUnknown') : t('lb.cost', { cost: usd(cost, 2) });
}

function step(d: number) {
  const cur = lightbox.value;
  if (cur) lightbox.value = { ...cur, index: (cur.index + d + cur.items.length) % cur.items.length };
}

/** Something a full-size view offers for an image or a video. text: a short label shown beside the icon (else icon only) */
export interface ViewerTool {
  id: string;
  icon: IconName;
  label: string;
  text?: string;
  title?: string;
  /** What running it costs (an estimate, or unknown), for menus that show no title */
  cost?: string;
  /** It makes a new image or video from this one (an edit, an upscale, a video), in a chat */
  makesNew?: boolean;
  run(): void;
  pressed?: boolean;
  disabled?: boolean;
}

/** What a full-size view of an image or a video shows and offers (the lightbox, and the Files tab's page draw it each their way) */
export interface Viewer {
  url: string | null | undefined;
  video: boolean;
  /** Its bytes are not stored in this browser (a backup restored without images) */
  missing: boolean;
  promptText: string;
  tools: ViewerTool[];
  /** The edit prompt is open */
  editing: boolean;
  submitEdit(prompt: string): void;
}

/**
 * The full-size view's state and tools for one item. leave: the view closes because an action goes on in a chat;
 * deleted: the item was deleted; fromGallery: offer to open the chat it was made in
 */
export function useImageViewer(item: LightboxItem | undefined, o: { leave(): void; deleted(): void; fromGallery?: boolean }): Viewer {
  const imageUrl = useImageUrl(item?.video ? undefined : item?.blobId);
  const videoUrl = useBlobUrl(item?.video ? item.blobId : undefined);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [item?.blobId]);
  const url = item?.video ? videoUrl : imageUrl;
  const video = !!item?.video;
  const missing = url === null;
  const work = item && imageWorkOf(item, url !== null);
  const promptText = work?.prompt ?? '';
  if (!item || !work) return { url, video, missing, promptText, tools: [], editing: false, submitEdit: () => {} };
  const { from } = work;
  const act = async (fn: () => Promise<void>) => {
    await goToImageChat(work);
    o.leave();
    modal.value = null;
    await fn();
  };
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    // Named as it is saved in the Files tab
    const path = item.name ?? savedPathOf(item.blobId);
    a.download = path ? baseName(path) : video ? `video-${item.blobId.slice(0, 8)}.mp4` : `image-${item.blobId.slice(0, 8)}.png`;
    a.click();
  };
  const busy = isStreaming.value;
  const tools: ViewerTool[] = [
    ...(url ? [{ id: 'download', icon: 'download' as const, label: t('lb.download'), run: download }] : []),
    ...(promptText ? [{ id: 'copy', icon: 'copy' as const, label: t('lb.copyPrompt'), run: () => void copyText(promptText, t('lb.copied')) }] : []),
    ...(work.upscale
      ? ([2, 4] as const).map((scale) => ({
          id: `upscale-${scale}`,
          icon: 'expand' as const,
          label: `${scale}×`,
          text: `${scale}×`,
          title: t('lb.upscaleTitle', { scale, cost: costText({ op: 'upscale', providerId: work.upscale!, scale }) }),
          cost: costText({ op: 'upscale', providerId: work.upscale!, scale }),
          makesNew: true,
          disabled: busy,
          run: () => void act(() => imageAction('upscale', item.blobId, { scale, from }))
        }))
      : []),
    ...(work.removeBg
      ? [{ id: 'remove-bg', icon: 'scissors' as const, label: t('lb.removeBg'), text: t('lb.removeBg'), title: t('lb.removeBgTitle', { cost: costText({ op: 'remove-bg', providerId: work.removeBg }) }), cost: costText({ op: 'remove-bg', providerId: work.removeBg }), makesNew: true, disabled: busy, run: () => void act(() => imageAction('remove-bg', item.blobId, { from })) }]
      : []),
    ...(!video && !missing
      ? imageActions.filter((a) => a.shown()).map((a) => ({ id: a.id, icon: a.icon, label: a.label(), text: a.label(), title: a.title(), makesNew: true, run: () => void act(async () => a.run(item.blobId, item.name)) }))
      : []),
    ...(work.edit
      ? [{ id: 'edit', icon: 'wand' as const, label: t('lb.edit'), text: t('lb.edit'), title: t('lb.editTitle', { model: work.edit.name, cost: costText({ op: 'edit', providerId: work.edit.providerId, model: work.edit.model }) }), cost: costText({ op: 'edit', providerId: work.edit.providerId, model: work.edit.model }), makesNew: true, disabled: busy, pressed: editing, run: () => setEditing(!editing) }]
      : []),
    {
      id: 'delete',
      icon: 'trash',
      label: t(video ? 'lb.deleteVideo' : 'lb.delete'),
      run: async () => {
        if (await confirmAndDelete([item.blobId])) o.deleted();
      }
    },
    ...(o.fromGallery && work.chat && currentId.value !== work.chat
      ? [
          {
            id: 'open-chat',
            icon: 'chat' as const,
            label: t('lb.openChat'),
            text: t('lb.openChat'),
            run: () => {
              o.leave();
              modal.value = null;
              void openConversation(work.chat!);
            }
          }
        ]
      : [])
  ];
  return { url, video, missing, promptText, tools, editing, submitEdit: (prompt) => void act(() => imageAction('edit', item.blobId, { prompt, from })) };
}

/** The image or video itself, as large as the space allows */
export function ViewerStage({ viewer, class: cls }: { viewer: Viewer; class?: string }) {
  if (viewer.missing) return <p class={cx('text-sm', cls)}>{t('thumb.failed')}</p>;
  if (!viewer.url) return <Spinner class="size-6" />;
  if (viewer.video) return <video key={viewer.url} src={viewer.url} controls autoPlay playsInline class="max-h-full max-w-full" />;
  return <img src={viewer.url} alt={viewer.promptText || t('lb.alt')} class="max-h-full max-w-full object-contain" />;
}

/** Full-size viewer over the app (images in chats) */
export function Lightbox() {
  const lb = lightbox.value;
  const item = lb?.items[lb.index];
  const close = () => (lightbox.value = null);
  const viewer = useImageViewer(item, {
    leave: close,
    deleted: () => {
      const cur = lightbox.value;
      if (!cur || !item) return;
      const items = cur.items.filter((x) => x.blobId !== item.blobId);
      lightbox.value = items.length ? { ...cur, items, index: Math.min(cur.index, items.length - 1) } : null;
    },
    fromGallery: lb?.fromGallery
  });
  const [prompt, setPrompt] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, { onClose: close, active: !!lb });
  const swipe = useSwipeStep(lb && lb.items.length > 1 ? step : undefined);
  useEffect(() => setPrompt(''), [item?.blobId]);
  useEffect(() => {
    // Arrow keys switch images (not while typing). Esc and focus are handled by useDialog
    const onKey = (e: KeyboardEvent) => {
      if (!lightbox.value || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (!lb || !item) return null;
  const { editing, promptText } = viewer;
  return (
    <div ref={rootRef} class="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label={t('lb.label')} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="flex items-center gap-1 p-2">
        <span class="px-2 text-sm text-white/70 tabular-nums">
          {lb.index + 1} / {lb.items.length}
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          {viewer.tools.map((x) =>
            x.text ? (
              <Button key={x.id} class={cx('text-xs text-white hover:bg-glass', x.pressed && 'bg-glass-strong')} disabled={x.disabled} aria-pressed={x.pressed} title={x.title} onClick={x.run}>
                <Icon name={x.icon} class="size-4" />
                {x.text}
              </Button>
            ) : (
              <IconButton key={x.id} class="text-white hover:bg-glass" label={x.label} onClick={x.run}>
                <Icon name={x.icon} />
              </IconButton>
            )
          )}
          <IconButton class="text-white hover:bg-glass" onClick={close} label={t('lb.close')} data-dialog-close>
            <Icon name="x" />
          </IconButton>
        </div>
      </div>
      {editing && (
        <form
          class="mx-auto flex w-full max-w-2xl gap-2 px-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) viewer.submitEdit(prompt);
          }}
        >
          <input
            class="min-w-0 flex-1 rounded-lg border border-white/30 bg-scrim px-3 py-1.5 text-sm text-white placeholder:text-white/50"
            placeholder={t('lb.editPlaceholder')}
            value={prompt}
            onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
            aria-label={t('lb.editLabel')}
          />
          <Button variant="primary" type="submit" disabled={!prompt.trim()}>
            <Icon name="wand" />
            {t('lb.editSubmit')}
          </Button>
        </form>
      )}
      <div {...swipe} class={cx('relative flex min-h-0 flex-1 items-center justify-center p-2', swipe.class)} onClick={(e) => e.target === e.currentTarget && close()}>
        <ViewerStage viewer={viewer} class="text-white/70" />
        {lb.items.length > 1 && (
          <>
            <button type="button" class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass-strong" onClick={() => step(-1)} aria-label={t('lb.prev')} data-tip={t('lb.prev')}>
              <Icon name="chevron-left" />
            </button>
            <button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass-strong" onClick={() => step(1)} aria-label={t('lb.next')} data-tip={t('lb.next')}>
              <Icon name="chevron-right" />
            </button>
          </>
        )}
      </div>
      {promptText && <p class="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-white/70">{promptText}</p>}
    </div>
  );
}
