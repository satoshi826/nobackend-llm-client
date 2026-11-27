// The file manager in the main area, in one of three ways the sidebar chooses: by folder (the folders inside the open
// one first, then what sits right in it), by type, or by chat (everything of that kind, wherever it is). The header
// holds the search and upload (selected entries get their actions over it); the row under it the count, the open
// folder's path, the filters in effect, the sort menu and the layout. Every entry has a menu ("…", or a right click);
// entries can be dragged onto a folder, and files from the device dropped anywhere (into the open folder).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { baseName, cleanFolderName, folderOf, isInside, pathKey } from '../../../lib/paths';
import { confirmAndDelete, ImageThumb } from '../../images';
import { askConfirm } from '../../../components/ConfirmDialog';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { FilesHeader } from './FilesHeader';
import { openConversation } from '../../../state/conversations';
import { Button, Checkbox, EmptyState, Icon, IconButton, Modal, Segmented, Spinner, TextField, cx, useDebounced, type IconName } from '../../../components/ui';
import { allFolders, filterItems, foldersIn, NATURAL_ORDER, previewText, sortItems, type FilerItem, type FolderItem } from '../filer';
import {
  chatInFolder,
  createFolder,
  downloadFile,
  downloadImage,
  filerConversation,
  filerFolder,
  filerPrefs,
  filerQuery,
  filerView,
  importFromDevice,
  importing,
  loadFilerPrefs,
  moveEntries,
  newFolders,
  openFile,
  openImage,
  openFolder,
  renameFolder,
  planRemoval,
  removeEntries,
  renameItem,
  searchContents,
  setFilerPrefs,
  attachToChat,
  type FilerPrefs,
  type FilerSort,
  type FilerView
} from '../state';
import { ActionMenu, Crumb, formatBytes, formatDate, PathName, SubBar, type MenuAction } from './common';
import { convTitle, useFilerItems, viewLabel, VIEW_ICONS } from './filer-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const SORT_KEYS = { updated: 'sort.updated', name: 'sort.name', type: 'sort.type', size: 'sort.size' } as const;
/** What an entry dragged inside the file manager carries: the keys of the entries it moves */
const DRAG_TYPE = 'application/x-filer-entries';
/** The list before it has loaded: one array, so what is made from it is not made again each time */
const NO_ITEMS: FilerItem[] = [];
/** Entries drawn at first, and added each time the list scrolls near its end */
const BATCH = 120;

const kindIcon = (it: FilerItem): IconName => (it.type === 'image' && it.video ? 'video' : VIEW_ICONS[it.type === 'image' ? 'image' : it.kind]);
const folderKey = (f: FolderItem) => `d:${f.path}`;

const downloadItem = (it: FilerItem) => (it.type === 'file' ? downloadFile(it.file) : downloadImage(it.id, it.name));

/** Choosing a sort key starts it in its natural direction (newest, largest, A first); the same key turns it around */
function sortBy(k: FilerSort) {
  const p = filerPrefs.value;
  void setFilerPrefs(p.sort === k ? { order: p.order === 'asc' ? 'desc' : 'asc' } : { sort: k, order: NATURAL_ORDER[k] });
}

/** Folders in the order the items are sorted in: by name, or by when something in them last changed */
function sortFolders(folders: FolderItem[], prefs: FilerPrefs): FolderItem[] {
  const dir = prefs.order === 'asc' ? 1 : -1;
  return [...folders].sort((a, b) => (prefs.sort === 'updated' ? (a.updatedAt - b.updatedAt) * dir : a.name.localeCompare(b.name) * (prefs.sort === 'name' ? dir : 1)));
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
      onPointerLeave: cancel
    },
    /** A long press already happened: the browser's own menu stays shut */
    pressed: () => fired.current || !!start.current,
    consume: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    }
  };
}

/** One line of an entry's menu */
/** What the file manager can do with entries, handed to each of them */
/**
 * What the file manager can do with entries. One object for the screen's life (its methods reach the latest state),
 * so entries that did not change are not drawn again
 */
interface EntryApi {
  /** The menu of an entry (built when it opens) */
  actions(key: string): MenuAction[];
  /** Move the entries with these keys into a folder ('' is the top) */
  dropInto(folder: string, keys: string[]): void;
  /** The keys a drag of this entry carries: every selected one when it is selected, else itself */
  dragKeys(key: string): string[];
  /** Pick or unpick an entry (range: up from the last one picked, as with Shift-click) */
  toggle(key: string, range: boolean): void;
  /** Open an entry: a folder, a file, an image */
  open(key: string): void;
  /** Whether entries are being picked (a click picks then) */
  selecting(): boolean;
}

