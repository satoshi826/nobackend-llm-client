// The file manager in the main area, in one of three ways the sidebar chooses: by folder (the folders inside the open
// one first, then what sits right in it), by type, or by chat (everything of that kind, wherever it is). The header
// holds the search and upload (selected entries get their actions over it); the row under it the count, the open
// folder's path, the filters in effect, the sort menu and the layout. Every entry has a menu ("…", or a right click);
// entries can be dragged onto a folder, and files from the device dropped anywhere (into the open folder).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { baseName, folderOf, isInside, pathKey } from '../../../lib/paths';
import { confirmDeleteMedia } from '../../../components/media/Viewer';
import { askConfirm } from '../../../components/ConfirmDialog';
import { FilesHeader } from '../components/FilesHeader';
import { openConversation } from '../../../state/conversations';
import { Button, EmptyState, Icon, IconButton, MoreMark, ScrollArea, Segmented, Spinner, cx, useBatches, useDebounced } from '../../../components/ui';
import { allFolders, filterItems, foldersIn, sortItems, type FilerItem, type FolderItem } from './items';
import {
  chatInFolder,
  createFolder,
  downloadFile,
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
  type FilerOrder,
  type FilerSort,
  type FilerView
} from '../state';
import { ActionMenu, Crumb, SubBar, type MenuAction } from '../components/common';
import { formatList, formatNumber } from '../../../lib/i18n';
import { convTitle, useFilerItems, viewLabel, VIEW_ICONS } from './use-items';
import { Card, folderKey, FolderTile, ListView, useDropTarget, type EntryApi } from './entries';
import { MoveDialog, RenameDialog } from './dialogs';
import { SortMenu } from './SortMenu';
import { t } from '../messages';

/** The list before it has loaded: one array, so what is made from it is not made again each time */
const NO_ITEMS: FilerItem[] = [];
/** Entries drawn at first, and added each time the list scrolls near its end */
const BATCH = 120;


/** Folders in the order the items are sorted in: by name, or by when something in them last changed */
function sortFolders(folders: FolderItem[], sort: FilerSort, order: FilerOrder): FolderItem[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...folders].sort((a, b) => (sort === 'updated' ? (a.updatedAt - b.updatedAt) * dir : a.name.localeCompare(b.name) * (sort === 'name' ? dir : 1)));
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
  const typed = filerQuery.value;
  const query = useDebounced(typed, 150);
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
    return sortFolders(found, prefs.sort, prefs.order);
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
  }, [view, conv, folder, typed]);
  const list = items ?? NO_ITEMS;
  // Drawn in batches as the list scrolls: the first screenful shows at once, even with thousands of entries
  const scrollArea = useRef<HTMLDivElement>(null);
  const batches = useBatches(list.length, BATCH, scrollArea, [view, conv, folder, query]);
  const shown = useMemo(() => list.slice(0, batches.limit), [list, batches.limit]);
  // Every entry in the order shown: folders first
  const keys = useMemo(() => [...folders.map(folderKey), ...list.map((i) => i.key)], [folders, list]);
  // Drop picks that disappeared (deleted, moved)
  useEffect(() => {
    setPicked((picked) => {
      if (!picked.size) return picked;
      const shown = new Set(keys);
      return [...picked].some((k) => !shown.has(k)) ? new Set([...picked].filter((k) => shown.has(k))) : picked;
    });
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
    await moveEntries(entryKeys.map(folderOfKey).filter((f) => !!f), entryKeys.flatMap((k) => itemOfKey(k)?.id ?? []), target);
    setPicked(new Set());
  };

  /** Delete entries, a folder with all it holds, after the user confirms what goes */
  const remove = async (entryKeys: string[]) => {
    const fs = entryKeys.map(folderOfKey).filter((f) => !!f);
    const r = planRemoval(fs.map((f) => f.path), entryKeys.flatMap((k) => itemOfKey(k)?.id ?? []));
    const texts = r.ids.filter((id) => all?.find((i) => i.id === id)?.type === 'file').length;
    const images = r.ids.length - texts;
    // Images alone: asked and deleted as everywhere else images are
    if (!fs.length && !texts) {
      if (images) await confirmDeleteMedia(r.ids);
    } else {
      const ok = await askConfirm({
        title: entryKeys.length === 1 ? t('filer.deleteTitleOne') : t('filer.deleteTitle', { n: formatNumber(entryKeys.length) }),
        message: fs.length
          ? t('filer.confirmFolders', { folders: formatList(fs.map((f) => t('filer.folderName', { name: f.name }))), files: formatNumber(texts), images: formatNumber(images) })
          : images
            ? t('filer.confirmFilesImages', { files: formatNumber(texts), images: formatNumber(images) })
            : t('filer.confirmFiles', { files: formatNumber(texts) }),
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
        { icon: 'download', label: t('download'), run: () => void downloadFile(it.file) },
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
              <Button class="text-xs" disabled={!selected.length} title={t('download')} aria-label={t('download')} onClick={() => void Promise.all(selected.map((i) => downloadFile(i.file)))}>
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
        <ScrollArea.Provider value={scrollArea}>
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
        <MoreMark batches={batches} />
        </ScrollArea.Provider>
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
      {dialog?.kind === 'renameItem' && <RenameDialog title={t('filer.rename')} label={t('filer.renameLabel')} initial={baseName(dialog.item.name)} onClose={() => setDialog(null)} onSave={(v) => renameItem({ id: dialog.item.id, path: dialog.item.name }, v)} />}
      {dialog?.kind === 'newFolder' && <RenameDialog title={t('folder.new')} label={t('folder.newLabel')} initial="" onClose={() => setDialog(null)} onSave={(v) => createFolder(inFolder ?? '', v)} />}
      {dragging && (
        <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-[22px] border-2 border-dashed border-accent bg-accent-soft text-sm font-medium text-ink-strong backdrop-blur-sm">
          {inFolder ? t('filer.dropInto', { name: inFolder.slice(0, -1) }) : t('filer.drop')}
        </div>
      )}
    </main>
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
          <button type="button" class="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm hover:bg-glass-strong" data-tip={t('filer.openChat')} onClick={() => void openConversation(conv)}>
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
      <ActionMenu compact start label={t('filer.itemActions', { name: parts[parts.length - 1] })} actions={actions} />
      <ActionMenu compact start icon="plus" label={t('folder.addHere')} actions={add} />
    </nav>
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
