// The file manager's entries: folders as tiles or rows, files and images as cards or rows. Each is drawn again only
// when it or its check changes; what they do goes through one EntryApi that stays the same for the screen's life.
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ImageThumb } from '../../images';
import { Checkbox, Icon, cx, type IconName } from '../../../components/ui';
import { formatBytes, formatNumber } from '../../../lib/i18n';
import { previewText, type FilerItem, type FolderItem } from './items';
import { filerFolder, type FilerPrefs } from '../state';
import { ActionMenu, formatDate, PathName, type MenuAction } from '../components/common';
import { SortHead } from './SortMenu';
import { convTitle, VIEW_ICONS } from './use-items';
import { t } from '../messages';

/** What an entry dragged inside the file manager carries: the keys of the entries it moves */
const DRAG_TYPE = 'application/x-filer-entries';

export const folderKey = (f: FolderItem) => `d:${f.path}`;
const kindIcon = (it: FilerItem): IconName => (it.type === 'image' && it.video ? 'video' : VIEW_ICONS[it.type === 'image' ? 'image' : it.kind]);

/**
 * What the file manager can do with entries. One object for the screen's life (its methods reach the latest state),
 * so entries that did not change are not drawn again
 */
export interface EntryApi {
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

/**
 * What every entry does: a long press, a Ctrl / Cmd / Shift-click or any click while selecting picks it, another
 * click opens it, it can be dragged onto a folder, and a right click opens its menu (the browser's own otherwise)
 */
function useEntry(key: string, api: EntryApi) {
  const press = useLongPress(() => api.toggle(key, false));
  const [menu, setMenu] = useState(false);
  return {
    menu,
    setMenu,
    click: (e: MouseEvent) => {
      if (press.consume()) return;
      if (api.selecting() || e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        api.toggle(key, e.shiftKey);
      } else api.open(key);
    },
    pick: (e: MouseEvent) => api.toggle(key, e.shiftKey),
    actions: () => api.actions(key),
    handlers: {
      ...press.handlers,
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(api.dragKeys(key)));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        if (!press.pressed()) setMenu(true);
      }
    }
  };
}

