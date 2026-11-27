// The Files tab's header, the same for the list and for a file shown on its own: where the user is on the left (title),
// the search on the right. On narrow screens the search is an icon that opens over the title
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PageHeader } from '../../../components/PageHeader';
import { Icon, IconButton, SearchField } from '../../../components/ui';
import { filerQuery } from '../state';
import { t } from '../messages';

/** A search typed in a file's header goes on in the list it opens: that list's field takes the focus */
let carryFocus = false;

/** How long typing pauses before a search typed in a file's header opens the list (the list's field takes over then) */
const HANDOVER_MS = 400;

/**
 * searchIn: the folder a search looks in ('' is everything; null when listing by type or chat). onSearch: where a
 * search goes from here (from a file: its folder's list), once typing pauses or on Enter. children: what lies over the
 * header (the selection's actions)
 */
export function FilesHeader({ title, searchIn, onSearch, children }: { title: ComponentChildren; searchIn: string | null; onSearch?: () => void; children?: ComponentChildren }) {
  // It stays open while it holds a query
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const handOver = () => {
    clearTimeout(timer.current);
    if (!onSearch || !filerQuery.value) return;
    carryFocus = true;
    onSearch();
  };
  const hint = searchIn ? t('filer.searchIn') : t('filer.search');
  const input = (v: string) => {
    filerQuery.value = v;
    if (!onSearch) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(handOver, HANDOVER_MS);
  };
  useEffect(() => {
    if (!carryFocus) return;
    carryFocus = false;
    // The field on screen (the wide one or the narrow one), with the caret after what was typed
    const field = [...(wrap.current?.querySelectorAll('input') ?? [])].find((el) => el.offsetParent !== null);
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, []);
  return (
    <div ref={wrap} class="contents" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && handOver()}>
      <PageHeader>
        {title}
        <div class="hidden w-44 shrink-0 sm:block lg:w-56">
          <SearchField class="w-full" placeholder={hint} label={t('filer.searchLabel')} value={filerQuery.value} onInput={input} />
        </div>
        <IconButton class="shrink-0 sm:hidden" label={t('filer.searchLabel')} onClick={() => setOpen(true)}>
          <Icon name="search" class="size-5" />
        </IconButton>
        {(open || !!filerQuery.value) && (
          <div class="panel absolute inset-0 flex items-center gap-1 rounded-2xl px-2 sm:hidden">
            <SearchField autoFocus class="min-w-0 flex-1" placeholder={hint} label={t('filer.searchLabel')} value={filerQuery.value} onInput={input} />
            <IconButton
              label={t('filer.closeSearch')}
              onClick={() => {
                filerQuery.value = '';
                setOpen(false);
              }}
            >
              <Icon name="x" class="size-5" />
            </IconButton>
          </div>
        )}
        {children}
      </PageHeader>
    </div>
  );
}
