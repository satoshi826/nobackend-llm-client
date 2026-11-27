// The file manager in the main area, in one of three ways the sidebar chooses: by folder (the folders inside the open
// one first, then what sits right in it), by type, or by chat (everything of that kind, wherever it is). The header
// holds the search and upload (selected entries get their actions over it); the row under it the count, the open
// folder's path, the filters in effect, the sort menu and the layout. Every entry has a menu ("…", or a right click);
// entries can be dragged onto a folder, and files from the device dropped anywhere (into the open folder).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { baseName, cleanFolderName, folderOf, isInside, pathKey } from '../../../lib/paths';
import { confirmAndDelete, deleteImages, ImageThumb, lightbox } from '../../images';
import { askConfirm } from '../../../components/ConfirmDialog';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Checkbox, Chip, EmptyState, Icon, IconButton, Modal, SearchField, Segmented, Spinner, TextField, cx, useDebounced, type IconName } from '../../../components/ui';
import { allFolders, filterItems, foldersIn, NATURAL_ORDER, previewText, sortItems, type FilerItem, type FolderItem } from '../filer';
import {
  chatInFolder,
  createFolder,
  deleteFiles,
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
  moveItems,
  newFolders,
  dropNewFolders,
  openFile,
  openFolder,
  renameFolder,
  renameItem,
  searchContents,
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
/** What an entry dragged inside the file manager carries: the keys of the entries it moves */
const DRAG_TYPE = 'application/x-filer-entries';

export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} KB`;
  return `${formatNumber(n / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

const sizeLabel = (it: FilerItem) => (it.type === 'image' ? formatBytes(it.size) : formatChars(it.size));
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
interface MenuAction {
  icon: IconName;
  label: string;
  run(): void;
  danger?: boolean;
}

/** What the file manager can do with entries, handed to each of them */
interface EntryApi {
  /** The menu of an entry */
  actions(key: string): MenuAction[];
  /** Move the entries with these keys into a folder ('' is the top) */
  dropInto(folder: string, keys: string[]): void;
  /** The keys a drag of this entry carries: every selected one when it is selected, else itself */
  dragKeys(key: string): string[];
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
  // By folder, without a search: what is right in the open folder (null when listing by type, by chat, or searching)
  const here = view === 'all' && !conv && !query.trim() ? (folder ?? '') : null;
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
  const list = items ?? [];
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
    const imgs = list.filter((x): x is Extract<FilerItem, { type: 'image' }> => x.type === 'image');
    lightbox.value = { items: imgs.map((x) => ({ blobId: x.id, conversationId: x.conversationId, messageId: x.messageId, name: x.name, video: x.video })), index: imgs.findIndex((x) => x.id === it.id), fromGallery: true };
  };

  /** Move entries into a folder: a folder takes everything in it along; one cannot go into itself */
  const moveInto = async (target: string, entryKeys: string[]) => {
    for (const k of entryKeys) {
      const f = folderOfKey(k);
      if (f && !isInside(target, f.path) && pathKey(folderOf(f.path.slice(0, -1))) !== pathKey(target)) await renameFolder(f.path, target + f.name);
    }
    const its = entryKeys.map(itemOfKey).filter((i) => !!i);
    if (its.length) await moveItems(its.map((i) => ({ id: i.id, type: i.type, name: i.name })), target);
    setPicked(new Set());
  };

  /** Delete entries, a folder with all it holds, after the user confirms what goes */
  const remove = async (entryKeys: string[]) => {
    const fs = entryKeys.map(folderOfKey).filter((f) => !!f);
    const inside = [...entryKeys.map(itemOfKey).filter((i) => !!i), ...(all ?? []).filter((i) => fs.some((f) => isInside(i.name, f.path)))];
    const fileIds = [...new Set(inside.filter((i) => i.type === 'file').map((i) => i.id))];
    const imageIds = [...new Set(inside.filter((i) => i.type === 'image').map((i) => i.id))];
    if (!fileIds.length && !fs.length) {
      if (imageIds.length) await confirmAndDelete(imageIds);
    } else {
      const ok = await askConfirm({
        title: entryKeys.length === 1 ? t('filer.deleteTitleOne') : t('filer.deleteTitle', { n: formatNumber(entryKeys.length) }),
        message: fs.length
          ? t('filer.confirmFolders', { folders: fs.map((f) => `「${f.name}」`).join(''), files: formatNumber(fileIds.length), images: formatNumber(imageIds.length) })
          : imageIds.length
            ? t('filer.confirmFilesImages', { files: formatNumber(fileIds.length), images: formatNumber(imageIds.length) })
            : t('filer.confirmFiles', { files: formatNumber(fileIds.length) }),
        confirmLabel: t('delete'),
        danger: true
      });
      if (!ok) return;
      if (fileIds.length) await deleteFiles(fileIds);
      if (imageIds.length) await deleteImages(imageIds);
    }
    dropNewFolders(fs.map((f) => f.path));
    setPicked(new Set());
    if (folder && fs.some((f) => isInside(folder, f.path))) openFolder(folderOf(folder.slice(0, -1)) || null);
  };

  const api: EntryApi = {
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
    dragKeys: (key) => (picked.has(key) ? [...picked] : [key])
  };
  const selecting = picked.size > 0;
  // Uploads go where the user is looking: the open folder, or the top when listing by type or chat
  const uploadTo = here ?? '';
  const emptyNew = here !== null && !!folder && folders.length === 0 && list.length === 0;

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
        void importFromDevice([...e.dataTransfer.files], uploadTo);
      }}
    >
      {/* While entries are selected, their actions cover the header (no layout shift under the pointer) */}
      <PageHeader>
        <SearchField class="min-w-0 flex-1 md:max-w-xs" placeholder={t('filer.search')} label={t('filer.searchLabel')} value={filerQuery.value} onInput={(v) => (filerQuery.value = v)} />
        <div class="ml-auto flex shrink-0 items-center gap-0.5">
          {here !== null && (
            <Button class="py-1! text-sm" onClick={() => setDialog({ kind: 'newFolder' })} title={t('folder.new')} aria-label={t('folder.new')}>
              <Icon name="folder" />
              <span class="hidden lg:inline">{t('folder.new')}</span>
            </Button>
          )}
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
              if (files.length) void importFromDevice(files, uploadTo);
            }}
          />
        </div>
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
              <Button class="text-xs" disabled={!selectedFiles.length} title={t('useInChatTitle')} aria-label={t('useInChat')} onClick={() => void useInChat(selectedFiles.map((f) => f.id))}>
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
      </PageHeader>
      <FilterChips count={items ? items.length + folders.length : null} api={api}>
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
        ) : emptyNew && !importing.value.length ? (
          <EmptyState icon="folder" class="mx-auto mt-16 max-w-sm">
            <p>{t('folder.empty')}</p>
            <Button variant="outline" class="mt-4" onClick={() => input.current?.click()}>
              <Icon name="upload" />
              {t('upload')}
            </Button>
          </EmptyState>
        ) : items.length === 0 && folders.length === 0 && !importing.value.length ? (
          <FilerEmpty view={view} filtered={!!conv || !!folder || !!filerQuery.value.trim()} onUpload={() => input.current?.click()} />
        ) : prefs.layout === 'grid' ? (
          <>
            {folders.length > 0 && (
              <div class="mb-3 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {folders.map((f) => (
                  <FolderTile key={f.path} f={f} picked={picked.has(folderKey(f))} selecting={selecting} onToggle={(range) => toggleKey(folderKey(f), range)} api={api} />
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
              {items.map((it) => (
                <Card key={it.key} it={it} picked={picked.has(it.key)} selecting={selecting} onToggle={(range) => toggleKey(it.key, range)} onOpen={() => open(it)} api={api} />
              ))}
            </div>
          </>
        ) : (
          <ListView folders={folders} items={items} prefs={prefs} picked={picked} all={picked.size > 0 && picked.size === keys.length} onToggle={toggleKey} onOpen={open} onAll={toggleAll} api={api} />
        )}
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
      {dialog?.kind === 'newFolder' && <RenameDialog title={t('folder.new')} label={t('folder.newLabel')} initial="" onClose={() => setDialog(null)} onSave={(v) => createFolder(here ?? '', v)} />}
      {dragging && (
        <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-[22px] border-2 border-dashed border-accent bg-accent-soft text-sm font-medium text-ink-strong backdrop-blur-sm">
          {uploadTo ? t('filer.dropInto', { name: uploadTo.slice(0, -1) }) : t('filer.drop')}
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

/** An entry's menu: from its "…" button, or a right click on it (the browser's own menu otherwise) */
function EntryMenu({ actions, open, onOpen, onClose, class: cls }: { actions: MenuAction[]; open: boolean; onOpen(): void; onClose(): void; class?: string }) {
  const wrap = useRef<HTMLSpanElement>(null);
  return (
    <span ref={wrap} class={cls}>
      <IconButton label={t('filer.itemActions')} aria-haspopup="menu" aria-expanded={open} class="size-7! p-1!" onClick={(e) => (e.stopPropagation(), open ? onClose() : onOpen())}>
        <Icon name="more" class="size-4" />
      </IconButton>
      {open && (
        <Popover anchor={wrap.current} onClose={onClose} placement="bottom-end" label={t('filer.itemActions')} class="w-56">
          {actions.map((a, i) => (
            <span key={i}>
              {a.danger && <MenuSeparator />}
              <MenuItem
                icon={<Icon name={a.icon} class="mt-0.5 size-4 shrink-0" />}
                class={a.danger ? 'text-danger! hover:bg-danger-soft! focus-visible:bg-danger-soft!' : undefined}
                onSelect={() => (onClose(), a.run())}
              >
                {a.label}
              </MenuItem>
            </span>
          ))}
        </Popover>
      )}
    </span>
  );
}

/** A folder among the entries: a compact tile above the cards, to open, select, drag or drop onto */
function FolderTile({ f, picked, selecting, onToggle, api }: { f: FolderItem; picked: boolean; selecting: boolean; onToggle(range: boolean): void; api: EntryApi }) {
  const key = folderKey(f);
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => onToggle(false));
  const drop = useDropTarget(f.path, api);
  return (
    <div
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
        onChange={(_, e) => onToggle(e.shiftKey)}
        class={cx('absolute -top-1.5 -left-1.5 z-10', !picked && !selecting && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden')}
      />
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={(e) => (press.consume() ? undefined : selecting || e.ctrlKey || e.metaKey || e.shiftKey ? onToggle(e.shiftKey) : openFolder(f.path))}
        aria-label={t('folder.open', { name: f.name })}
      >
        <Icon name="folder" class="size-5 shrink-0 text-muted" />
        <span class="min-w-0">
          <span class="block truncate text-sm text-ink-strong">{f.name}</span>
          <span class="block truncate text-xs text-muted tabular-nums">{f.count ? `${t('folder.count', { n: formatNumber(f.count) })} · ${formatDate(f.updatedAt)}` : t('folder.isEmpty')}</span>
        </span>
      </button>
      <EntryMenu actions={api.actions(key)} open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)} class={cx(!menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
    </div>
  );
}

function Card({ it, picked, selecting, onToggle, onOpen, api }: { it: FilerItem; picked: boolean; selecting: boolean; onToggle(range: boolean): void; onOpen(): void; api: EntryApi }) {
  const press = useLongPress(() => onToggle(false));
  const [menu, setMenu] = useState(false);
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
              {sizeLabel(it)} · {formatDate(it.updatedAt)}
            </span>
          </span>
        </button>
        <EntryMenu actions={api.actions(it.key)} open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)} class={cx('mt-1 mr-1', !menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
      </div>
    </div>
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
 * How many entries are shown and the way they are chosen (the header has no title, so they are shown here): the open
 * folder's path, or the type or chat listed, with the controls for how the list is shown (children) at the right end
 */
function FilterChips({ count, api, children }: { count: number | null; api: EntryApi; children: ComponentChildren }) {
  const view = filerView.value;
  const conv = filerConversation.value;
  const folder = filerFolder.value;
  return (
    <div class="mx-3 flex min-h-11 flex-wrap items-center gap-1.5 pt-3 pb-3 sm:mx-4 md:mr-7 md:ml-1">
      <span class="px-1 text-xs text-muted tabular-nums">{count === null ? '' : count === 1 ? t('filer.countOne') : t('filer.count', { n: formatNumber(count) })}</span>
      {view === 'all' && !conv && folder && <FolderPath folder={folder} api={api} />}
      {view !== 'all' && (
        <Chip on class="h-7! pr-2!" aria-label={t('filter.remove', { name: viewLabel(view) })} onClick={() => openFolder(null)}>
          <Icon name={VIEW_ICONS[view]} class="size-3.5" />
          {viewLabel(view)}
          <Icon name="x" class="size-3.5 text-muted" />
        </Chip>
      )}
      {conv && (
        <Chip on class="h-7! max-w-[16rem] pr-2!" aria-label={t('filter.remove', { name: convTitle(conv) ?? t('deletedConversation') })} onClick={() => openFolder(null)}>
          <Icon name="chat" class="size-3.5 shrink-0" />
          <span class="truncate">{convTitle(conv) ?? t('deletedConversation')}</span>
          <Icon name="x" class="size-3.5 shrink-0 text-muted" />
        </Chip>
      )}
      <div class="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** One part of the open folder's path: a way back up, and a place to drop entries */
function Crumb({ folder, api, children }: { folder: string; api: EntryApi; children: ComponentChildren }) {
  const drop = useDropTarget(folder, api);
  return (
    <button
      type="button"
      class={cx('max-w-[12rem] truncate rounded-md px-1.5 py-0.5 hover:bg-glass-strong hover:text-ink', drop.over && 'bg-accent-soft text-ink')}
      onClick={() => openFolder(folder || null)}
      {...drop.handlers}
    >
      {children}
    </button>
  );
}

/** The open folder's path, each part a way back up, and the folder's own menu */
function FolderPath({ folder, api }: { folder: string; api: EntryApi }) {
  const parts = folder.slice(0, -1).split('/');
  const [menu, setMenu] = useState(false);
  // The folder's menu, but not "open" (it is open)
  const actions = api.actions(`d:${folder}`).slice(1);
  return (
    <nav class="flex min-w-0 items-center gap-0.5 text-sm text-muted" aria-label={t('folder.path')}>
      <Crumb folder="" api={api}>
        {t('folder.top')}
      </Crumb>
      {parts.map((p, i) => (
        <span key={i} class="flex min-w-0 items-center gap-0.5">
          <Icon name="chevron-right" class="size-3.5 shrink-0 text-faint" />
          {i === parts.length - 1 ? (
            <span class="max-w-[12rem] truncate px-1.5 font-medium text-ink-strong" aria-current="page">
              {p}
            </span>
          ) : (
            <Crumb folder={`${parts.slice(0, i + 1).join('/')}/`} api={api}>
              {p}
            </Crumb>
          )}
        </span>
      ))}
      {actions.length > 0 && <EntryMenu actions={actions} open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)} />}
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
  selecting,
  onToggle,
  onOpen,
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
  selecting: boolean;
  onToggle(range: boolean): void;
  onOpen(): void;
  api: EntryApi;
  /** A folder's path: entries can be dropped on its row */
  dropFolder?: string;
}) {
  const press = useLongPress(() => onToggle(false));
  const drop = useDropTarget(dropFolder ?? '', api);
  const [menu, setMenu] = useState(false);
  return (
    <tr
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
        <Checkbox checked={picked} label={t('filer.select', { name: label })} onChange={(_, e) => onToggle(e.shiftKey)} />
      </td>
      <td class="py-1.5">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-ink-strong"
          onClick={(e) => (press.consume() ? undefined : selecting || e.ctrlKey || e.metaKey || e.shiftKey ? onToggle(e.shiftKey) : onOpen())}
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
        <EntryMenu actions={api.actions(rowKey)} open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)} class={cx(!menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
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
  onToggle,
  onOpen,
  onAll,
  api
}: {
  folders: FolderItem[];
  items: FilerItem[];
  prefs: FilerPrefs;
  picked: Set<string>;
  all: boolean;
  onToggle(key: string, range: boolean): void;
  onOpen(it: FilerItem): void;
  onAll(): void;
  api: EntryApi;
}) {
  const selecting = picked.size > 0;
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
          <ListRow
            key={f.path}
            rowKey={folderKey(f)}
            label={f.name}
            name={f.name}
            icon="folder"
            details={[t('folder.type'), f.count ? t('folder.count', { n: formatNumber(f.count) }) : t('folder.isEmpty'), f.count ? formatDate(f.updatedAt) : '', '']}
            picked={picked.has(folderKey(f))}
            selecting={selecting}
            onToggle={(range) => onToggle(folderKey(f), range)}
            onOpen={() => openFolder(f.path)}
            api={api}
            dropFolder={f.path}
          />
        ))}
        {items.map((it) => (
          <ListRow
            key={it.key}
            rowKey={it.key}
            label={it.name}
            name={<PathName name={it.name} from={filerFolder.value} />}
            icon={kindIcon(it)}
            details={[it.ext, sizeLabel(it), formatDate(it.updatedAt), convTitle(it.conversationId) ?? '']}
            picked={picked.has(it.key)}
            selecting={selecting}
            onToggle={(range) => onToggle(it.key, range)}
            onOpen={() => onOpen(it)}
            api={api}
          />
        ))}
      </tbody>
    </table>
  );
}
