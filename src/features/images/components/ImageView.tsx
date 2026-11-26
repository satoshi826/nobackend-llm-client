// Images: thumbnails in answers and the full-size viewer (with upscale / edit / background removal).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from '../../../components/dialog';
import type { ImageParams, MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { getImage, getImageThumb } from '../../../lib/db/images';
import { conversations, currentId, messages, openConversation, startNewChat } from '../../../state/conversations';
import { isStreaming } from '../../../state/runs';
import { modal, showToast } from '../../../state/ui';
import { Button, Icon, Shimmer, Spinner, cx, IconButton } from '../../../components/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import {
  deleteImages,
  estimateCost,
  editTargetFor,
  imageAction,
  imageModelOf,
  lightbox,
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
    void acquireUrl(key, () => (size === 'thumb' ? getImageThumb(blobId) : getImage(blobId))).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
      releaseUrl(key);
    };
  }, [blobId, size, enabled]);
  return url;
}

/** Whether the element is on screen or about to be (for loading only what can be seen) */
function useNearScreen(ref: { current: Element | null }): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return near;
}

/**
 * An image in a grid or an answer: its thumbnail, loaded when it comes near the screen. The caller gives the box a
 * fixed shape (aspect class), so nothing moves when the image arrives. full: a single image in an answer, shown
 * whole (letterboxed in its box) at full resolution
 */
