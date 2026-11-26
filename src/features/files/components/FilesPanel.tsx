// The Files tab in the sidebar: upload, search and navigation for the file manager in the main area
import { useRef } from 'preact/hooks';
import { conversations } from '../../../state/conversations';
import { mainView } from '../../../state/ui';
import { Button, Icon, RowHighlight, SearchField, cx, useSelectedBox, type IconName } from '../../../components/ui';
import { conversationsWithItems, inView } from '../filer';
import { filerConversation, filerQuery, filerView, importFromDevice, openFiler, type FilerView } from '../state';
import { useFilerItems, viewLabel } from './filer-items';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const VIEWS: [FilerView, IconName][] = [
  ['all', 'files'],
  ['recent', 'clock'],
  ['document', 'file'],
  ['upload', 'paperclip'],
  ['image', 'image']
];

export function FilesPanel() {
  const items = useFilerItems();
  const input = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // The open view's background slides to it (like the conversation list)
  const current = useSelectedBox(navRef, '[aria-current="page"]');
  const onFiler = mainView.value.kind === 'files';
  const view = filerView.value;
  const conv = filerConversation.value;
  const now = Date.now();
  const count = (v: FilerView) => (items ? items.filter((it) => inView(it, v, now)).length : undefined);
  const convs = items ? conversationsWithItems(items) : [];
  const title = (id: string) => conversations.value.find((c) => c.id === id)?.title;
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="space-y-2 px-2 pb-2">
        <Button variant="outline" class="w-full justify-start" onClick={() => input.current?.click()}>
          <Icon name="upload" />
          {t('upload')}
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
            if (files.length) {
              openFiler();
              void importFromDevice(files);
            }
          }}
        />
        <SearchField
          placeholder={t('panel.search')}
          label={t('panel.searchLabel')}
          value={filerQuery.value}
          onInput={(v) => {
            filerQuery.value = v;
            if (!onFiler) openFiler();
          }}
        />
      </div>
      <nav ref={navRef} class="scroll-thin relative isolate flex-1 space-y-3 overflow-y-auto px-2 pb-2" aria-label={t('panel.nav')}>
        <RowHighlight box={current} class="inset-x-2" />
        <ul>
          {VIEWS.map(([v, icon]) => {
            const active = onFiler && view === v && !conv;
            return (
              <li key={v}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  class={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'text-ink-strong' : 'hover:bg-glass-strong')}
                  onClick={() => openFiler(v, null)}
                >
                  <Icon name={icon} class="size-4 shrink-0 text-muted" />
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
                const active = onFiler && conv === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      class={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'text-ink-strong' : 'hover:bg-glass-strong')}
                      onClick={() => openFiler('all', c.id)}
                    >
                      <Icon name="chat" class="size-4 shrink-0 text-faint" />
                      <span class="flex-1 truncate">{title(c.id) ?? t('deletedConversation')}</span>
                      <span class="text-xs text-muted tabular-nums">{formatNumber(c.count)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </nav>
    </div>
  );
}
