// The file manager in the main area: every file and image as cards or a list, with sorting,
// multi-select actions (use in chat / download / delete) and drag-and-drop upload
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { currentText } from '../../../lib/db/files';
import { getImage } from '../../../lib/db/images';
import { sidebarOpen } from '../../../state/ui';
import { confirmAndDelete, deleteImages, ImageThumb, lightbox } from '../../images';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Button, EmptyState, Icon, IconButton, Segmented, Select, Spinner, cx, useDebounced } from '../../../components/ui';
import { filterItems, previewText, sortItems, type FilerItem } from '../filer';
import {
  deleteFiles,
  downloadFile,
  filerConversation,
  filerPrefs,
  filerQuery,
  filerView,
  importFromDevice,
  importing,
  loadFilerPrefs,
  openFile,
  setFilerPrefs,
  useInChat,
  type FilerSort,
  type FilerView
} from '../state';
import { formatChars, formatDate } from './common';
import { convTitle, useFilerItems, viewLabel } from './filer-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const SORT_KEYS = { updated: 'sort.updated', name: 'sort.name', type: 'sort.type', size: 'sort.size' } as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} KB`;
  return `${formatNumber(n / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

const sizeLabel = (it: FilerItem) => (it.type === 'image' ? formatBytes(it.size) : formatChars(it.size));
const typeText = (it: FilerItem) => (it.type === 'image' ? t('filer.imageType', { ext: it.ext.toUpperCase() }) : it.ext.toUpperCase());

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
  // Searching reads file contents: wait until typing pauses
  const query = useDebounced(filerQuery.value, 150);
  const items = useMemo(() => (all ? sortItems(filterItems(all, { view, conversationId: conv, query }), prefs.sort) : null), [all, view, conv, query, prefs.sort]);
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
        title: selected.length === 1 ? t('filer.deleteTitleOne') : t('filer.deleteTitle', { n: formatNumber(selected.length) }),
        message: imageIds.length ? t('filer.confirmFilesImages', { files: formatNumber(fileIds.length), images: formatNumber(imageIds.length) }) : t('filer.confirmFiles', { files: formatNumber(fileIds.length) }),
        confirmLabel: t('delete'),
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
      {/* While items are selected, their actions cover the header (no layout shift under the pointer) */}
      <div class="relative mx-2 mt-2 sm:mx-3 md:ml-0 md:mr-3 md:mt-0">
        <header class="glass flex min-h-12 flex-wrap items-center gap-2 rounded-2xl px-3 py-1.5">
          <IconButton class="md:hidden" label={t('menu')} onClick={() => (sidebarOpen.value = true)}>
            <Icon name="menu" />
          </IconButton>
          <h2 class="truncate px-1 text-sm font-medium text-ink-strong">{viewLabel(view)}</h2>
          {conv && (
            <span class="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-glass-strong py-0.5 pr-1 pl-2 text-xs">
              <Icon name="chat" class="size-3 shrink-0" />
              <span class="truncate">{convTitle(conv) ?? t('deletedConversation')}</span>
              <button type="button" class="rounded-full p-0.5 hover:bg-glass-strong" aria-label={t('filer.clearConversation')} title={t('filer.clearConversation')} onClick={() => (filerConversation.value = null)}>
                <Icon name="x" class="size-3" />
              </button>
            </span>
          )}
          {items && <span class="text-xs text-muted tabular-nums">{items.length === 1 ? t('filer.countOne') : t('filer.count', { n: formatNumber(items.length) })}</span>}
          <div class="ml-auto flex items-center gap-1">
            <label class="flex items-center gap-1 text-xs text-muted">
              {t('filer.sort')}
              <Select compact value={prefs.sort} onChange={(e) => void setFilerPrefs({ sort: (e.target as HTMLSelectElement).value as FilerSort })}>
                {(Object.keys(SORT_KEYS) as FilerSort[]).map((k) => (
                  <option key={k} value={k}>
                    {t(SORT_KEYS[k])}
                  </option>
                ))}
              </Select>
            </label>
            <Segmented
              label={t('filer.layout')}
              items={[
                { id: 'grid', label: t('filer.grid'), icon: 'grid', iconOnly: true },
                { id: 'list', label: t('filer.list'), icon: 'list', iconOnly: true }
              ]}
              value={prefs.layout}
              onChange={(layout) => void setFilerPrefs({ layout })}
            />
            <Button variant="outline" class="py-1! text-sm" onClick={() => input.current?.click()} title={t('filer.uploadTitle')}>
              <Icon name="upload" />
              <span class="hidden sm:inline">{t('upload')}</span>
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
          <div class="panel fade-in absolute inset-0 flex items-center gap-2 overflow-x-auto rounded-2xl px-3 text-sm whitespace-nowrap" role="toolbar" aria-label={t('filer.selectionActions')}>
            <button type="button" class="rounded-lg p-1 hover:bg-glass-strong" aria-label={t('filer.clearSelection')} title={t('filer.clearSelection')} onClick={() => setPicked(new Set())}>
              <Icon name="x" class="size-4" />
            </button>
            <span class="tabular-nums">{t('filer.selected', { n: formatNumber(picked.size) })}</span>
            {selectedFiles.length < selected.length && <span class="text-xs text-muted">{t('filer.imagesNotAttachable')}</span>}
            <Button class="text-xs" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((i) => i.key)))}>
              {picked.size === list.length ? t('filer.deselectAll') : t('filer.selectAll')}
            </Button>
            <div class="ml-auto flex items-center gap-1">
              <Button
                class="text-xs"
                disabled={!selectedFiles.length}
                title={t('useInChatTitle')}
                onClick={() => void useInChat(selectedFiles.map((f) => f.id))}
              >
                <Icon name="paperclip" class="size-3.5" />
                {t('useInChat')}
              </Button>
              <Button class="text-xs" onClick={() => void Promise.all(selected.map(downloadItem))}>
                <Icon name="download" class="size-3.5" />
                {t('download')}
              </Button>
              <Button variant="danger" class="py-1! text-xs" onClick={() => void removeSelected()}>
                <Icon name="trash" class="size-3.5" />
                {t('delete')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:pr-7">
        {!items ? (
          <p class="flex items-center gap-2 text-sm text-muted">
            <Spinner class="size-4" />
            {t('loading')}
          </p>
        ) : items.length === 0 && !importing.value.length ? (
          <FilerEmpty view={view} filtered={!!conv || !!filerQuery.value.trim()} onUpload={() => input.current?.click()} />
        ) : prefs.layout === 'grid' ? (
          <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {importing.value.map((u) => (
              <div key={u.id} class="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-xs text-muted">
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
        <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-[22px] border-2 border-dashed border-accent bg-accent-soft text-sm font-medium text-ink-strong backdrop-blur-sm">
          {t('filer.drop')}
        </div>
      )}
    </main>
  );
}

function FilerEmpty({ view, filtered, onUpload }: { view: FilerView; filtered: boolean; onUpload(): void }) {
  return (
    <EmptyState icon={filtered ? 'search' : view === 'image' ? 'image' : 'files'} class="mx-auto mt-16 max-w-sm">
      {filtered ? (
        <p>{t('empty.filtered')}</p>
      ) : view === 'image' ? (
        <p>{t('empty.images')}</p>
      ) : (
        <>
          <p>{t('empty.files')}</p>
          <p class="mt-1">{t('empty.hint')}</p>
          <Button variant="outline" class="mt-4" onClick={onUpload}>
            <Icon name="upload" />
            {t('upload')}
          </Button>
        </>
      )}
    </EmptyState>
  );
}

/**
 * A selection checkbox. The browser toggles it on click and our state decides the result (a Shift-click
 * selects a range, which can keep it checked), so the DOM is synced to the state after every render.
 * No preventDefault: cancelling a checkbox click makes the browser revert it after our update.
 */
function Checkbox({ checked, label, onToggle, class: cls }: { checked: boolean; label: string; onToggle(range: boolean): void; class?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current && ref.current.checked !== checked) ref.current.checked = checked;
  });
  return (
    <input
      ref={ref}
      type="checkbox"
      class={cx('size-4 cursor-pointer accent-accent', cls)}
      checked={checked}
      aria-label={label}
      onClick={(e) => {
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
    <div class={cx('lift group relative flex flex-col overflow-hidden rounded-[18px] border bg-glass', picked ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong')}>
      <Checkbox
        checked={picked}
        label={t('filer.select', { name: it.name })}
        onToggle={onToggle}
        class={cx('absolute top-2 left-2 z-10', !picked && !anyPicked && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}
      />
      {it.type === 'image' ? (
        <ImageThumb blobId={it.id} alt={it.name} class="aspect-[4/3] w-full rounded-none!" onOpen={() => (anyPicked ? onToggle(false) : onOpen())} />
      ) : (
        <button type="button" class="aspect-[4/3] w-full overflow-hidden bg-sunken p-3 text-left" onClick={click} aria-label={t('filer.openItem', { name: it.name })}>
          <pre class={cx('pointer-events-none font-sans text-[10px] leading-snug whitespace-pre-wrap text-muted', (it.ext === 'csv' || it.ext === 'tsv' || it.ext === 'json') && 'font-mono')}>{previewText(currentText(it.file), it.ext)}</pre>
        </button>
      )}
      <button type="button" class="flex min-w-0 items-start gap-2 px-2.5 py-2 text-left" onClick={click}>
        <Icon name={it.type === 'image' ? 'image' : it.kind === 'upload' ? 'paperclip' : 'file'} class="mt-0.5 size-4 shrink-0 text-muted" />
        <span class="min-w-0">
          <span class="block truncate text-sm text-ink-strong">{it.name}</span>
          <span class="block truncate text-xs text-muted">
            {typeText(it)} · {formatDate(it.updatedAt)}
            {it.type === 'file' && it.file.versions.length > 1 ? ` · ${t('version', { v: it.file.versions[it.file.versions.length - 1].v })}` : ''}
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
      <thead class="text-left text-xs text-muted">
        <tr class="border-b border-line">
          <th class="w-8 py-2 pl-1">
            <input type="checkbox" class="size-4 accent-accent" checked={all} aria-label={t('filer.selectAll')} onChange={onAll} />
          </th>
          <th class="py-2 font-medium">{t('sort.name')}</th>
          <th class="hidden w-24 py-2 font-medium sm:table-cell">{t('sort.type')}</th>
          <th class="hidden w-24 py-2 font-medium sm:table-cell">{t('sort.size')}</th>
          <th class="w-24 py-2 font-medium">{t('filer.colUpdated')}</th>
          <th class="hidden w-48 py-2 font-medium lg:table-cell">{t('filer.colConversation')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.key} class={cx('border-b border-line', picked.has(it.key) && 'bg-accent-soft')}>
            <td class="py-1.5 pl-1">
              <Checkbox checked={picked.has(it.key)} label={t('filer.select', { name: it.name })} onToggle={(range) => onToggle(i, range)} />
            </td>
            <td class="py-1.5">
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-ink-strong hover:underline"
                onClick={(e) => (picked.size || e.ctrlKey || e.metaKey || e.shiftKey ? onToggle(i, e.shiftKey) : onOpen(it))}
              >
                <Icon name={it.type === 'image' ? 'image' : it.kind === 'upload' ? 'paperclip' : 'file'} class="size-4 shrink-0 text-muted" />
                <span class="truncate">{it.name}</span>
              </button>
            </td>
            <td class="hidden py-1.5 text-xs text-muted sm:table-cell">{typeText(it)}</td>
            <td class="hidden py-1.5 text-xs text-muted tabular-nums sm:table-cell">{sizeLabel(it)}</td>
            <td class="py-1.5 text-xs text-muted tabular-nums">{formatDate(it.updatedAt)}</td>
            <td class="hidden truncate py-1.5 text-xs text-muted lg:table-cell">{convTitle(it.conversationId) ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