/** Where entries of the file manager can be dropped: a folder tile or row, or a part of the open folder's path */
export function useDropTarget(folder: string, api: EntryApi) {
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

/** An entry's "…" menu: shown under the pointer, while open, and always on touch screens */
function EntryMenu({ entry, class: cls }: { entry: ReturnType<typeof useEntry>; class?: string }) {
  return (
    <ActionMenu
      compact
      label={t('filer.itemActions')}
      actions={entry.actions}
      open={entry.menu}
      onOpenChange={entry.setMenu}
      class={cx(cls, !entry.menu && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}
    />
  );
}

/** A tile's or card's check: under the pointer, or while selecting (on touch screens a long press starts it) */
const hoverCheck = (picked: boolean) => !picked && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden [.selecting_&]:inline-flex! [.selecting_&]:opacity-100!';

/** A folder among the entries: a compact tile above the cards, to open, select, drag or drop onto */
export const FolderTile = memo(function FolderTile({ f, picked, api }: { f: FolderItem; picked: boolean; api: EntryApi }) {
  const entry = useEntry(folderKey(f), api);
  const drop = useDropTarget(f.path, api);
  return (
    <div
      data-entry={folderKey(f)}
      class={cx(
        'lift group relative flex items-center gap-2 rounded-xl border bg-glass py-1.5 pr-1 pl-2.5 select-none [-webkit-touch-callout:none]',
        picked ? 'border-accent ring-2 ring-accent/40' : drop.over ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
      )}
      {...entry.handlers}
      {...drop.handlers}
    >
      <Checkbox
        round
        checked={picked}
        label={t('filer.select', { name: f.name })}
        onChange={(_, e) => entry.pick(e)}
        // In place of the folder's icon, inside the tile (the scroll area would clip it outside)
        class={cx('absolute top-1/2 left-2.5 z-10 -translate-y-1/2', hoverCheck(picked))}
      />
      <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={entry.click} aria-label={t('folder.open', { name: f.name })}>
        <Icon
          name="folder"
          class={cx('size-5 shrink-0 text-muted', picked ? 'opacity-0' : '[@media(hover:hover)]:group-focus-within:opacity-0 [@media(hover:hover)]:group-hover:opacity-0 [.selecting_&]:opacity-0')}
        />
        <span class="min-w-0">
          <span class="block truncate text-sm text-ink-strong">{f.name}</span>
          <span class="block truncate text-xs text-muted tabular-nums">{f.count ? `${t('folder.count', { n: formatNumber(f.count) })} · ${formatDate(f.updatedAt)}` : t('folder.isEmpty')}</span>
        </span>
      </button>
      <EntryMenu entry={entry} />
    </div>
  );
});

/** An entry as a card; drawn again only when it or its check changes */
export const Card = memo(function Card({ it, picked, api }: { it: FilerItem; picked: boolean; api: EntryApi }) {
  const entry = useEntry(it.key, api);
  return (
    <div
      data-entry={it.key}
      class={cx(
        'lift group relative flex flex-col overflow-hidden rounded-[18px] border bg-glass select-none [-webkit-touch-callout:none]',
        picked ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong'
      )}
      {...entry.handlers}
    >
      <Checkbox round checked={picked} label={t('filer.select', { name: it.name })} onChange={(_, e) => entry.pick(e)} class={cx('absolute top-2 left-2 z-10', hoverCheck(picked))} />
      <div class="relative">
        {it.type === 'image' ? (
          <>
            <ImageThumb blobId={it.id} alt={it.name} class="aspect-[4/3] w-full rounded-none!" onOpen={entry.click} />
            {it.video && (
              <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="grid size-10 place-items-center rounded-full bg-black/60 text-white">
                  <Icon name="play" class="size-4" />
                </span>
              </span>
            )}
          </>
        ) : (
          <button type="button" class="block aspect-[4/3] w-full overflow-hidden bg-sunken px-3 pt-3 text-left" onClick={entry.click} aria-label={t('filer.openItem', { name: it.name })}>
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
        <span class="pointer-events-none absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">{it.ext || 'txt'}</span>
      </div>
      <div class="flex min-w-0 flex-1 items-start">
        <button type="button" class="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left" onClick={entry.click}>
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
        <EntryMenu entry={entry} class="mt-1 mr-1" />
      </div>
    </div>
  );
});

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
  const entry = useEntry(rowKey, api);
  const drop = useDropTarget(dropFolder ?? '', api);
  return (
    <tr
      data-entry={rowKey}
      class={cx('group border-b border-line select-none [-webkit-touch-callout:none]', picked ? 'bg-accent-soft' : dropFolder !== undefined && drop.over ? 'bg-accent-soft' : 'hover:bg-glass')}
      {...entry.handlers}
      {...(dropFolder !== undefined ? drop.handlers : {})}
    >
      <td class="py-1.5 pl-1">
        <Checkbox checked={picked} label={t('filer.select', { name: label })} onChange={(_, e) => entry.pick(e)} />
      </td>
      <td class="py-1.5">
        <button type="button" class="flex w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-ink-strong" onClick={entry.click}>
          <Icon name={icon} class="size-4 shrink-0 text-muted" />
          <span class="truncate">{name}</span>
        </button>
      </td>
      <td class="hidden py-1.5 text-xs text-muted uppercase sm:table-cell">{details[0]}</td>
      <td class="hidden py-1.5 text-xs text-muted tabular-nums sm:table-cell">{details[1]}</td>
      <td class="py-1.5 text-xs text-muted tabular-nums">{details[2]}</td>
      <td class="hidden truncate py-1.5 text-xs text-muted lg:table-cell">{details[3]}</td>
      <td class="w-9 py-1 text-right">
        <EntryMenu entry={entry} />
      </td>
    </tr>
  );
}

export function ListView({
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
