// The file manager in the main area: every file and image as cards or a list, with sorting,
// multi-select actions (use in chat / download / delete) and drag-and-drop upload
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { currentText } from '../../../lib/db/files';
import { getImage } from '../../../lib/db/images';
import { conversations, deleteImages, imagesVersion, lightbox, sidebarOpen } from '../../../state/app';
import { askConfirm } from '../../../components/ConfirmDialog';
import { confirmAndDelete, ImageThumb } from '../../../components/ImageView';
import { Button, Icon, Spinner, cx } from '../../../components/ui';
import { filterItems, previewText, sortItems, toItems, type FilerItem } from '../filer';
import {
  deleteFiles,
  downloadFile,
  fileList,
  filerConversation,
  filerPrefs,
  filerQuery,
  filerView,
  filesVersion,
  imageList,
  importFromDevice,
  importing,
  loadFilerPrefs,
  openFile,
  refreshFiles,
  refreshImages,
  setFilerPrefs,
  useInChat,
  type FilerSort,
  type FilerView
} from '../state';
import { formatChars, formatDate } from './common';

export const VIEW_LABEL: Record<FilerView, string> = { all: 'すべてのファイル', recent: '最近使ったもの', document: '文書', upload: '添付したファイル', image: '画像' };
const SORT_LABEL: Record<FilerSort, string> = { updated: '更新日', name: '名前', type: '種類', size: 'サイズ' };

const convTitle = (id?: string) => (id ? conversations.value.find((c) => c.id === id)?.title : undefined);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const sizeLabel = (it: FilerItem) => (it.type === 'image' ? formatBytes(it.size) : formatChars(it.size));
const typeText = (it: FilerItem) => (it.type === 'image' ? `画像 ${it.ext.toUpperCase()}` : it.ext.toUpperCase());

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
  return useMemo(() => (files && images ? toItems(files, images, convTitle) : null), [files, images, conversations.value]);
}

