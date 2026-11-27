// The Files tab in the sidebar: the file manager's filters (by type, by folder, or by chat)
import { useRef } from 'preact/hooks';
import { mainView } from '../../../state/ui';
import { Icon, RowHighlight, cx, useSelectedBox } from '../../../components/ui';
import { conversationsWithItems, foldersWithItems, inView } from '../filer';
import { filerConversation, filerFolder, filerView, openFiler, type FilerView } from '../state';
import { convTitle, useFilerItems, viewLabel, VIEW_ICONS } from './filer-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const VIEWS: FilerView[] = ['all', 'text', 'image', 'document', 'upload'];

export function FilesPanel() {
  const items = useFilerItems();
  const navRef = useRef<HTMLElement>(null);
  // The open view's background slides to it (like the conversation list)
  const current = useSelectedBox(navRef, '[aria-current="page"]');
  const onFiler = mainView.value.kind === 'files';
  const view = filerView.value;
  const conv = filerConversation.value;
  const folder = filerFolder.value;
  const count = (v: FilerView) => (items ? items.filter((it) => inView(it, v)).length : undefined);
  // Only chats that still exist (items of deleted chats stay, without a chat filter)
  const convs = items ? conversationsWithItems(items).filter((c) => convTitle(c.id) !== undefined) : [];
  const folders = items ? foldersWithItems(items) : [];
  const row = (active: boolean) => cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'text-ink-strong' : 'hover:bg-glass-strong');
  return (
    <nav ref={navRef} class="scroll-thin relative isolate min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2" aria-label={t('panel.nav')}>
      <RowHighlight box={current} class="inset-x-2" />
      <ul>
        {VIEWS.map((v) => {
          const active = onFiler && view === v && !conv && !folder;
          return (
            <li key={v}>
              <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler(v, null, null)}>
                <Icon name={VIEW_ICONS[v]} class="size-4 shrink-0 text-muted" />
                <span class="flex-1 truncate">{viewLabel(v)}</span>
                <span class="text-xs text-muted tabular-nums">{items ? formatNumber(count(v) ?? 0) : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {folders.length > 0 && (
        <section>
          <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byFolder')}</h3>
          <ul>
            {folders.map((f) => {
              const active = onFiler && folder === f.folder && !conv && view === 'all';
              return (
                <li key={f.folder}>
                  <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler('all', null, f.folder)}>
                    <Icon name="folder" class="size-4 shrink-0 text-faint" />
                    <span class="flex-1 truncate">{f.folder.slice(0, -1)}</span>
                    <span class="text-xs text-muted tabular-nums">{formatNumber(f.count)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {convs.length > 0 && (
        <section>
          <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byConversation')}</h3>
          <ul>
            {convs.map((c) => {
              const active = onFiler && conv === c.id && !folder && view === 'all';
              return (
                <li key={c.id}>
                  <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler('all', c.id, null)}>
                    <Icon name="chat" class="size-4 shrink-0 text-faint" />
                    <span class="flex-1 truncate">{convTitle(c.id) ?? t('deletedConversation')}</span>
                    <span class="text-xs text-muted tabular-nums">{formatNumber(c.count)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </nav>
  );
}
