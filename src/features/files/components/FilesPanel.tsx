// The Files tab in the sidebar: the file manager's three ways of showing things, by folder (from the top), by type
// and by chat
import { useMemo, useRef } from 'preact/hooks';
import { conversationTitles } from '../../../state/conversations';
import { mainView } from '../../../state/ui';
import { Icon, MoreMark, RowHighlight, cx, useBatches, useSelectedBox } from '../../../components/ui';
import { conversationsWithItems, foldersWithItems, inView } from '../filer/items';
import { filerConversation, filerFolder, filerView, openFiler, openFolder, type FilerView } from '../state';
import { useFilerItems, viewLabel, VIEW_ICONS } from '../filer/use-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

/** The types listed, each across every folder ('all' is the top of the folders) */
const VIEWS: FilerView[] = ['text', 'image', 'document', 'upload'];
/** Folders and chats drawn at once (more as the panel scrolls: a chat that made files makes a folder, so both run to thousands) */
const BATCH = 100;

export function FilesPanel() {
  const items = useFilerItems();
  const navRef = useRef<HTMLElement>(null);
  // The open view's background slides to it (like the conversation list)
  const current = useSelectedBox(navRef, '[aria-current="page"]');
  const onFiler = mainView.value.kind === 'files';
  const view = filerView.value;
  const conv = filerConversation.value;
  const folder = filerFolder.value;
  const titles = conversationTitles.value;
  // Counted again only when the items or the titles change, not when a view is chosen
  const { counts, folders, convs } = useMemo(() => {
    const list = items ?? [];
    return {
      counts: new Map(VIEWS.map((v) => [v, list.filter((it) => inView(it, v)).length])),
      folders: foldersWithItems(list),
      // Only chats that still exist (items of deleted chats stay, without a chat filter)
      convs: conversationsWithItems(list).flatMap((c) => {
        const title = titles.get(c.id);
        return title === undefined ? [] : [{ ...c, title }];
      })
    };
  }, [items, titles]);
  const batches = useBatches(folders.length + convs.length, BATCH, navRef, []);
  const shownConvs = Math.max(0, batches.limit - folders.length);
  const row = (active: boolean) => cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'text-ink-strong' : 'hover:bg-glass-strong');
  return (
    <nav ref={navRef} class="scroll-thin relative isolate min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2" aria-label={t('panel.nav')}>
      <RowHighlight box={current} class="inset-x-2" />
      <section>
        <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byFolder')}</h3>
        <ul>
          <li>
            <button type="button" aria-current={onFiler && view === 'all' && !conv && !folder ? 'page' : undefined} class={row(onFiler && view === 'all' && !conv && !folder)} onClick={() => openFolder(null)}>
              <Icon name={VIEW_ICONS.all} class="size-4 shrink-0 text-muted" />
              <span class="flex-1 truncate">{viewLabel('all')}</span>
              <span class="text-xs text-muted tabular-nums">{items ? formatNumber(items.length) : ''}</span>
            </button>
          </li>
          {folders.slice(0, batches.limit).map((f) => {
            const active = onFiler && folder === f.folder && !conv && view === 'all';
            return (
              <li key={f.folder}>
                <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFolder(f.folder)}>
                  <Icon name="folder" class="size-4 shrink-0 text-faint" />
                  <span class="flex-1 truncate">{f.folder.slice(0, -1)}</span>
                  <span class="text-xs text-muted tabular-nums">{formatNumber(f.count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byType')}</h3>
        <ul>
          {VIEWS.map((v) => {
            const active = onFiler && view === v && !conv;
            return (
              <li key={v}>
                <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler(v, null, null)}>
                  <Icon name={VIEW_ICONS[v]} class="size-4 shrink-0 text-muted" />
                  <span class="flex-1 truncate">{viewLabel(v)}</span>
                  <span class="text-xs text-muted tabular-nums">{items ? formatNumber(counts.get(v) ?? 0) : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {convs.length > 0 && shownConvs > 0 && (
        <section>
          <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byConversation')}</h3>
          <ul>
            {convs.slice(0, shownConvs).map((c) => {
              const active = onFiler && conv === c.id && !folder && view === 'all';
              return (
                <li key={c.id}>
                  <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler('all', c.id, null)}>
                    <Icon name="chat" class="size-4 shrink-0 text-faint" />
                    <span class="flex-1 truncate">{c.title}</span>
                    <span class="text-xs text-muted tabular-nums">{formatNumber(c.count)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <MoreMark batches={batches} />
    </nav>
  );
}
