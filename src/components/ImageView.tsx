// Images: thumbnails in answers and the full-size viewer (with upscale / edit / background removal).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from './dialog';
import type { ImageParams, MessageRecord } from '../lib/db/schema';
import { estimateImageCost } from '../lib/images/venice';
import type { Part } from '../lib/providers/types';
import { getImage } from '../lib/db/images';
import {
  currentId,
  deleteImages,
  imageAction,
  imageModelOf,
  imageReady,
  isStreaming,
  lightbox,
  messages,
  modal,
  openConversation,
  regenerateImage,
  retryWithSuggestion,
  showToast,
  type LightboxItem
} from '../state/app';
import { Button, Icon, Shimmer, Spinner, cx } from './ui';
import { askConfirm } from './ConfirmDialog';

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
    title: ids.length > 1 ? `${ids.length} 枚の画像を削除` : '画像を削除',
    message: '画像を削除します。元に戻せません。会話には「画像は削除されました」と残ります。',
    confirmLabel: '削除',
    danger: true
  });
  if (!ok) return false;
  await deleteImages(ids);
  releaseImageUrls(ids);
  showToast(ids.length > 1 ? `${ids.length} 枚の画像を削除しました` : '画像を削除しました');
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
    <button type="button" class={cx('group relative overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800', className)} onClick={onOpen} aria-label={`${alt} を拡大`}>
      {url ? (
        <img src={url} alt={alt} class="h-full w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" decoding="async" />
      ) : url === null ? (
        <span class="grid h-full w-full place-items-center text-xs text-zinc-400">画像を読み込めません</span>
      ) : (
        <span class="grid h-full w-full place-items-center">
          <Spinner class="size-4 text-zinc-400" />
        </span>
      )}
    </button>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span class="tabular-nums">{Math.max(0, Math.round((now - since) / 1000))} 秒</span>;
}

const OP_LABEL = { generate: '画像を生成しています', upscale: '高解像度化しています', edit: '画像を編集しています', 'remove-bg': '背景を除去しています' } as const;