async function downloadItem(it: FilerItem) {
  if (it.type === 'file') return downloadFile(it.file);
  const blob = await getImage(it.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = it.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Filer() {
  useEffect(() => {
    void loadFilerPrefs();
  }, []);
  const all = useFilerItems();
  const prefs = filerPrefs.value;
  const view = filerView.value;
  const conv = filerConversation.value;
  const items = useMemo(() => (all ? sortItems(filterItems(all, { view, conversationId: conv, query: filerQuery.value }), prefs.sort) : null), [all, view, conv, filerQuery.value, prefs.sort]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Selection is per view
  useEffect(() => {
    setPicked(new Set());
    lastIndex.current = null;
  }, [view, conv, filerQuery.value]);
  // Drop picks that disappeared (deleted)
  useEffect(() => {
    if (!items || !picked.size) return;
    const keys = new Set(items.map((i) => i.key));
    if ([...picked].some((k) => !keys.has(k))) setPicked(new Set([...picked].filter((k) => keys.has(k))));
  }, [items]);

  const list = items ?? [];
  const selected = list.filter((i) => picked.has(i.key));
  const selectedFiles = selected.filter((i): i is Extract<FilerItem, { type: 'file' }> => i.type === 'file');
  const toggle = (i: number, range: boolean) => {
    const it = list[i];
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && lastIndex.current !== null) {
        const [a, b] = [Math.min(lastIndex.current, i), Math.max(lastIndex.current, i)];
        for (let k = a; k <= b; k++) next.add(list[k].key);
      } else if (next.has(it.key)) next.delete(it.key);
      else next.add(it.key);
      return next;
    });
    lastIndex.current = i;
  };
  const open = (it: FilerItem) => {
    if (it.type === 'file') return void openFile(it.id);
    const imgs = list.filter((x): x is Extract<FilerItem, { type: 'image' }> => x.type === 'image');
    lightbox.value = { items: imgs.map((x) => ({ blobId: x.id, conversationId: x.conversationId, messageId: x.messageId })), index: imgs.findIndex((x) => x.id === it.id), fromGallery: true };
  };
  const removeSelected = async () => {
    const fileIds = selected.filter((i) => i.type === 'file').map((i) => i.id);
    const imageIds = selected.filter((i) => i.type === 'image').map((i) => i.id);
    if (fileIds.length) {
      const ok = await askConfirm({
        title: `${selected.length} 件を削除`,
        message: `選んだ ${fileIds.length} 件のファイル（すべての版を含む）${imageIds.length ? `と ${imageIds.length} 枚の画像` : ''}を削除します。元に戻せません。`,
        confirmLabel: '削除',
        danger: true
      });
      if (!ok) return;
      await deleteFiles(fileIds);
      // Images go too (already confirmed above)
      if (imageIds.length) await deleteImages(imageIds);
    } else if (imageIds.length) {
      await confirmAndDelete(imageIds);
    }
    setPicked(new Set());
  };
  const anyPicked = picked.size > 0;

  return (
    <main
      class="relative flex min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        void importFromDevice([...e.dataTransfer.files]);
      }}
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Button class="md:hidden" aria-label="メニュー" onClick={() => (sidebarOpen.value = true)}>
          <Icon name="menu" />
        </Button>
        <h2 class="truncate text-base font-semibold">{VIEW_LABEL[view]}</h2>
        {conv && (
          <span class="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2 text-xs dark:bg-zinc-800">
            <Icon name="chat" class="size-3 shrink-0" />
            <span class="truncate">{convTitle(conv) ?? '削除された会話'}</span>
            <button type="button" class="rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700" aria-label="会話の絞り込みを外す" onClick={() => (filerConversation.value = null)}>
              <Icon name="x" class="size-3" />
            </button>
          </span>
        )}
        {items && <span class="text-xs text-zinc-500 tabular-nums">{items.length} 件</span>}
        <div class="ml-auto flex items-center gap-1">
          <label class="flex items-center gap-1 text-xs text-zinc-500">
            並び替え
            <select class="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950" value={prefs.sort} onChange={(e) => void setFilerPrefs({ sort: (e.target as HTMLSelectElement).value as FilerSort })}>
              {(Object.keys(SORT_LABEL) as FilerSort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div class="flex rounded-lg border border-zinc-300 dark:border-zinc-700" role="group" aria-label="表示の形">
            <button type="button" aria-pressed={prefs.layout === 'grid'} title="カードで表示" class={cx('rounded-l-lg px-2 py-1', prefs.layout === 'grid' && 'bg-zinc-200 dark:bg-zinc-800')} onClick={() => void setFilerPrefs({ layout: 'grid' })}>
              <Icon name="grid" class="size-4" />
            </button>
            <button type="button" aria-pressed={prefs.layout === 'list'} title="一覧で表示" class={cx('rounded-r-lg px-2 py-1', prefs.layout === 'list' && 'bg-zinc-200 dark:bg-zinc-800')} onClick={() => void setFilerPrefs({ layout: 'list' })}>
              <Icon name="list" class="size-4" />
            </button>
          </div>
          <Button variant="outline" class="py-1! text-sm" onClick={() => input.current?.click()} title="この端末のファイルを取り込む（テキスト・CSV・コード・PDF）">
            <Icon name="upload" />
            <span class="hidden sm:inline">アップロード</span>
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => {
              const el = e.target as HTMLInputElement;
              const files = [...(el.files ?? [])];
              el.value = '';
              if (files.length) void importFromDevice(files);
            }}
          />
        </div>
      </header>

      {anyPicked && (
        <div class="flex flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-sm dark:border-sky-900 dark:bg-sky-950/50" role="toolbar" aria-label="選んだ項目の操作">
          <button type="button" class="rounded p-1 hover:bg-sky-100 dark:hover:bg-sky-900" aria-label="選択を解除" onClick={() => setPicked(new Set())}>
            <Icon name="x" class="size-4" />
          </button>
          <span class="tabular-nums">{picked.size} 件を選択</span>
          <Button class="text-xs" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((i) => i.key)))}>
            {picked.size === list.length ? 'すべて解除' : 'すべて選択'}
          </Button>
          <div class="ml-auto flex flex-wrap items-center gap-1">
            <Button
              class="text-xs"
              disabled={!selectedFiles.length}
              title={selectedFiles.length === selected.length ? '入力欄に添付してチャットに戻る' : '画像は添付できません（ファイルだけを添付します）'}
              onClick={() => void useInChat(selectedFiles.map((f) => f.id))}
            >
              <Icon name="paperclip" class="size-3.5" />
              会話で使う
            </Button>
            <Button class="text-xs" onClick={() => void Promise.all(selected.map(downloadItem))}>
              <Icon name="download" class="size-3.5" />
              ダウンロード
            </Button>
            <Button class="text-xs text-rose-700 dark:text-rose-400" onClick={() => void removeSelected()}>
              <Icon name="trash" class="size-3.5" />
              削除
            </Button>
          </div>
        </div>
      )}

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {!items ? (
          <p class="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner class="size-4" />
            読み込んでいます
          </p>
        ) : items.length === 0 && !importing.value.length ? (
          <EmptyState view={view} filtered={!!conv || !!filerQuery.value.trim()} onUpload={() => input.current?.click()} />
        ) : prefs.layout === 'grid' ? (
          <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {importing.value.map((u) => (
              <div key={u.id} class="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
                <Spinner class="size-4" />
                <span class="max-w-full truncate px-2">{u.name}</span>
              </div>
            ))}
            {items.map((it, i) => (
              <Card key={it.key} it={it} picked={picked.has(it.key)} anyPicked={anyPicked} onToggle={(range) => toggle(i, range)} onOpen={() => open(it)} />
            ))}
          </div>
        ) : (
          <ListView items={items} picked={picked} onToggle={toggle} onOpen={open} onAll={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((i) => i.key)))} />
        )}
      </div>

      {dragging && (
        <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50/80 text-sm font-medium text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200">
          ドロップして取り込む（テキスト・CSV・コード・PDF）
        </div>
      )}
    </main>
  );
}

