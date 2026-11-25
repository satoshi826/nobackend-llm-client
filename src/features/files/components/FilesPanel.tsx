// The Files tab in the sidebar: upload, search and navigation for the file manager in the main area
import { useRef } from 'preact/hooks';
import { conversations, mainView } from '../../../state/app';
import { Button, Icon, cx, type IconName } from '../../../components/ui';
import { conversationsWithItems, inView } from '../filer';
import { filerConversation, filerQuery, filerView, importFromDevice, openFiler, type FilerView } from '../state';
import { useFilerItems, VIEW_LABEL } from './Filer';

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
          アップロード
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
        <label class="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-sky-500/60 dark:bg-zinc-900">
          <Icon name="search" class="size-3.5 text-zinc-400" />
          <input
            class="w-full bg-transparent outline-none"
            placeholder="ファイルを検索（中身も対象）"
            value={filerQuery.value}
            onInput={(e) => {
              filerQuery.value = (e.target as HTMLInputElement).value;
              if (!onFiler) openFiler();
            }}
            aria-label="ファイルを検索"
          />
        </label>
      </div>
      <nav class="scroll-thin flex-1 space-y-3 overflow-y-auto px-2 pb-2" aria-label="ファイルの表示">
        <ul>
          {VIEWS.map(([v, icon]) => {
            const active = onFiler && view === v && !conv;
            return (
              <li key={v}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  class={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'bg-zinc-200/70 font-medium dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900')}
                  onClick={() => openFiler(v, null)}
                >
                  <Icon name={icon} class="size-4 shrink-0 text-zinc-500" />
                  <span class="flex-1 truncate">{VIEW_LABEL[v]}</span>
                  <span class="text-xs text-zinc-500 tabular-nums">{count(v) ?? ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {convs.length > 0 && (
          <section>
            <h3 class="px-2.5 py-1 text-xs font-medium text-zinc-500">会話ごと</h3>
            <ul>
              {convs.map((c) => {
                const active = onFiler && conv === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      class={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', active ? 'bg-zinc-200/70 font-medium dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900')}
                      onClick={() => openFiler('all', c.id)}
                    >
                      <Icon name="chat" class="size-4 shrink-0 text-zinc-400" />
                      <span class="flex-1 truncate">{title(c.id) ?? '削除された会話'}</span>
                      <span class="text-xs text-zinc-500 tabular-nums">{c.count}</span>
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
