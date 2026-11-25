// Images: thumbnails in answers and the full-size viewer (with upscale / edit / background removal).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from '../../../components/dialog';
import type { ImageParams, MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { getImage } from '../../../lib/db/images';
import { currentId, messages, openConversation } from '../../../state/conversations';
import { isStreaming } from '../../../state/runs';
import { modal, showToast } from '../../../state/ui';
import { Button, Icon, Shimmer, Spinner, cx } from '../../../components/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import {
  deleteImages,
  estimateCost,
  imageAction,
  imageModelOf,
  imageReady,
  lightbox,
  regenerateImage,
  retryWithSuggestion,
  type LightboxItem
} from '../state';
import { t, usd } from '../messages';

type FilePart = Extract<Part, { type: 'file' }>;

/** Object URLs for stored images (decrypted on demand; kept until the page reloads, which locking does) */
const urls = new Map<string, Promise<string | null>>();
function imageUrl(blobId: string): Promise<string | null> {
  let p = urls.get(blobId);
  if (!p) {
    p = getImage(blobId)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    urls.set(blobId, p);
  }
  return p;
}

/** Forget (and free) the object URLs of deleted images */
function releaseImageUrls(ids: string[]) {
  for (const id of ids) {
    const p = urls.get(id);
    urls.delete(id);
    void p?.then((u) => u && URL.revokeObjectURL(u));
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

export function useImageUrl(blobId: string | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (blobId) void imageUrl(blobId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [blobId]);
  return url;
}

export function ImageThumb({ blobId, alt, onOpen, class: className }: { blobId: string; alt: string; onOpen(): void; class?: string }) {
  const url = useImageUrl(blobId);
  return (
    <button type="button" class={cx('group relative overflow-hidden rounded-lg bg-glass-strong', className)} onClick={onOpen} aria-label={t('thumb.open', { alt })}>
      {url ? (
        <img src={url} alt={alt} class="h-full w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" decoding="async" />
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
          class={files.length === 1 ? 'aspect-auto max-h-[28rem]' : 'aspect-square'}
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
              class={files.length === 1 ? 'aspect-auto max-h-[28rem]' : 'aspect-square'}
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
              {t('retry.prompt')}
            </Button>
          )}
          {img.suggestion.model && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void retryWithSuggestion(m.id, 'model')}>
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
        <ImageThumb key={id} blobId={id} alt={t('thumb.alt', { n: i + 1 })} class={blobIds.length === 1 ? 'max-h-[28rem]' : 'aspect-square'} onOpen={() => (lightbox.value = { items, index: i })} />
      ))}
    </div>
  );
}

const OP_BASE: ImageParams = { op: 'generate', providerId: 'venice', model: '', prompt: '', variants: 1, safeMode: false, format: 'png' };

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
  const inThisChat = currentId.value === item.conversationId;
  const close = () => (lightbox.value = null);
  const act = async (fn: () => Promise<void>) => {
    if (!inThisChat) await openConversation(item.conversationId);
    close();
    modal.value = null;
    await fn();
  };
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    const file = msg?.parts.find((p): p is FilePart => p.type === 'file' && p.blobId === item.blobId);
    a.download = file?.name ?? `image-${item.blobId.slice(0, 8)}.png`;
    a.click();
  };
  return (
    <div ref={rootRef} class="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label={t('lb.label')} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="flex items-center gap-1 p-2">
        <span class="px-2 text-sm text-white/70 tabular-nums">
          {lb.index + 1} / {lb.items.length}
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <Button class="text-white hover:bg-glass" onClick={download} aria-label={t('lb.download')} title={t('lb.download')}>
            <Icon name="download" />
          </Button>
          {promptText && (
            <Button
              class="text-white hover:bg-glass"
              aria-label={t('lb.copyPrompt')}
              title={t('lb.copyPrompt')}
              onClick={() => void navigator.clipboard.writeText(promptText).then(() => showToast(t('lb.copied')))}
            >
              <Icon name="copy" />
            </Button>
          )}
          {imageReady.value && (
            <>
              <Button class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} title={t('lb.upscaleTitle', { scale: 2, cost: usd(estimateCost({ ...OP_BASE, op: 'upscale', scale: 2 }) ?? 0, 2) })} onClick={() => void act(() => imageAction('upscale', item.blobId, { scale: 2 }))}>
                <Icon name="expand" class="size-4" />
                2×
              </Button>
              <Button class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} title={t('lb.upscaleTitle', { scale: 4, cost: usd(estimateCost({ ...OP_BASE, op: 'upscale', scale: 4 }) ?? 0, 2) })} onClick={() => void act(() => imageAction('upscale', item.blobId, { scale: 4 }))}>
                4×
              </Button>
              <Button class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} title={t('lb.removeBgTitle')} onClick={() => void act(() => imageAction('remove-bg', item.blobId))}>
                <Icon name="scissors" class="size-4" />
                {t('lb.removeBg')}
              </Button>
              <Button class="text-xs text-white hover:bg-glass" disabled={isStreaming.value} aria-pressed={editing} title={t('lb.editTitle', { cost: usd(estimateCost({ ...OP_BASE, op: 'edit' }) ?? 0, 2) })} onClick={() => setEditing(!editing)}>
                <Icon name="wand" class="size-4" />
                {t('lb.edit')}
              </Button>
            </>
          )}
          <Button
            class="text-white hover:bg-glass"
            aria-label={t('lb.delete')}
            title={t('lb.delete')}
            onClick={async () => {
              const cur = lightbox.value;
              if (!cur || !(await confirmAndDelete([item.blobId]))) return;
              const items = cur.items.filter((x) => x.blobId !== item.blobId);
              lightbox.value = items.length ? { ...cur, items, index: Math.min(cur.index, items.length - 1) } : null;
            }}
          >
            <Icon name="trash" />
          </Button>
          {lb.fromGallery && !inThisChat && (
            <Button
              class="text-xs text-white hover:bg-glass"
              onClick={() => {
                close();
                modal.value = null;
                void openConversation(item.conversationId);
              }}
            >
              {t('lb.openChat')}
            </Button>
          )}
          <Button class="text-white hover:bg-glass" onClick={close} aria-label={t('lb.close')} data-dialog-close>
            <Icon name="x" />
          </Button>
        </div>
      </div>
      {editing && (
        <form
          class="mx-auto flex w-full max-w-2xl gap-2 px-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) void act(() => imageAction('edit', item.blobId, { prompt }));
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
            {t('lb.editSubmit')}
          </Button>
        </form>
      )}
      <div class="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={(e) => e.target === e.currentTarget && close()}>
        {url ? <img src={url} alt={promptText || t('lb.alt')} class="max-h-full max-w-full object-contain" /> : <Spinner class="size-6" />}
        {lb.items.length > 1 && (
          <>
            <button type="button" class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass" onClick={() => step(-1)} aria-label={t('lb.prev')}>
              <Icon name="chevron-left" />
            </button>
            <button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-glass p-2 hover:bg-glass" onClick={() => step(1)} aria-label={t('lb.next')}>
              <Icon name="chevron-right" />
            </button>
          </>
        )}
      </div>
      {promptText && <p class="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-white/70">{promptText}</p>}
    </div>
  );
}