type Dialog =
  | { kind: 'move'; keys: string[] }
  | { kind: 'renameFolder'; path: string }
  | { kind: 'renameItem'; item: FilerItem }
  | { kind: 'newFolder' };

export function Filer() {
  useEffect(() => {
    void loadFilerPrefs();
  }, []);
  const all = useFilerItems();
  const prefs = filerPrefs.value;
  const view = filerView.value;
  const conv = filerConversation.value;
  const folder = filerFolder.value;
  // Searching reads file contents: wait until typing pauses
  const query = useDebounced(filerQuery.value, 150);
  // The folder being looked at, searched in or not (null when listing by type or by chat): where files are brought in
  const inFolder = view === 'all' && !conv ? (folder ?? '') : null;
  // By folder, without a search: what is right in the open folder
  const here = !query.trim() ? inFolder : null;
  // A search reads the files' whole texts apart (lists carry only their start)
  const [contentHits, setContentHits] = useState<Set<string> | null>(null);
  useEffect(() => {
    setContentHits(null);
    if (!query.trim()) return;
    let alive = true;
    void searchContents(query).then((hits) => alive && setContentHits(hits));
    return () => {
      alive = false;
    };
  }, [query, all]);
  const items = useMemo(
    () => (all ? sortItems(filterItems(all, { view, conversationId: conv, folder, direct: here !== null, query, contentHits }), prefs.sort, prefs.order) : null),
    [all, view, conv, folder, here, query, contentHits, prefs.sort, prefs.order]
  );
  const pending = newFolders.value;
  const folders = useMemo(() => {
    if (!all || here === null) return [];
    const found = foldersIn(all, here);
    // Folders made with "New folder" that nothing is in yet
    for (const p of pending) {
      if (isInside(p, here) && !p.slice(here.length, -1).includes('/') && !found.some((f) => pathKey(f.path) === pathKey(p))) found.push({ path: p, name: p.slice(here.length, -1), count: 0, updatedAt: 0 });
    }
    return sortFolders(found, prefs);
  }, [all, here, pending, prefs.sort, prefs.order]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Selection is per view
  useEffect(() => {
    setPicked(new Set());
    lastIndex.current = null;
  }, [view, conv, folder, filerQuery.value]);
  const list = items ?? NO_ITEMS;
  // Drawn in batches as the list scrolls: the first screenful shows at once, even with thousands of entries
  const scrollArea = useRef<HTMLDivElement>(null);
  const moreMark = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(BATCH);
  useEffect(() => setLimit(BATCH), [view, conv, folder, query]);
  const shown = useMemo(() => list.slice(0, limit), [list, limit]);
  useEffect(() => {
    const root = scrollArea.current;
    const mark = moreMark.current;
    if (!root || !mark) return;
    const io = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setLimit((n) => n + BATCH), { root, rootMargin: '0px 0px 1200px 0px' });
    io.observe(mark);
    return () => io.disconnect();
  }, [limit, list.length]);
  // Every entry in the order shown: folders first
  const keys = useMemo(() => [...folders.map(folderKey), ...list.map((i) => i.key)], [folders, list]);
  // Drop picks that disappeared (deleted, moved)
  useEffect(() => {
    if (!picked.size) return;
    const shown = new Set(keys);
    if ([...picked].some((k) => !shown.has(k))) setPicked(new Set([...picked].filter((k) => shown.has(k))));
  }, [keys]);

  // A folder from its key, whether it is listed or open (the open folder's menu uses the same actions)
  const folderOfKey = (k: string) => (k.startsWith('d:') ? { path: k.slice(2), name: baseName(k.slice(2, -1)) } : undefined);
  const itemOfKey = (k: string) => list.find((i) => i.key === k);
  const selected = list.filter((i) => picked.has(i.key));
  const selectedFiles = selected.filter((i): i is Extract<FilerItem, { type: 'file' }> => i.type === 'file');
  const toggleKey = (key: string, range: boolean) => {
    const i = keys.indexOf(key);
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && lastIndex.current !== null) {
        const [a, b] = [Math.min(lastIndex.current, i), Math.max(lastIndex.current, i)];
        for (let k = a; k <= b; k++) next.add(keys[k]);
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    lastIndex.current = i;
  };
  const toggleAll = () => setPicked(picked.size === keys.length ? new Set() : new Set(keys));
  const open = (it: FilerItem) => {
    if (it.type === 'file') return void openFile(it.id);
    // On its own page, stepping through the images listed with it
    openImage(it.id, list.filter((x) => x.type === 'image').map((x) => x.id));
  };

  /** Move entries into a folder (a folder takes everything in it along) */
  const moveInto = async (target: string, entryKeys: string[]) => {
    await moveEntries(entryKeys.map(folderOfKey).filter((f) => !!f), entryKeys.map(itemOfKey).filter((i) => !!i), target);
    setPicked(new Set());
  };

  /** Delete entries, a folder with all it holds, after the user confirms what goes */
  const remove = async (entryKeys: string[]) => {
    const fs = entryKeys.map(folderOfKey).filter((f) => !!f);
    const r = planRemoval(fs.map((f) => f.path), entryKeys.map(itemOfKey).filter((i) => !!i));
    // Images alone: asked and deleted as everywhere else images are
    if (!fs.length && !r.fileIds.length) {
      if (r.imageIds.length) await confirmAndDelete(r.imageIds);
    } else {
      const ok = await askConfirm({
        title: entryKeys.length === 1 ? t('filer.deleteTitleOne') : t('filer.deleteTitle', { n: formatNumber(entryKeys.length) }),
        message: fs.length
          ? t('filer.confirmFolders', { folders: fs.map((f) => `「${f.name}」`).join(''), files: formatNumber(r.fileIds.length), images: formatNumber(r.imageIds.length) })
          : r.imageIds.length
            ? t('filer.confirmFilesImages', { files: formatNumber(r.fileIds.length), images: formatNumber(r.imageIds.length) })
            : t('filer.confirmFiles', { files: formatNumber(r.fileIds.length) }),
        confirmLabel: t('delete'),
        danger: true
      });
      if (!ok) return;
      await removeEntries(r);
    }
    setPicked(new Set());
  };

  const current: EntryApi = {
    actions(key) {
      const f = folderOfKey(key);
      if (f)
        return [
          { icon: 'folder', label: t('folder.openIt'), run: () => openFolder(f.path) },
          { icon: 'chat', label: t('folder.chat'), run: () => void chatInFolder(f.path) },
          { icon: 'edit', label: t('folder.rename'), run: () => setDialog({ kind: 'renameFolder', path: f.path }) },
          { icon: 'folder', label: t('filer.moveEllipsis'), run: () => setDialog({ kind: 'move', keys: [key] }) },
          { icon: 'trash', label: t('delete'), run: () => void remove([key]), danger: true }
        ];
      const it = itemOfKey(key);
      if (!it) return [];
      const at = folderOf(it.name);
      return [
        { icon: it.type === 'image' ? 'image' : 'file', label: t('open'), run: () => open(it) },
        // Listed by type, by chat or by a search, an entry can lead to where it is
        ...(here === null || pathKey(at) !== pathKey(here) ? [{ icon: 'folder' as const, label: at ? t('filer.showFolder', { name: at.slice(0, -1) }) : t('filer.showTop'), run: () => openFolder(at || null) }] : []),
        { icon: 'edit', label: t('filer.rename'), run: () => setDialog({ kind: 'renameItem', item: it }) },
        { icon: 'folder', label: t('filer.moveEllipsis'), run: () => setDialog({ kind: 'move', keys: [key] }) },
        { icon: 'download', label: t('download'), run: () => void downloadItem(it) },
        { icon: 'trash', label: t('delete'), run: () => void remove([key]), danger: true }
      ];
    },
    dropInto: (target, entryKeys) => void moveInto(target, entryKeys),
    dragKeys: (key) => (picked.has(key) ? [...picked] : [key]),
    toggle: toggleKey,
    open(key) {
      const f = folderOfKey(key);
      if (f) return openFolder(f.path);
      const it = itemOfKey(key);
      if (it) open(it);
    },
    selecting: () => picked.size > 0
  };
  const latest = useRef(current);
  latest.current = current;
  const api = useMemo<EntryApi>(
    () => ({
      actions: (k) => latest.current.actions(k),
      dropInto: (f, ks) => latest.current.dropInto(f, ks),
      dragKeys: (k) => latest.current.dragKeys(k),
      toggle: (k, r) => latest.current.toggle(k, r),
      open: (k) => latest.current.open(k),
      selecting: () => latest.current.selecting()
    }),
    []
  );
  const selecting = picked.size > 0;
  const emptyNew = here !== null && !!folder && folders.length === 0 && list.length === 0;
  const count = items ? items.length + folders.length : null;

  return (
    <main
      class="relative flex min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        // Files are brought into the open folder; a list by type or by chat is no place, so it takes none
        if (inFolder === null || !e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (inFolder === null || !e.dataTransfer?.files.length) return;
        e.preventDefault();
        void importFromDevice([...e.dataTransfer.files], inFolder);
      }}
    >
      {/* While entries are selected, their actions cover the header (no layout shift under the pointer) */}
      <FilesHeader
        title={
          <FilerTitle
            api={api}
            add={[
              { icon: 'folder-plus', label: t('folder.new'), run: () => setDialog({ kind: 'newFolder' }) },
              { icon: 'upload', label: t('filer.uploadHere'), run: () => input.current?.click() }
            ]}
          />
        }
        searchIn={inFolder}
      >
        {/* Opened from "Add here" and the empty folder's button */}
        <input
          ref={input}
          type="file"
          multiple
          class="hidden"
          onChange={(e) => {
            const el = e.target as HTMLInputElement;
            const files = [...(el.files ?? [])];
            el.value = '';
            if (files.length && inFolder !== null) void importFromDevice(files, inFolder);
          }}
        />
        {selecting && (
          <div class="panel fade-in absolute inset-0 flex items-center gap-2 overflow-x-auto rounded-2xl px-2 text-sm whitespace-nowrap" role="toolbar" aria-label={t('filer.selectionActions')}>
            <IconButton label={t('filer.clearSelection')} onClick={() => setPicked(new Set())}>
              <Icon name="x" />
            </IconButton>
            <span class="tabular-nums">{t('filer.selected', { n: formatNumber(picked.size) })}</span>
            <Button class="text-xs" onClick={toggleAll} aria-label={picked.size === keys.length ? t('filer.deselectAll') : t('filer.selectAll')}>
              <Icon name="check" class="size-3.5" />
              <span class="hidden sm:inline">{picked.size === keys.length ? t('filer.deselectAll') : t('filer.selectAll')}</span>
            </Button>
            <div class="ml-auto flex items-center gap-1">
              {/* On phones the actions are icons only, so all of them fit */}
              <Button class="text-xs" disabled={!selectedFiles.length} title={t('useInChatTitle')} aria-label={t('useInChat')} onClick={() => void attachToChat(selectedFiles.map((f) => f.id))}>
                <Icon name="paperclip" class="size-3.5" />
                <span class="hidden sm:inline">{t('useInChat')}</span>
              </Button>
              <Button class="text-xs" title={t('filer.moveTitle')} aria-label={t('filer.move')} onClick={() => setDialog({ kind: 'move', keys: [...picked] })}>
                <Icon name="folder" class="size-3.5" />
                <span class="hidden sm:inline">{t('filer.move')}</span>
              </Button>
              <Button class="text-xs" disabled={!selected.length} title={t('download')} aria-label={t('download')} onClick={() => void Promise.all(selected.map(downloadItem))}>
                <Icon name="download" class="size-3.5" />
                <span class="hidden sm:inline">{t('download')}</span>
              </Button>
              <Button variant="danger" class="py-1! text-xs" title={t('delete')} aria-label={t('delete')} onClick={() => void remove([...picked])}>
                <Icon name="trash" class="size-3.5" />
                <span class="hidden sm:inline">{t('delete')}</span>
              </Button>
            </div>
          </div>
        )}
      </FilesHeader>
      <SubBar
        start={<span class="px-1 text-xs text-muted tabular-nums">{count === null ? '' : count === 1 ? t('filer.countOne') : t('filer.count', { n: formatNumber(count) })}</span>}
        end={
          <>
            {/* How the list is shown: under the header, which keeps its room for the path and the search */}
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
          </>
        }
      />

      {/* Room at the top for a card that lifts on hover (the scroll area clips it otherwise) */}
      {/* .selecting shows every entry's check (entries are not drawn again for it) */}
      <div ref={scrollArea} class={cx('scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3 sm:px-4 sm:pb-4 md:pr-7 md:pl-1', selecting && 'selecting')}>
        {!items ? (
          <p class="flex items-center gap-2 text-sm text-muted">
            <Spinner class="size-4" />
            {t('loading')}
          </p>
        ) : emptyNew && !importing.value.length ? (
          <EmptyState icon="folder" class="mx-auto mt-16 max-w-sm">
            <p>{t('folder.empty')}</p>
            <Button variant="outline" class="mt-4" onClick={() => input.current?.click()}>
              <Icon name="upload" />
              {t('upload')}
            </Button>
          </EmptyState>
        ) : items.length === 0 && folders.length === 0 && !importing.value.length ? (
          <FilerEmpty view={view} filtered={!!conv || !!folder || !!filerQuery.value.trim()} onUpload={inFolder === null ? undefined : () => input.current?.click()} />
        ) : prefs.layout === 'grid' ? (
          <>
            {folders.length > 0 && (
              <div class="mb-3 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {folders.map((f) => (
                  <FolderTile key={f.path} f={f} picked={picked.has(folderKey(f))} api={api} />
                ))}
              </div>
            )}
            <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {importing.value.map((u) => (
                <div key={u.id} class="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-line text-xs text-muted">
                  <Spinner class="size-4" />
                  <span class="max-w-full truncate px-2">{u.name}</span>
                </div>
              ))}
              {shown.map((it) => (
                <Card key={it.key} it={it} picked={picked.has(it.key)} api={api} />
              ))}
            </div>
          </>
        ) : (
          <ListView folders={folders} items={shown} prefs={prefs} picked={picked} all={picked.size > 0 && picked.size === keys.length} onAll={toggleAll} api={api} />
        )}
        {/* The next batch is drawn when this comes near the bottom of the view */}
        {list.length > limit && <div ref={moreMark} class="h-px" />}
      </div>

      {dialog?.kind === 'move' && (
        <MoveDialog
          folders={[...new Set([...(all ? allFolders(all) : []), ...pending])].sort((a, b) => a.localeCompare(b)).filter((p) => !dialog.keys.some((k) => k.startsWith('d:') && isInside(p, k.slice(2))))}
          count={dialog.keys.length}
          onClose={() => setDialog(null)}
          onMove={async (to) => {
            await moveInto(to, dialog.keys);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'renameFolder' && <RenameDialog title={t('folder.rename')} label={t('folder.renameLabel')} note={t('folder.renameNote')} initial={dialog.path.slice(0, -1)} onClose={() => setDialog(null)} onSave={(v) => renameFolder(dialog.path, v)} />}
      {dialog?.kind === 'renameItem' && <RenameDialog title={t('filer.rename')} label={t('filer.renameLabel')} initial={baseName(dialog.item.name)} onClose={() => setDialog(null)} onSave={(v) => renameItem(dialog.item, v)} />}
      {dialog?.kind === 'newFolder' && <RenameDialog title={t('folder.new')} label={t('folder.newLabel')} initial="" onClose={() => setDialog(null)} onSave={(v) => createFolder(inFolder ?? '', v)} />}
      {dragging && (
        <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-[22px] border-2 border-dashed border-accent bg-accent-soft text-sm font-medium text-ink-strong backdrop-blur-sm">
          {inFolder ? t('filer.dropInto', { name: inFolder.slice(0, -1) }) : t('filer.drop')}
        </div>
      )}
    </main>
  );
}

/** Where entries of the file manager can be dropped: a folder card or row, or a part of the open folder's path */
function useDropTarget(folder: string, api: EntryApi) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer?.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        api.dropInto(folder, JSON.parse(raw) as string[]);
      }
    }
  };
}