export function ImageThumb({ blobId, alt, onOpen, full, class: className }: { blobId: string; alt: string; onOpen(): void; full?: boolean; class?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const url = useImageUrl(blobId, full ? 'full' : 'thumb', useNearScreen(ref));
  return (
    <button ref={ref} type="button" class={cx('group relative overflow-hidden rounded-lg bg-glass-strong', className)} onClick={onOpen} aria-label={t('thumb.open', { alt })}>
      {url ? (
        <img src={url} alt={alt} class={cx('h-full w-full transition group-hover:scale-[1.02]', full ? 'object-contain' : 'object-cover')} decoding="async" />
      ) : url === null ? (
        <span class="grid h-full w-full place-items-center text-xs text-faint">{t('thumb.failed')}</span>
      ) : (
        <span class="grid h-full w-full place-items-center">
          <Spinner class="size-4 text-faint" />
        </span>
      )}
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
        <details class="text-xs text-muted">
          <summary class="cursor-pointer">{t('info.enhanced')}</summary>
          <p class="mt-1 whitespace-pre-wrap">{img.enhancedPrompt}</p>
        </details>
      )}
      {m.status === 'done' && p.op === 'generate' && (
        <div class="flex flex-wrap gap-1.5">
          {/* Same picture again needs a seed (some providers take none) */}
          {img.seed !== undefined && (
            <Button class="text-xs" disabled={isStreaming.value} onClick={() => void regenerateImage(m.id, 'same')} title={t('regen.sameTitle')}>
              <Icon name="refresh" class="size-3.5" />
              {t('regen.same')}
            </Button>
          )}
          <Button class="text-xs" disabled={isStreaming.value} onClick={() => void regenerateImage(m.id, 'new')} title={t('regen.newTitle')}>
            <Icon name="sparkle" class="size-3.5" />
            {t('regen.new')}
          </Button>
        </div>
      )}
      {img.suggestion && m.status === 'error' && (
        <div class="flex flex-wrap gap-1.5">
          {img.suggestion.prompt && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void retryWithSuggestion(m.id, 'prompt')} title={img.suggestion.prompt}>
              <Icon name="wand" class="size-3.5" />
              {t('retry.prompt')}
            </Button>
          )}
          {img.suggestion.model && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void retryWithSuggestion(m.id, 'model')}>
              <Icon name="swap" class="size-3.5" />
              {t('retry.model', { model: img.suggestion.model })}
            </Button>
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

/** Full-size viewer with download, prompt copy, upscale, background removal and edit */
export function Lightbox() {
  const lb = lightbox.value;
  const item = lb?.items[lb.index];
  const url = useImageUrl(item?.blobId);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, { onClose: () => (lightbox.value = null), active: !!lb });
  useEffect(() => {
    setEditing(false);
    setPrompt('');
  }, [item?.blobId]);
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
  const msg = messages.value.find((m) => m.id === item.messageId);
  const source = msg ? messages.value.find((m) => m.id === msg.parentId) : undefined;
  const promptText = msg?.image?.params.prompt || source?.imageRequest?.prompt || '';
  // Edits run on the provider that made the image when it offers them, else on another one with a key
  const from = { providerId: msg?.meta?.providerId, model: msg?.meta?.model };
  const upscaler = editTargetFor('upscale', from)?.provider;
  const bgRemover = editTargetFor('remove-bg', from)?.provider;
  const editor = editTargetFor('edit', from);
  const editorName = editor && (editor.model ? (imageModelOf(editor.provider.id, editor.model)?.name ?? editor.model) : editor.provider.label);
  const chat = item.conversationId;
  const inThisChat = !!chat && currentId.value === chat;
  // Saved images outlive their conversation, and brought-in images have none: those are edited in a new chat
  const chatExists = inThisChat || (!!chat && conversations.value.some((c) => c.id === chat));
  const close = () => (lightbox.value = null);
  const act = async (fn: () => Promise<void>) => {
    if (!inThisChat) {
      if (chat && chatExists) await openConversation(chat);
      else startNewChat();
    }
    close();
    modal.value = null;
    await fn();
  };
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    const file = msg?.parts.find((p): p is FilePart => p.type === 'file' && p.blobId === item.blobId);
    a.download = item.name ?? file?.name ?? `image-${item.blobId.slice(0, 8)}.png`;
    a.click();
  };
  return (
    <div ref={rootRef} class="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label={t('lb.label')} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="flex items-center gap-1 p-2">
        <span class="px-2 text-sm text-white/70 tabular-nums">
          {lb.index + 1} / {lb.items.length}
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <IconButton class="text-white hover:bg-glass" onClick={download} label={t('lb.download')}>
            <Icon name="download" />
          </IconButton>
          {promptText && (
            <IconButton
              class="text-white hover:bg-glass"
              label={t('lb.copyPrompt')}
              onClick={() => void navigator.clipboard.writeText(promptText).then(() => showToast(t('lb.copied')))}
            >
              <Icon name="copy" />
            </IconButton>
          )}
          {upscaler &&
            ([2, 4] as const).map((scale) => (
              <Button key={scale} class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} title={t('lb.upscaleTitle', { scale, cost: costText({ op: 'upscale', providerId: upscaler.id, scale }) })} onClick={() => void act(() => imageAction('upscale', item.blobId, { scale, from }))}>
                <Icon name="expand" class="size-4" />
                {scale}×
              </Button>
            ))}
          {bgRemover && (
            <Button class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} title={t('lb.removeBgTitle', { cost: costText({ op: 'remove-bg', providerId: bgRemover.id }) })} onClick={() => void act(() => imageAction('remove-bg', item.blobId, { from }))}>
              <Icon name="scissors" class="size-4" />
              {t('lb.removeBg')}
            </Button>
          )}
          {editor && (
            <Button class={cx('text-xs text-white hover:bg-glass', editing && 'bg-glass-strong')} disabled={isStreaming.value} aria-pressed={editing} title={t('lb.editTitle', { model: editorName!, cost: costText({ op: 'edit', providerId: editor.provider.id, model: editor.model }) })} onClick={() => setEditing(!editing)}>
              <Icon name="wand" class="size-4" />
              {t('lb.edit')}
            </Button>
          )}
          <IconButton
            class="text-white hover:bg-glass"
            label={t('lb.delete')}
            onClick={async () => {
              const cur = lightbox.value;
              if (!cur || !(await confirmAndDelete([item.blobId]))) return;
              const items = cur.items.filter((x) => x.blobId !== item.blobId);
              lightbox.value = items.length ? { ...cur, items, index: Math.min(cur.index, items.length - 1) } : null;
            }}
          >
            <Icon name="trash" />
          </IconButton>
          {lb.fromGallery && chat && !inThisChat && chatExists && (
            <Button
              class="text-xs text-white hover:bg-glass"
              onClick={() => {
                close();
                modal.value = null;
                void openConversation(chat);
              }}
            >
              <Icon name="chat" class="size-3.5" />
              {t('lb.openChat')}
            </Button>
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
            if (prompt.trim()) void act(() => imageAction('edit', item.blobId, { prompt, from }));
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
      <div class="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={(e) => e.target === e.currentTarget && close()}>
        {url ? <img src={url} alt={promptText || t('lb.alt')} class="max-h-full max-w-full object-contain" /> : <Spinner class="size-6" />}
        {lb.items.length > 1 && (
          <>
            <button type="button" class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass-strong" onClick={() => step(-1)} aria-label={t('lb.prev')} title={t('lb.prev')}>
              <Icon name="chevron-left" />
            </button>
            <button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass-strong" onClick={() => step(1)} aria-label={t('lb.next')} title={t('lb.next')}>
              <Icon name="chevron-right" />
            </button>
          </>
        )}
      </div>
      {promptText && <p class="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-white/70">{promptText}</p>}
    </div>
  );
}
