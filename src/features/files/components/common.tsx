// Small shared pieces of the Files feature UI
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import type { FileRecord } from '../../../lib/db/schema';
import { baseName, extOf, folderOf } from '../../../lib/paths';
import { formatDate as fmtDate, formatTime } from '../../../lib/i18n';
import { useRef, useState } from 'preact/hooks';
import { Button, Icon, IconButton, cx, type IconName } from '../../../components/ui';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { openFolder } from '../state';
import { conversationTitles, openConversation } from '../../../state/conversations';
import { t } from '../messages';

/** Something a menu offers. note: a short note after its name (what it costs); danger: deleting (last, apart, in red) */
export interface MenuAction {
  icon: IconName;
  label: string;
  run(): void;
  note?: string;
  danger?: boolean;
}

/**
 * The menus of the Files tab: on entries, beside a folder's path, and in a file's or an image's toolbar. Under "…" (or
 * another icon), or under a labelled button when text is given (pressed: what it opened is on screen). open and
 * onOpenChange: when the caller opens it too (an entry's, on a right click); else it keeps its own state. compact: the
 * small button of cards and rows. start: it opens to the right (for menus at the left)
 */
export function ActionMenu({
  actions,
  label = t('file.more'),
  icon = 'more',
  text,
  pressed,
  compact,
  start,
  open: shown,
  onOpenChange,
  class: cls
}: {
  /** The items, or a function that builds them when the menu opens (for menus on many entries) */
  actions: MenuAction[] | (() => MenuAction[]);
  label?: string;
  icon?: IconName;
  text?: string;
  pressed?: boolean;
  compact?: boolean;
  start?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  class?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = shown ?? own;
  const set = onOpenChange ?? setOwn;
  const wrap = useRef<HTMLSpanElement>(null);
  if (Array.isArray(actions) && !actions.length) return null;
  const items = open ? (typeof actions === 'function' ? actions() : actions) : [];
  const toggle = (e: MouseEvent) => {
    // On a card or a row, the click opens the menu only
    e.stopPropagation();
    set(!open);
  };
  const firstDanger = items.findIndex((a) => a.danger);
  return (
    <span ref={wrap} class={cls}>
      {text ? (
        <Button class={cx('text-sm', pressed && 'bg-glass-strong')} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <Icon name={icon} />
          <span class="hidden sm:inline">{text}</span>
          <Icon name="chevron-down" class={cx('size-3.5 transition-transform', open && 'rotate-180')} />
        </Button>
      ) : (
        <IconButton label={label} aria-haspopup="menu" aria-expanded={open} class={cx(compact && 'size-7! p-1!', open && 'bg-glass-strong')} onClick={toggle}>
          <Icon name={icon} class={compact ? 'size-4' : undefined} />
        </IconButton>
      )}
      {open && (
        <Popover anchor={wrap.current} onClose={() => set(false)} placement={start ? 'bottom-start' : 'bottom-end'} label={text ?? label} class="w-64">
          {items.map((a, i) => (
            <span key={i}>
              {i === firstDanger && i > 0 && <MenuSeparator />}
              <MenuItem
                icon={<Icon name={a.icon} class="mt-0.5 size-4 shrink-0" />}
                class={a.danger ? 'text-danger! hover:bg-danger-soft! focus-visible:bg-danger-soft!' : undefined}
                onSelect={() => {
                  set(false);
                  a.run();
                }}
              >
                {a.label}
                {a.note && <span class="ml-1.5 text-xs text-muted">{a.note}</span>}
              </MenuItem>
            </span>
          ))}
        </Popover>
      )}
    </span>
  );
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? formatTime(ts) : fmtDate(ts, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** Short type label from the file name */
export function typeLabel(f: Pick<FileRecord, 'name' | 'fromPdf'>): string {
  if (f.fromPdf) return 'PDF';
  return (extOf(f.name) || 'txt').toUpperCase();
}

/** A file's name with its folders dimmed (a name is a path: site/css/style.css); from: a folder shown, left out of the name */
/** One folder of a path, as a way back up to it ('' is the top); the Files tab's header and a file's header show paths with these */
export function Crumb({ folder, highlight, children, ...rest }: { folder: string; highlight?: boolean; children: ComponentChildren } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'onClick'>) {
  return (
    <button
      type="button"
      class={cx('max-w-[12rem] shrink-0 truncate rounded-md px-1.5 py-0.5 hover:bg-glass-strong hover:text-ink', highlight && 'bg-accent-soft text-ink')}
      onClick={() => openFolder(folder || null)}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The row under the Files tab's header: its left end (start), what it shows in the middle (center; not on narrow
 * screens, where the ends need the room), what can be done on the right (end). The ends keep their room; the middle
 * gives way (its name is cut short)
 */
export function SubBar({ start, center, end }: { start: ComponentChildren; center?: ComponentChildren; end: ComponentChildren }) {
  return (
    <div class="mx-3 grid min-h-11 grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-3 pt-3 pb-2 sm:mx-4 md:mr-7 md:ml-1">
      <div class="flex items-center gap-1.5">{start}</div>
      {/* Kept as an empty cell on narrow screens, so the right end stays at the right */}
      <div class="flex min-w-0 justify-center">
        <div class="hidden min-w-0 items-center gap-1.5 sm:flex">{center}</div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">{end}</div>
    </div>
  );
}

/** The path of the folder something is in ('' is the top), as the Files tab shows it there: each part leads back to that folder */
export function FolderCrumbs({ folder }: { folder: string }) {
  const parts = folder.slice(0, -1).split('/').filter(Boolean);
  return (
    <nav class="flex min-w-0 items-center gap-0.5 text-sm text-muted" aria-label={t('folder.path')}>
      <Crumb folder="">{t('folder.top')}</Crumb>
      {parts.map((p, i) => (
        <span key={i} class="flex min-w-0 items-center gap-0.5">
          <Icon name="chevron-right" class="size-3.5 shrink-0 text-faint" />
          <Crumb folder={`${parts.slice(0, i + 1).join('/')}/`}>{p}</Crumb>
        </span>
      ))}
    </nav>
  );
}

/** The chat something was made in, as a link to it (shown while that chat exists) */
export function SourceChat({ conversationId }: { conversationId?: string }) {
  const title = conversationId ? conversationTitles.value.get(conversationId) : undefined;
  if (!conversationId || title === undefined) return null;
  return (
    <button
      type="button"
      class="flex max-w-[16rem] min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-glass-strong hover:text-ink"
      data-tip={t('file.openSourceTitle', { title })}
      onClick={() => void openConversation(conversationId)}
    >
      <Icon name="chat" class="size-3.5 shrink-0" />
      <span class="truncate">{title}</span>
    </button>
  );
}

export function PathName({ name, from }: { name: string; from?: string | null }) {
  if (from && name.toLowerCase().startsWith(from.toLowerCase())) name = name.slice(from.length);
  const folder = folderOf(name);
  return (
    <>
      {folder && <span class="text-muted">{folder}</span>}
      {baseName(name)}
    </>
  );
}

export function FileIcon({ f, class: cls = 'size-4' }: { f: Pick<FileRecord, 'origin'>; class?: string }) {
  return <Icon name={f.origin.kind === 'made' ? 'sparkle' : 'upload'} class={cls} />;
}