/** Lets an entry be dragged onto a folder */
const dragHandlers = (key: string, api: EntryApi) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(api.dragKeys(key)));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
});

/** A folder among the entries: a compact tile above the cards, to open, select, drag or drop onto */
const FolderTile = memo(function FolderTile({ f, picked, api }: { f: FolderItem; picked: boolean; api: EntryApi }) {
  const key = folderKey(f);
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => api.toggle(key, false));
  const drop = useDropTarget(f.path, api);
  return (
    <div
      data-entry={key}
      class={cx(
        'lift group relative flex items-center gap-2 rounded-xl border bg-glass py-1.5 pr-1 pl-2.5 select-none [-webkit-touch-callout:none]',
        picked ? 'border-accent ring-2 ring-accent/40' : drop.over ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
      )}
      {...press.handlers}
      {...drop.handlers}
      {...dragHandlers(key, api)}
      onContextMenu={(e) => {
        if (press.pressed()) return e.preventDefault();
        e.preventDefault();
        setMenu(true);
      }}
    >
      <Checkbox
        round
        checked={picked}
        label={t('filer.select', { name: f.name })}
        onChange={(_, e) => api.toggle(key, e.shiftKey)}
        // In place of the folder's icon, inside the tile (the scroll area would clip it outside)
        class={cx('absolute top-1/2 left-2.5 z-10 -translate-y-1/2', !picked && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden [.selecting_&]:inline-flex! [.selecting_&]:opacity-100!')}
      />
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={(e) => (press.consume() ? undefined : api.selecting() || e.ctrlKey || e.metaKey || e.shiftKey ? api.toggle(key, e.shiftKey) : openFolder(f.path))}
        aria-label={t('folder.open', { name: f.name })}
      >
        <Icon
          name="folder"
          class={cx('size-5 shrink-0 text-muted', picked ? 'opacity-0' : '[@media(hover:hover)]:group-focus-within:opacity-0 [@media(hover:hover)]:group-hover:opacity-0 [.selecting_&]:opacity-0')}
        />
        <span class="min-w-0">
          <span class="block truncate text-sm text-ink-strong">{f.name}</span>
          <span class="block truncate text-xs text-muted tabular-nums">{f.count ? `${t('folder.count', { n: formatNumber(f.count) })} · ${formatDate(f.updatedAt)}` : t('folder.isEmpty')}</span>
        </span>
      </button>
      {/* An entry's menu: from its "…" button, or a right click on it (the browser's own menu otherwise) */}
      <ActionMenu compact label={t('filer.itemActions')} actions={() => api.actions(key)} open={menu} onOpenChange={setMenu} class={cx(!menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
    </div>
  );
});

/** An entry as a card; drawn again only when it or its check changes */
const Card = memo(function Card({ it, picked, api }: { it: FilerItem; picked: boolean; api: EntryApi }) {
  const press = useLongPress(() => api.toggle(it.key, false));
  const [menu, setMenu] = useState(false);
  const click = (e: MouseEvent) => {
    if (press.consume()) return;
    // While selecting, clicks select; Ctrl / Cmd / Shift-click selects too
    if (api.selecting() || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      api.toggle(it.key, e.shiftKey);
    } else api.open(it.key);
  };
  return (
    <div
      data-entry={it.key}
      class={cx(
        'lift group relative flex flex-col overflow-hidden rounded-[18px] border bg-glass select-none [-webkit-touch-callout:none]',
        picked ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong'
      )}
      {...press.handlers}
      {...dragHandlers(it.key, api)}
      onContextMenu={(e) => {
        if (press.pressed()) return e.preventDefault();
        e.preventDefault();
        setMenu(true);
      }}
    >
      {/* The selection mark: under the pointer, or while selecting (on touch screens a long press starts it) */}
      <Checkbox
        round
        checked={picked}
        label={t('filer.select', { name: it.name })}
        onChange={(_, e) => api.toggle(it.key, e.shiftKey)}
        class={cx('absolute top-2 left-2 z-10', !picked && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden [.selecting_&]:inline-flex! [.selecting_&]:opacity-100!')}
      />
      <div class="relative">
        {it.type === 'image' ? (
          <>
            <ImageThumb blobId={it.id} alt={it.name} class="aspect-[4/3] w-full rounded-none!" onOpen={() => (press.consume() ? undefined : api.selecting() ? api.toggle(it.key, false) : api.open(it.key))} />
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
              {previewText(it.file.preview, it.ext)}
            </pre>
          </button>
        )}
        <span class="pointer-events-none absolute top-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur-sm">{it.ext || 'txt'}</span>
      </div>
      <div class="flex min-w-0 flex-1 items-start">
        <button type="button" class="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left" onClick={click}>
          <Icon name={kindIcon(it)} class="mt-0.5 size-4 shrink-0 text-muted" />
          <span class="min-w-0">
            <span class="line-clamp-2 text-sm leading-snug text-ink-strong [overflow-wrap:anywhere]">
              <PathName name={it.name} from={filerFolder.value} />
            </span>
            <span class="mt-0.5 block truncate text-xs text-muted tabular-nums">
              {formatBytes(it.size)} · {formatDate(it.updatedAt)}
            </span>
          </span>
        </button>
        <ActionMenu compact label={t('filer.itemActions')} actions={() => api.actions(it.key)} open={menu} onOpenChange={setMenu} class={cx('mt-1 mr-1', !menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
      </div>
    </div>
  );
});

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

/** What the Files tab shows, as the header's title: the open folder's path (with its menu and what can be added), the type, or the chat */
function FilerTitle({ api, add }: { api: EntryApi; add: MenuAction[] }) {
  const view = filerView.value;
  const conv = filerConversation.value;
  if (conv) {
    const title = convTitle(conv);
    return (
      <div class="flex min-w-0 flex-1 items-center px-1">
        {title !== undefined ? (
          <button type="button" class="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm hover:bg-glass-strong" title={t('filer.openChat')} onClick={() => void openConversation(conv)}>
            <Icon name="chat" class="size-4 shrink-0 text-muted" />
            <span class="truncate font-medium text-ink-strong">{title}</span>
          </button>
        ) : (
          <span class="flex min-w-0 items-center gap-1.5 px-1.5 text-sm text-muted">
            <Icon name="chat" class="size-4 shrink-0" />
            <span class="truncate">{t('deletedConversation')}</span>
          </span>
        )}
      </div>
    );
  }
  if (view !== 'all')
    return (
      <div class="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-sm">
        <Icon name={VIEW_ICONS[view]} class="size-4 shrink-0 text-muted" />
        <span class="truncate font-medium text-ink-strong">{viewLabel(view)}</span>
      </div>
    );
  return (
    <div class="flex min-w-0 flex-1 items-center px-1">
      <FolderPath folder={filerFolder.value ?? ''} api={api} add={add} />
    </div>
  );
}

/** One part of the open folder's path: a way back up, and a place to drop entries */
function DropCrumb({ folder, api, children }: { folder: string; api: EntryApi; children: ComponentChildren }) {
  const drop = useDropTarget(folder, api);
  return (
    <Crumb folder={folder} highlight={drop.over} {...drop.handlers}>
      {children}
    </Crumb>
  );
}

/** The open folder's path (the top too), each part a way back up, the folder's own menu, and what can be added to it */
function FolderPath({ folder, api, add }: { folder: string; api: EntryApi; add: MenuAction[] }) {
  const parts = folder ? folder.slice(0, -1).split('/') : [];
  // The folder's menu, but not "open" (it is open); the top has none
  const actions = folder ? api.actions(`d:${folder}`).slice(1) : [];
  return (
    <nav class="flex min-w-0 items-center gap-0.5 text-sm text-muted" aria-label={t('folder.path')}>
      {folder ? (
        <DropCrumb folder="" api={api}>
          {t('folder.top')}
        </DropCrumb>
      ) : (
        <span class="px-1.5 font-medium text-ink-strong" aria-current="page">
          {t('folder.top')}
        </span>
      )}
      {parts.map((p, i) => (
        <span key={i} class="flex min-w-0 items-center gap-0.5">
          <Icon name="chevron-right" class="size-3.5 shrink-0 text-faint" />
          {i === parts.length - 1 ? (
            <span class="max-w-[12rem] truncate px-1.5 font-medium text-ink-strong" aria-current="page">
              {p}
            </span>
          ) : (
            <DropCrumb folder={`${parts.slice(0, i + 1).join('/')}/`} api={api}>
              {p}
            </DropCrumb>
          )}
        </span>
      ))}
      <ActionMenu compact start label={t('filer.itemActions')} actions={actions} />
      <ActionMenu compact start icon="plus" label={t('folder.addHere')} actions={add} />
    </nav>
  );
}

/** A name to give: a folder's new path, a file's or image's new name, or a new folder's name */
function RenameDialog({ title, label, note, initial, onClose, onSave }: { title: string; label: string; note?: string; initial: string; onClose(): void; onSave(value: string): Promise<boolean> }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        class="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSave(value)) onClose();
        }}
      >
        <label class="block space-y-1 text-xs text-muted">
          <span>{label}</span>
          <TextField class="w-full" value={value} onInput={(e) => setValue(e.currentTarget.value)} autoFocus />
        </label>
        {note && <p class="text-xs text-muted">{note}</p>}
        <div class="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!value.trim() || value.trim() === initial}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Where to move the chosen entries: a folder that exists, the top, or a new one */
function MoveDialog({ folders, count, onClose, onMove }: { folders: string[]; count: number; onClose(): void; onMove(folder: string): Promise<void> }) {
  const [fresh, setFresh] = useState('');
  const row = 'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-glass';
  return (
    <Modal fixed title={t('filer.moveTo', { n: formatNumber(count) })} onClose={onClose}>
      <ul class="max-h-[50vh] space-y-0.5 overflow-y-auto">
        <li>
          <button type="button" class={row} onClick={() => void onMove('')}>
            <Icon name="files" class="size-4 shrink-0 text-muted" />
            {t('folder.top')}
          </button>
        </li>
        {folders.map((f) => (
          <li key={f}>
            <button type="button" class={row} onClick={() => void onMove(f)}>
              <Icon name="folder" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{f.slice(0, -1)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        class="mt-3 flex items-end gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = cleanFolderName(fresh);
          if (f) void onMove(f);
        }}
      >
        <label class="min-w-0 flex-1 space-y-1 text-xs text-muted">
          <span>{t('filer.moveNew')}</span>
          <TextField class="w-full" value={fresh} onInput={(e) => setFresh(e.currentTarget.value)} placeholder="my-folder" />
        </label>
        <Button variant="primary" type="submit" disabled={!cleanFolderName(fresh)}>
          {t('filer.move')}
        </Button>
      </form>
    </Modal>
  );
}

/** Nothing to list; where files can be brought in (an open folder), how */
function FilerEmpty({ view, filtered, onUpload }: { view: FilerView; filtered: boolean; onUpload?: () => void }) {
  return (
    <EmptyState icon={filtered ? 'search' : view === 'image' ? 'image' : 'files'} class="mx-auto mt-16 max-w-sm">
      {filtered ? (
        <p>{t('empty.filtered')}</p>
      ) : view === 'image' ? (
        <p>{t('empty.images')}</p>
      ) : (
        <>
          <p>{t('empty.files')}</p>
          {onUpload && (
            <>
              <p class="mt-1">{t('empty.hint')}</p>
              <Button variant="outline" class="mt-4" onClick={onUpload}>
                <Icon name="upload" />
                {t('upload')}
              </Button>
            </>
          )}
        </>
      )}
    </EmptyState>
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

/** A row of the list: a folder or an item, with its check, its name, its details and its menu */
function ListRow({
  rowKey,
  label,
  name,
  icon,
  details,
  picked,
  api,
  dropFolder
}: {
  rowKey: string;
  /** Its name as text, for the check's label */
  label: string;
  name: ComponentChildren;
  icon: IconName;
  details: [string, string, string, string];
  picked: boolean;
  api: EntryApi;
  /** A folder's path: entries can be dropped on its row */
  dropFolder?: string;
}) {
  const press = useLongPress(() => api.toggle(rowKey, false));
  const drop = useDropTarget(dropFolder ?? '', api);
  const [menu, setMenu] = useState(false);
  return (
    <tr
      data-entry={rowKey}
      class={cx('group border-b border-line select-none [-webkit-touch-callout:none]', picked ? 'bg-accent-soft' : dropFolder !== undefined && drop.over ? 'bg-accent-soft' : 'hover:bg-glass')}
      {...press.handlers}
      {...(dropFolder !== undefined ? drop.handlers : {})}
      {...dragHandlers(rowKey, api)}
      onContextMenu={(e) => {
        if (press.pressed()) return e.preventDefault();
        e.preventDefault();
        setMenu(true);
      }}
    >
      <td class="py-1.5 pl-1">
        <Checkbox checked={picked} label={t('filer.select', { name: label })} onChange={(_, e) => api.toggle(rowKey, e.shiftKey)} />
      </td>
      <td class="py-1.5">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-ink-strong"
          onClick={(e) => (press.consume() ? undefined : api.selecting() || e.ctrlKey || e.metaKey || e.shiftKey ? api.toggle(rowKey, e.shiftKey) : api.open(rowKey))}
        >
          <Icon name={icon} class="size-4 shrink-0 text-muted" />
          <span class="truncate">{name}</span>
        </button>
      </td>
      <td class="hidden py-1.5 text-xs text-muted uppercase sm:table-cell">{details[0]}</td>
      <td class="hidden py-1.5 text-xs text-muted tabular-nums sm:table-cell">{details[1]}</td>
      <td class="py-1.5 text-xs text-muted tabular-nums">{details[2]}</td>
      <td class="hidden truncate py-1.5 text-xs text-muted lg:table-cell">{details[3]}</td>
      <td class="w-9 py-1 text-right">
        <ActionMenu compact label={t('filer.itemActions')} actions={() => api.actions(rowKey)} open={menu} onOpenChange={setMenu} class={cx(!menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
      </td>
    </tr>
  );
}

function ListView({
  folders,
  items,
  prefs,
  picked,
  all,
  onAll,
  api
}: {
  folders: FolderItem[];
  items: FilerItem[];
  prefs: FilerPrefs;
  picked: Set<string>;
  all: boolean;
  onAll(): void;
  api: EntryApi;
}) {
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
          <th class="w-9" />
        </tr>
      </thead>
      <tbody>
        {folders.map((f) => (
          <FolderRow key={f.path} f={f} picked={picked.has(folderKey(f))} api={api} />
        ))}
        {items.map((it) => (
          <ItemRow key={it.key} it={it} picked={picked.has(it.key)} api={api} />
        ))}
      </tbody>
    </table>
  );
}

/** A folder as a row; drawn again only when it or its check changes */
const FolderRow = memo(function FolderRow({ f, picked, api }: { f: FolderItem; picked: boolean; api: EntryApi }) {
  return (
    <ListRow
      rowKey={folderKey(f)}
      label={f.name}
      name={f.name}
      icon="folder"
      details={[t('folder.type'), f.count ? t('folder.count', { n: formatNumber(f.count) }) : t('folder.isEmpty'), f.count ? formatDate(f.updatedAt) : '', '']}
      picked={picked}
      api={api}
      dropFolder={f.path}
    />
  );
});

/** A file or an image as a row; drawn again only when it or its check changes */
const ItemRow = memo(function ItemRow({ it, picked, api }: { it: FilerItem; picked: boolean; api: EntryApi }) {
  return (
    <ListRow
      rowKey={it.key}
      label={it.name}
      name={<PathName name={it.name} from={filerFolder.value} />}
      icon={kindIcon(it)}
      details={[it.ext, formatBytes(it.size), formatDate(it.updatedAt), convTitle(it.conversationId) ?? '']}
      picked={picked}
      api={api}
    />
  );
});