function EmptyState({ view, filtered, onUpload }: { view: FilerView; filtered: boolean; onUpload(): void }) {
  return (
    <div class="mx-auto mt-16 max-w-sm text-center text-sm text-zinc-500">
      <Icon name="files" class="mx-auto mb-3 size-8 text-zinc-400" />
      {filtered ? (
        <p>条件に合うものはありません。</p>
      ) : view === 'image' ? (
        <p>まだ画像はありません。入力欄の「画像」から作れます。</p>
      ) : (
        <>
          <p>まだファイルはありません。</p>
          <p class="mt-1">チャットで「〜をレポートにまとめて」と頼むか、ここにファイルをドロップしてください。</p>
          <Button variant="outline" class="mt-4" onClick={onUpload}>
            <Icon name="upload" />
            アップロード
          </Button>
        </>
      )}
    </div>
  );
}

function Checkbox({ checked, label, onToggle, class: cls }: { checked: boolean; label: string; onToggle(range: boolean): void; class?: string }) {
  return (
    <input
      type="checkbox"
      class={cx('size-4 cursor-pointer accent-sky-600', cls)}
      checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
    />
  );
}

function Card({ it, picked, anyPicked, onToggle, onOpen }: { it: FilerItem; picked: boolean; anyPicked: boolean; onToggle(range: boolean): void; onOpen(): void }) {
  const click = (e: MouseEvent) => {
    // While selecting, clicks select; Ctrl / Cmd / Shift-click selects too
    if (anyPicked || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      onToggle(e.shiftKey);
    } else onOpen();
  };
  return (
    <div class={cx('group relative flex flex-col overflow-hidden rounded-xl border bg-white transition dark:bg-zinc-900', picked ? 'border-sky-500 ring-2 ring-sky-500/50' : 'border-zinc-200 hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:hover:border-zinc-700')}>
      <Checkbox
        checked={picked}
        label={`${it.name} を選択`}
        onToggle={onToggle}
        class={cx('absolute top-2 left-2 z-10', !picked && !anyPicked && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}
      />
      {it.type === 'image' ? (
        <ImageThumb blobId={it.id} alt={it.name} class="aspect-[4/3] w-full rounded-none!" onOpen={() => (anyPicked ? onToggle(false) : onOpen())} />
      ) : (
        <button type="button" class="aspect-[4/3] w-full overflow-hidden bg-zinc-50 p-3 text-left dark:bg-zinc-950" onClick={click} aria-label={`${it.name} を開く`}>
          <pre class={cx('pointer-events-none font-sans text-[10px] leading-snug whitespace-pre-wrap text-zinc-500', (it.ext === 'csv' || it.ext === 'tsv' || it.ext === 'json') && 'font-mono')}>{previewText(currentText(it.file), it.ext)}</pre>
        </button>
      )}
      <button type="button" class="flex min-w-0 items-start gap-2 px-2.5 py-2 text-left" onClick={click}>
        <Icon name={it.type === 'image' ? 'image' : it.kind === 'upload' ? 'paperclip' : 'file'} class={cx('mt-0.5 size-4 shrink-0', it.type === 'image' ? 'text-fuchsia-600' : it.kind === 'upload' ? 'text-emerald-600' : 'text-sky-600')} />
        <span class="min-w-0">
          <span class="block truncate text-sm">{it.name}</span>
          <span class="block truncate text-xs text-zinc-500">
            {typeText(it)} · {formatDate(it.updatedAt)}
            {it.type === 'file' && it.file.versions.length > 1 ? ` · 版 ${it.file.versions[it.file.versions.length - 1].v}` : ''}
          </span>
        </span>
      </button>
    </div>
  );
}

function ListView({ items, picked, onToggle, onOpen, onAll }: { items: FilerItem[]; picked: Set<string>; onToggle(i: number, range: boolean): void; onOpen(it: FilerItem): void; onAll(): void }) {
  const all = items.length > 0 && items.every((i) => picked.has(i.key));
  return (
    <table class="w-full table-fixed text-sm">
      <thead class="text-left text-xs text-zinc-500">
        <tr class="border-b border-zinc-200 dark:border-zinc-800">
          <th class="w-8 py-2 pl-1">
            <input type="checkbox" class="size-4 accent-sky-600" checked={all} aria-label="すべて選択" onChange={onAll} />
          </th>
          <th class="py-2 font-medium">名前</th>
          <th class="hidden w-24 py-2 font-medium sm:table-cell">種類</th>
          <th class="hidden w-24 py-2 font-medium sm:table-cell">サイズ</th>
          <th class="w-24 py-2 font-medium">更新</th>
          <th class="hidden w-48 py-2 font-medium lg:table-cell">会話</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.key} class={cx('border-b border-zinc-100 dark:border-zinc-900', picked.has(it.key) ? 'bg-sky-50 dark:bg-sky-950/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900')}>
            <td class="py-1.5 pl-1">
              <Checkbox checked={picked.has(it.key)} label={`${it.name} を選択`} onToggle={(range) => onToggle(i, range)} />
            </td>
            <td class="py-1.5">
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-2 text-left"
                onClick={(e) => (picked.size || e.ctrlKey || e.metaKey || e.shiftKey ? onToggle(i, e.shiftKey) : onOpen(it))}
              >
                <Icon name={it.type === 'image' ? 'image' : it.kind === 'upload' ? 'paperclip' : 'file'} class={cx('size-4 shrink-0', it.type === 'image' ? 'text-fuchsia-600' : it.kind === 'upload' ? 'text-emerald-600' : 'text-sky-600')} />
                <span class="truncate">{it.name}</span>
              </button>
            </td>
            <td class="hidden py-1.5 text-xs text-zinc-500 sm:table-cell">{typeText(it)}</td>
            <td class="hidden py-1.5 text-xs text-zinc-500 tabular-nums sm:table-cell">{sizeLabel(it)}</td>
            <td class="py-1.5 text-xs text-zinc-500 tabular-nums">{formatDate(it.updatedAt)}</td>
            <td class="hidden truncate py-1.5 text-xs text-zinc-500 lg:table-cell">{convTitle(it.conversationId) ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

