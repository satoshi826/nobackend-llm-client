// The file manager in the main area: every file and image as cards or a list. The header holds the search and
// upload (selected items get their actions over it); the row under it the count, the filters in effect (the
// sidebar's Files panel is a set of shortcuts to them), the sort menu and the layout. Files can also be dropped
// anywhere on it.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { baseName, currentText } from '../../../lib/db/files';
import { getImage } from '../../../lib/db/images';
import { confirmAndDelete, deleteImages, ImageThumb, lightbox } from '../../images';
import { askConfirm } from '../../../components/ConfirmDialog';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Checkbox, Chip, EmptyState, Icon, IconButton, SearchField, Segmented, Spinner, cx, useDebounced, type IconName } from '../../../components/ui';
import { filterItems, NATURAL_ORDER, previewText, sortItems, type FilerItem } from '../filer';
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
  type FilerPrefs,
  type FilerSort,
  type FilerView
} from '../state';
import { formatChars, formatDate, PathName } from './common';
import { convTitle, useFilerItems, viewLabel, VIEW_ICONS } from './filer-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const SORT_KEYS = { updated: 'sort.updated', name: 'sort.name', type: 'sort.type', size: 'sort.size' } as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} KB`;
  return `${formatNumber(n / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

const sizeLabel = (it: FilerItem) => (it.type === 'image' ? formatBytes(it.size) : formatChars(it.size));
const kindIcon = (it: FilerItem): IconName => (it.type === 'image' && it.video ? 'video' : VIEW_ICONS[it.type === 'image' ? 'image' : it.kind]);

async function downloadItem(it: FilerItem) {
  if (it.type === 'file') return downloadFile(it.file);
  const blob = await getImage(it.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName(it.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Choosing a sort key starts it in its natural direction (newest, largest, A first); the same key turns it around */
function sortBy(k: FilerSort) {
  const p = filerPrefs.value;
  void setFilerPrefs(p.sort === k ? { order: p.order === 'asc' ? 'desc' : 'asc' } : { sort: k, order: NATURAL_ORDER[k] });
}

/**
 * Long press on touch screens starts selecting (there is no hover there to show the checks). consume() tells the
 * click that ends a long press not to open the item as well.
 */
function useLongPress(onLong: () => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        fired.current = false;
        if (e.pointerType !== 'touch') return;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          start.current = null;
          onLong();
        }, 450);
      },
      onPointerMove: (e: PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: Event) => {
        if (fired.current || start.current) e.preventDefault();
      }
    },
    consume: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    }
  };
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
  const items = useMemo(() => (all ? sortItems(filterItems(all, { view, conversationId: conv, query }), prefs.sort, prefs.order) : null), [all, view, conv, query, prefs.sort, prefs.order]);
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
  const toggleAll = () => setPicked(picked.size === list.length ? new Set() : new Set(list.map((i) => i.key)));
  const open = (it: FilerItem) => {
    if (it.type === 'file') return void openFile(it.id);
    const imgs = list.filter((x): x is Extract<FilerItem, { type: 'image' }> => x.type === 'image');
    lightbox.value = { items: imgs.map((x) => ({ blobId: x.id, conversationId: x.conversationId, messageId: x.messageId, name: x.name, video: x.video })), index: imgs.findIndex((x) => x.id === it.id), fromGallery: true };
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
  const selecting = picked.size > 0;

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
      <PageHeader>
          <SearchField class="min-w-0 flex-1 md:max-w-xs" placeholder={t('filer.search')} label={t('filer.searchLabel')} value={filerQuery.value} onInput={(v) => (filerQuery.value = v)} />
          <div class="ml-auto flex shrink-0 items-center gap-0.5">
            <Button variant="outline" class="py-1! text-sm" onClick={() => input.current?.click()} title={t('filer.uploadTitle')} aria-label={t('upload')}>
              <Icon name="upload" />
              <span class="hidden lg:inline">{t('upload')}</span>
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
        {selecting && (
          <div class="panel fade-in absolute inset-0 flex items-center gap-2 overflow-x-auto rounded-2xl px-2 text-sm whitespace-nowrap" role="toolbar" aria-label={t('filer.selectionActions')}>
            <IconButton label={t('filer.clearSelection')} onClick={() => setPicked(new Set())}>
              <Icon name="x" />
            </IconButton>
            <span class="tabular-nums">{t('filer.selected', { n: formatNumber(picked.size) })}</span>
            <Button class="text-xs" onClick={toggleAll} aria-label={picked.size === list.length ? t('filer.deselectAll') : t('filer.selectAll')}>
              <Icon name="check" class="size-3.5" />
              <span class="hidden sm:inline">{picked.size === list.length ? t('filer.deselectAll') : t('filer.selectAll')}</span>
            </Button>
            {selectedFiles.length < selected.length && <span class="hidden text-xs text-muted lg:inline">{t('filer.imagesNotAttachable')}</span>}
            <div class="ml-auto flex items-center gap-1">
              {/* On phones the actions are icons only, so all of them fit */}
              <Button class="text-xs" disabled={!selectedFiles.length} title={t('useInChatTitle')} aria-label={t('useInChat')} onClick={() => void useInChat(selectedFiles.map((f) => f.id))}>
                <Icon name="paperclip" class="size-3.5" />
                <span class="hidden sm:inline">{t('useInChat')}</span>
              </Button>
              <Button class="text-xs" title={t('download')} aria-label={t('download')} onClick={() => void Promise.all(selected.map(downloadItem))}>
                <Icon name="download" class="size-3.5" />
                <span class="hidden sm:inline">{t('download')}</span>
              </Button>
              <Button variant="danger" class="py-1! text-xs" title={t('delete')} aria-label={t('delete')} onClick={() => void removeSelected()}>
                <Icon name="trash" class="size-3.5" />
                <span class="hidden sm:inline">{t('delete')}</span>
              </Button>
            </div>
          </div>
        )}
      </PageHeader>
      <FilterChips count={items?.length ?? null}>
        {/* How the list is shown: under the header, so the search keeps its room on phones */}
        <SortMenu prefs={prefs} />
        <Segmented
          label={t('filer.layout')}
          items={[
            { id: 'grid', label: t('filer.grid'), icon: 'grid', iconOnly: true },
            { id: 'list', label: t('filer.list'), icon: 'list', iconOnly: true }
          ]}
          value={prefs.layout}
          onChange={(layout) => void setFilerPrefs({ layout })}
        />
      </FilterChips>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-4 sm:pb-4 md:pr-7 md:pl-1">
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
              <div key={u.id} class="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-line text-xs text-muted">
                <Spinner class="size-4" />
                <span class="max-w-full truncate px-2">{u.name}</span>
              </div>
            ))}
            {items.map((it, i) => (
              <Card key={it.key} it={it} picked={picked.has(it.key)} selecting={selecting} onToggle={(range) => toggle(i, range)} onOpen={() => open(it)} />
            ))}
          </div>
        ) : (
          <ListView items={items} prefs={prefs} picked={picked} onToggle={toggle} onOpen={open} onAll={toggleAll} />
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

/** A menu item that is one of several choices: a check marks the chosen one */
function Choice({ on, icon, onSelect, children }: { on: boolean; icon?: IconName; onSelect(): void; children: string }) {
  return (
    <MenuItem checked={on} onSelect={onSelect} icon={<Icon name="check" class={cx('mt-0.5 size-4 shrink-0', on ? 'text-ink-strong' : 'invisible')} />}>
      <span class="flex items-center gap-2">
        {icon && <Icon name={icon} class="size-4 shrink-0 text-muted" />}
        <span class="truncate">{children}</span>
      </span>
    </MenuItem>
  );
}

const MenuLabel = ({ children }: { children: string }) => <div class="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted">{children}</div>;

/** Sort key and direction */
function SortMenu({ prefs }: { prefs: FilerPrefs }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const label = t('sort.button', { key: t(SORT_KEYS[prefs.sort]), order: t(prefs.order === 'asc' ? 'sort.asc' : 'sort.desc') });
  return (
    <span ref={anchor}>
      <IconButton label={label} aria-haspopup="menu" aria-expanded={open} class={cx(open && 'bg-glass-strong')} onClick={() => setOpen(!open)}>
        <Icon name="sort" />
      </IconButton>
      {open && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)} placement="bottom-end" label={t('filer.sort')} class="w-52">
          <MenuLabel>{t('filer.sort')}</MenuLabel>
          {(Object.keys(SORT_KEYS) as FilerSort[]).map((k) => (
            <Choice key={k} on={prefs.sort === k} onSelect={() => prefs.sort !== k && sortBy(k)}>
              {t(SORT_KEYS[k])}
            </Choice>
          ))}
          <MenuSeparator />
          <MenuLabel>{t('sort.order')}</MenuLabel>
          <Choice on={prefs.order === 'asc'} onSelect={() => void setFilerPrefs({ order: 'asc' })}>
            {t('sort.asc')}
          </Choice>
          <Choice on={prefs.order === 'desc'} onSelect={() => void setFilerPrefs({ order: 'desc' })}>
            {t('sort.desc')}
          </Choice>
        </Popover>
      )}
    </span>
  );
}

/**
 * How many items are shown and the filters in effect (the header has no title, so they are shown here), with the
 * controls for how the list is shown (children) at the right end
 */
function FilterChips({ count, children }: { count: number | null; children: ComponentChildren }) {
  const view = filerView.value;
  const conv = filerConversation.value;
  return (
    <div class="mx-3 flex min-h-11 flex-wrap items-center gap-1.5 pt-3 pb-3 sm:mx-4 md:mr-7 md:ml-1">
      <span class="px-1 text-xs text-muted tabular-nums">{count === null ? '' : count === 1 ? t('filer.countOne') : t('filer.count', { n: formatNumber(count) })}</span>
      {view !== 'all' && (
        <Chip on class="h-7! pr-2!" aria-label={t('filter.remove', { name: viewLabel(view) })} onClick={() => (filerView.value = 'all')}>
          <Icon name={VIEW_ICONS[view]} class="size-3.5" />
          {viewLabel(view)}
          <Icon name="x" class="size-3.5 text-muted" />
        </Chip>
      )}
      {conv && (
        <Chip on class="h-7! max-w-[16rem] pr-2!" aria-label={t('filter.remove', { name: convTitle(conv) ?? t('deletedConversation') })} onClick={() => (filerConversation.value = null)}>
          <Icon name="chat" class="size-3.5 shrink-0" />
          <span class="truncate">{convTitle(conv) ?? t('deletedConversation')}</span>
          <Icon name="x" class="size-3.5 shrink-0 text-muted" />
        </Chip>
      )}
      <div class="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
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

function Card({ it, picked, selecting, onToggle, onOpen }: { it: FilerItem; picked: boolean; selecting: boolean; onToggle(range: boolean): void; onOpen(): void }) {
  const press = useLongPress(() => onToggle(false));
  const click = (e: MouseEvent) => {
    if (press.consume()) return;
    // While selecting, clicks select; Ctrl / Cmd / Shift-click selects too
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      onToggle(e.shiftKey);
    } else onOpen();
  };
  return (
    <div
      class={cx(
        'lift group relative flex flex-col overflow-hidden rounded-[18px] border bg-glass select-none [-webkit-touch-callout:none]',
        picked ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong'
      )}
      {...press.handlers}
    >
      {/* The selection mark: under the pointer, or while selecting (on touch screens a long press starts it) */}
      <Checkbox
        round
        checked={picked}
        label={t('filer.select', { name: it.name })}
        onChange={(_, e) => onToggle(e.shiftKey)}
        class={cx('absolute top-2 left-2 z-10', !picked && !selecting && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden')}
      />
      <div class="relative">
        {it.type === 'image' ? (
          <>
            <ImageThumb blobId={it.id} alt={it.name} class="aspect-[4/3] w-full rounded-none!" onOpen={() => (press.consume() ? undefined : selecting ? onToggle(false) : onOpen())} />
            {it.video && (
              <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="grid size-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm">
                  <Icon name="play" class="size-4" />
                </span>
              </span>
            )}
          </>
        ) : (
          <button type="button" class="block aspect-[4/3] w-full overflow-hidden bg-sunken px-3 pt-3 text-left" onClick={click} aria-label={t('filer.openItem', { name: it.name })}>
            <pre
              class={cx(
                'pointer-events-none h-full overflow-hidden text-[11px] leading-snug whitespace-pre-wrap text-muted [overflow-wrap:anywhere] [mask-image:linear-gradient(to_bottom,black_55%,transparent)]',
                it.ext === 'md' || it.ext === 'txt' ? 'font-sans' : 'font-mono'
              )}
            >
              {previewText(currentText(it.file), it.ext)}
            </pre>
          </button>
        )}
        <span class="pointer-events-none absolute top-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur-sm">{it.ext || 'txt'}</span>
      </div>
      <button type="button" class="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left" onClick={click}>
        <Icon name={kindIcon(it)} class="mt-0.5 size-4 shrink-0 text-muted" />
        <span class="min-w-0">
          <span class="line-clamp-2 text-sm leading-snug text-ink-strong [overflow-wrap:anywhere]">
            <PathName name={it.name} />
          </span>
          <span class="mt-0.5 block truncate text-xs text-muted tabular-nums">
            {sizeLabel(it)} · {formatDate(it.updatedAt)}
            {it.type === 'file' && it.file.history.length ? ` · ${t('version', { v: it.file.current.v })}` : ''}
          </span>
        </span>
      </button>
    </div>
  );
}

/** A column heading that sorts by its key (the same state as the sort menu) */
function SortHead({ k, prefs, class: cls }: { k: FilerSort; prefs: FilerPrefs; class?: string }) {
  const on = prefs.sort === k;
  return (
    <th class={cx('py-2 font-medium', cls)} aria-sort={on ? (prefs.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" class={cx('-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-glass-strong hover:text-ink', on && 'text-ink')} onClick={() => sortBy(k)}>
        {t(SORT_KEYS[k])}
        {on && <Icon name="chevron-down" class={cx('size-3 transition-transform', prefs.order === 'asc' && 'rotate-180')} />}
      </button>
    </th>
  );
}

function ListRow({ it, picked, selecting, onToggle, onOpen }: { it: FilerItem; picked: boolean; selecting: boolean; onToggle(range: boolean): void; onOpen(): void }) {
  const press = useLongPress(() => onToggle(false));
  return (
    <tr class={cx('border-b border-line select-none [-webkit-touch-callout:none]', picked ? 'bg-accent-soft' : 'hover:bg-glass')} {...press.handlers}>
      <td class="py-1.5 pl-1">
        <Checkbox checked={picked} label={t('filer.select', { name: it.name })} onChange={(_, e) => onToggle(e.shiftKey)} />
      </td>
      <td class="py-1.5">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-ink-strong"
          onClick={(e) => (press.consume() ? undefined : selecting || e.ctrlKey || e.metaKey || e.shiftKey ? onToggle(e.shiftKey) : onOpen())}
        >
          <Icon name={kindIcon(it)} class="size-4 shrink-0 text-muted" />
          <span class="truncate">
            <PathName name={it.name} />
          </span>
        </button>
      </td>
      <td class="hidden py-1.5 text-xs text-muted uppercase sm:table-cell">{it.ext}</td>
      <td class="hidden py-1.5 text-xs text-muted tabular-nums sm:table-cell">{sizeLabel(it)}</td>
      <td class="py-1.5 text-xs text-muted tabular-nums">{formatDate(it.updatedAt)}</td>
      <td class="hidden truncate py-1.5 text-xs text-muted lg:table-cell">{convTitle(it.conversationId) ?? ''}</td>
    </tr>
  );
}

function ListView({ items, prefs, picked, onToggle, onOpen, onAll }: { items: FilerItem[]; prefs: FilerPrefs; picked: Set<string>; onToggle(i: number, range: boolean): void; onOpen(it: FilerItem): void; onAll(): void }) {
  const all = items.length > 0 && items.every((i) => picked.has(i.key));
  return (
    <table class="w-full table-fixed text-sm">
      <thead class="text-left text-xs text-muted">
        <tr class="border-b border-line">
          <th class="w-8 py-2 pl-1">
            <Checkbox checked={all} label={t('filer.selectAll')} onChange={onAll} />
          </th>
          <SortHead k="name" prefs={prefs} />
          <SortHead k="type" prefs={prefs} class="hidden w-20 sm:table-cell" />
          <SortHead k="size" prefs={prefs} class="hidden w-24 sm:table-cell" />
          <SortHead k="updated" prefs={prefs} class="w-24" />
          <th class="hidden w-48 py-2 font-medium lg:table-cell">{t('filer.colConversation')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <ListRow key={it.key} it={it} picked={picked.has(it.key)} selecting={picked.size > 0} onToggle={(range) => onToggle(i, range)} onOpen={() => onOpen(it)} />
        ))}
      </tbody>
    </table>
  );
}