/** An image answer: progress, thumbnails, details, errors and retry options */
export function ImageAnswer({ m }: { m: MessageRecord }) {
  const img = m.image!;
  const p = img.params;
  const files = m.parts.filter((x): x is FilePart => x.type === 'file');
  const items: LightboxItem[] = files.map((f) => ({ blobId: f.blobId, conversationId: m.conversationId, messageId: m.id }));
  const model = imageModelOf(p.model);
  if (m.status === 'streaming')
    return (
      <div class="flex items-center gap-2 text-sm text-zinc-500" role="status">
        <Spinner class="size-4" />
        <Shimmer>{OP_LABEL[p.op]}</Shimmer>
        <Elapsed since={m.createdAt} />
      </div>
    );
  return (
    <div class="space-y-2">
      {m.status === 'done' && files.length === 0 && <p class="text-sm text-zinc-500">（画像は削除されました）</p>}
      {files.length > 0 && (
        <div class={cx('grid gap-2', files.length === 1 ? 'max-w-md grid-cols-1' : 'max-w-xl grid-cols-2')}>
          {files.map((f, i) => (
            <ImageThumb
              key={f.blobId}
              blobId={f.blobId}
              alt={`生成した画像 ${i + 1}`}
              class={files.length === 1 ? 'aspect-auto max-h-[28rem]' : 'aspect-square'}
              onOpen={() => (lightbox.value = { items, index: i })}
            />
          ))}
        </div>
      )}
      {m.status === 'done' && (
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          {p.op === 'generate' ? <span>{model?.name ?? p.model}</span> : <span>{p.op === 'upscale' ? `高解像度化 ${p.scale ?? 2}×` : p.op === 'edit' ? '編集' : '背景を除去'}</span>}
          {files[0]?.width && (
            <span class="tabular-nums">
              {files[0].width}×{files[0].height}
            </span>
          )}
          {img.seed !== undefined && <span class="tabular-nums">seed {img.seed}</span>}
          {p.style && <span>{p.style}</span>}
          {img.blurred && <span class="text-amber-700 dark:text-amber-400">セーフモードでぼかされています</span>}
          {!!img.violations && <span class="text-amber-700 dark:text-amber-400">ポリシーにより {img.violations} 枚は出力されませんでした</span>}
        </div>
      )}
      {img.enhancedPrompt && (
        <details class="text-xs text-zinc-500">
          <summary class="cursor-pointer">補強されたプロンプト</summary>
          <p class="mt-1 whitespace-pre-wrap">{img.enhancedPrompt}</p>
        </details>
      )}
      {m.status === 'done' && p.op === 'generate' && (
        <div class="flex flex-wrap gap-1.5">
          <Button class="text-xs" disabled={isStreaming.value} onClick={() => void regenerateImage(m.id, 'same')} title="同じシードで、もう一度作ります">
            <Icon name="refresh" class="size-3.5" />
            同じ設定でもう一度
          </Button>
          <Button class="text-xs" disabled={isStreaming.value} onClick={() => void regenerateImage(m.id, 'new')} title="シードを変えて、似た画像を作ります">
            <Icon name="sparkle" class="size-3.5" />
            似た画像を作る
          </Button>
        </div>
      )}
      {img.suggestion && m.status === 'error' && (
        <div class="flex flex-wrap gap-1.5">
          {img.suggestion.prompt && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void retryWithSuggestion(m.id, 'prompt')} title={img.suggestion.prompt}>
              提案されたプロンプトで再試行
            </Button>
          )}
          {img.suggestion.model && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void retryWithSuggestion(m.id, 'model')}>
              {img.suggestion.model} で再試行
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
        <ImageThumb key={id} blobId={id} alt={`生成した画像 ${i + 1}`} class={blobIds.length === 1 ? 'max-h-[28rem]' : 'aspect-square'} onOpen={() => (lightbox.value = { items, index: i })} />
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
    <div ref={rootRef} class="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label="画像の表示" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="flex items-center gap-1 p-2">
        <span class="px-2 text-sm text-white/70 tabular-nums">
          {lb.index + 1} / {lb.items.length}
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <Button class="text-white hover:bg-white/10" onClick={download} aria-label="ダウンロード" title="ダウンロード">
            <Icon name="download" />
          </Button>
          {promptText && (
            <Button
              class="text-white hover:bg-white/10"
              aria-label="プロンプトをコピー"
              title="プロンプトをコピー"
              onClick={() => void navigator.clipboard.writeText(promptText).then(() => showToast('プロンプトをコピーしました'))}
            >
              <Icon name="copy" />
            </Button>
          )}
          {imageReady.value && (
            <>
              <Button class="text-xs text-white hover:bg-white/10" disabled={isStreaming.value} title={`高解像度化（2 倍、約 $${estimateImageCost({ ...OP_BASE, op: 'upscale', scale: 2 }, undefined)?.toFixed(2)}）`} onClick={() => void act(() => imageAction('upscale', item.blobId, { scale: 2 }))}>
                <Icon name="expand" class="size-4" />
                2×
              </Button>
              <Button class="text-xs text-white hover:bg-white/10" disabled={isStreaming.value} title={`高解像度化（4 倍、約 $${estimateImageCost({ ...OP_BASE, op: 'upscale', scale: 4 }, undefined)?.toFixed(2)}）`} onClick={() => void act(() => imageAction('upscale', item.blobId, { scale: 4 }))}>
                4×
              </Button>
              <Button class="text-xs text-white hover:bg-white/10" disabled={isStreaming.value} title="背景を除去（費用不明）" onClick={() => void act(() => imageAction('remove-bg', item.blobId))}>
                <Icon name="scissors" class="size-4" />
                背景を除去
              </Button>
              <Button class="text-xs text-white hover:bg-white/10" disabled={isStreaming.value} aria-pressed={editing} title={`指示で編集（約 $${estimateImageCost({ ...OP_BASE, op: 'edit' }, undefined)?.toFixed(2)}）`} onClick={() => setEditing(!editing)}>
                <Icon name="wand" class="size-4" />
                編集
              </Button>
            </>
          )}
          <Button
            class="text-white hover:bg-white/10"
            aria-label="この画像を削除"
            title="この画像を削除"
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
              class="text-xs text-white hover:bg-white/10"
              onClick={() => {
                close();
                modal.value = null;
                void openConversation(item.conversationId);
              }}
            >
              会話を開く
            </Button>
          )}
          <Button class="text-white hover:bg-white/10" onClick={close} aria-label="閉じる" data-dialog-close>
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
            class="min-w-0 flex-1 rounded-lg border border-white/30 bg-black/50 px-3 py-1.5 text-sm text-white placeholder:text-white/50"
            placeholder="どう変えるか（例: 背景を夕焼けにする）"
            value={prompt}
            onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
            aria-label="編集の指示"
          />
          <Button variant="primary" type="submit" disabled={!prompt.trim()}>
            編集する
          </Button>
        </form>
      )}
      <div class="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={(e) => e.target === e.currentTarget && close()}>
        {url ? <img src={url} alt={promptText || '画像'} class="max-h-full max-w-full object-contain" /> : <Spinner class="size-6" />}
        {lb.items.length > 1 && (
          <>
            <button type="button" class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={() => step(-1)} aria-label="前の画像">
              <Icon name="chevron-left" />
            </button>
            <button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={() => step(1)} aria-label="次の画像">
              <Icon name="chevron-right" />
            </button>
          </>
        )}
      </div>
      {promptText && <p class="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-white/70">{promptText}</p>}
    </div>
  );
}
