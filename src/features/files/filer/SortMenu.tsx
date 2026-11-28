// How the file manager sorts: the sort menu, and the list's column headings (one state for both)
import { useRef, useState } from 'preact/hooks';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { Icon, IconButton, cx, type IconName } from '../../../components/ui';
import { NATURAL_ORDER } from './items';
import { filerPrefs, setFilerPrefs, type FilerPrefs, type FilerSort } from '../state';
import { t } from '../messages';

const SORT_KEYS = { updated: 'sort.updated', name: 'sort.name', type: 'sort.type', size: 'sort.size' } as const;

/** Choosing a sort key starts it in its natural direction (newest, largest, A first); the same key turns it around */
function sortBy(k: FilerSort) {
  const p = filerPrefs.value;
  void setFilerPrefs(p.sort === k ? { order: p.order === 'asc' ? 'desc' : 'asc' } : { sort: k, order: NATURAL_ORDER[k] });
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
export function SortMenu({ prefs }: { prefs: FilerPrefs }) {
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

/** A column heading that sorts by its key (the same state as the sort menu) */
export function SortHead({ k, prefs, class: cls }: { k: FilerSort; prefs: FilerPrefs; class?: string }) {
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
