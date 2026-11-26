// The Files tab in the sidebar: the file manager's filters (by type, or by chat)
import { useRef } from 'preact/hooks';
import { mainView } from '../../../state/ui';
import { Icon, RowHighlight, cx, useSelectedBox } from '../../../components/ui';
import { conversationsWithItems, inView } from '../filer';
import { filerConversation, filerView, openFiler, type FilerView } from '../state';
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
  const count = (v: FilerView) => (items ? items.filter((it) => inView(it, v)).length : undefined);
  // Only chats that still exist (items of deleted chats stay, without a chat filter)
  const convs = items ? conversationsWithItems(items).filter((c) => convTitle(c.id) !== undefined) : [];
  const row = (active: boolean) => cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'text-ink-strong' : 'hover:bg-glass-strong');
  return (
    <nav ref={navRef} class="scroll-thin relative isolate min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2" aria-label={t('panel.nav')}>
      <RowHighlight box={current} class="inset-x-2" />
      <ul>
        {VIEWS.map((v) => {
          const active = onFiler && view === v && !conv;
          return (
            <li key={v}>
              <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler(v, null)}>
                <Icon name={VIEW_ICONS[v]} class="size-4 shrink-0 text-muted" />
                <span class="flex-1 truncate">{viewLabel(v)}</span>
                <span class="text-xs text-muted tabular-nums">{items ? formatNumber(count(v) ?? 0) : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {convs.length > 0 && (
        <section>
          <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('panel.byConversation')}</h3>
          <ul>
            {convs.map((c) => {
              const active = onFiler && conv === c.id && view === 'all';
              return (
                <li key={c.id}>
                  <button type="button" aria-current={active ? 'page' : undefined} class={row(active)} onClick={() => openFiler('all', c.id)}>
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
