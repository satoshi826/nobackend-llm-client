// Sidebar: tabs (conversations + tabs registered by features), notices, settings
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from './dialog';
import { searchMessages, type SearchHit } from '../lib/db/repo';
import type { Conversation } from '../lib/db/schema';
import { conversations, currentId, openConversation, removeConversation, showChat, startNewChat, updateConversation } from '../state/conversations';
import { abortConversation, streamingConv } from '../state/runs';
import { balanceAlerts } from '../state/balance';
import { clearLeftoverLocalKeys, leftoverLocalKeys } from '../state/keys';
import { dataLock, lockNow } from '../state/lock';
import { providerById } from '../state/models';
import { openSettings, showToast, sidebarOpen, sidebarTab } from '../state/ui';
import { Button, Icon, Segmented, cx } from './ui';
import { askConfirm } from './ConfirmDialog';
import { sidebarTabs, textOf } from './extensions';
import { t } from './messages';
import { formatDate } from '../lib/i18n';

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return t('side.today');
  if (ts >= start - 86400_000) return t('side.yesterday');
  if (ts >= start - 7 * 86400_000) return t('side.last7');
  if (ts >= start - 30 * 86400_000) return t('side.last30');
  return formatDate(d, { year: 'numeric', month: 'long' });
}

function Row({ c, snippet }: { c: Conversation; snippet?: string }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  const active = currentId.value === c.id;
  const live = streamingConv.value.has(c.id);
  if (renaming) {
    return (
      <form
        class="px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          setRenaming(false);
          if (title.trim()) void updateConversation({ title: title.trim() }, c.id);
        }}
      >
        <input
          class="w-full rounded-md border border-line bg-glass px-2 py-1 text-sm"
          value={title}
          autoFocus
          aria-label={t('side.renameLabel')}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
        />
      </form>
    );
  }
  return (
    <div class={cx('group flex items-center rounded-lg', active ? 'bg-glass-strong' : 'hover:bg-glass-strong')}>
      <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left text-sm" onClick={() => openConversation(c.id)} aria-current={active}>
        {c.temporary && <Icon name="ghost" class="size-3.5 shrink-0 text-accent-text" />}
        {c.pinned ? <Icon name="pin" class="size-3.5 shrink-0 text-faint" /> : null}
        <span class="min-w-0">
          <span class="block truncate">{c.title}</span>
          {snippet && <span class="block truncate text-xs text-muted">{snippet}</span>}
        </span>
        {live && <span class="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label={t('side.generating')} />}
      </button>
      {/* Always shown on touch devices (no hover) */}
      <div class="hidden shrink-0 items-center pr-1 group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
        <Button aria-label={c.pinned ? t('side.unpin') : t('side.pin')} title={c.pinned ? t('side.unpin') : t('side.pin')} onClick={() => updateConversation({ pinned: c.pinned ? 0 : 1 }, c.id)} class="px-1!">
          <Icon name="pin" class="size-3.5" />
        </Button>
        <Button
          aria-label={t('side.rename')}
          title={t('side.rename')}
          onClick={() => {
            setTitle(c.title);
            setRenaming(true);
          }}
          class="px-1!"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
        <Button
          aria-label={t('side.delete')}
          title={t('side.delete')}
          class="px-1! hover:text-danger"
          onClick={() =>
            void askConfirm({
              title: t('side.deleteTitle'),
              message: t('side.deleteMessage', { title: c.title }),
              confirmLabel: t('side.delete'),
              danger: true
            }).then((ok) => {
              if (ok) void removeConversation(c.id, abortConversation);
            })
          }
        >
          <Icon name="trash" class="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Things that need the user's attention (shown together in one place) */
function Notices() {
  const items = [];
  for (const [pid, b] of balanceAlerts.value) {
    const name = providerById(pid)?.name ?? pid;
    items.push(
      <div key={`balance-${pid}`} role="alert" class="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
        <div class="font-semibold">
          {t('side.balanceAlertTitle', { name, amount: b.unexplainedUsd.toFixed(2) })}
        </div>
        {t('side.balanceAlertText', { name })}
      </div>
    );
  }
  if (leftoverLocalKeys.value)
    items.push(
      <div key="leftover" role="alert" class="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
        <div class="font-semibold">{t('side.leftoverTitle')}</div>
        {t('side.leftoverText')}
        <button
          type="button"
          class="ml-1 underline"
          onClick={() =>
            void askConfirm({ title: t('side.leftoverConfirmTitle'), message: t('side.leftoverConfirmMessage'), confirmLabel: t('side.delete'), danger: true }).then(
              (ok) => {
                if (ok) void clearLeftoverLocalKeys().then(() => showToast(t('side.leftoverDeleted')));
              }
            )
          }
        >
          {t('side.delete')}
        </button>
      </div>
    );
  return items.length ? <div class="flex flex-col gap-2 px-2 pb-2">{items}</div> : null;
}

const MOBILE = '(max-width: 767px)';

export function Sidebar() {
  const asideRef = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(MOBILE).matches);
  useEffect(() => {
    const mq = matchMedia(MOBILE);
    const f = () => setMobile(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  // On phones the sidebar is a drawer: a dialog while open, and out of the tab order while closed
  useDialog(asideRef, { onClose: () => (sidebarOpen.value = false), active: mobile && sidebarOpen.value });
  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = mobile && !sidebarOpen.value;
  }, [mobile, sidebarOpen.value]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Map<string, SearchHit>>(new Map());
  // Full-text search of message bodies (200ms after typing stops)
  useEffect(() => {
    if (!q.trim()) {
      setHits(new Map());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await searchMessages(q);
      if (!cancelled) setHits(new Map(r.map((h) => [h.conversationId, h])));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);
  const tab = sidebarTab.value;
  const allTabs = [{ id: 'chats', label: t('side.chats'), icon: 'chat' as const }, ...sidebarTabs];
  const ActivePanel = sidebarTabs.find((x) => x.id === tab)?.Panel;
  const ql = q.trim().toLowerCase();
  const list = conversations.value.filter((c) => !ql || c.title.toLowerCase().includes(ql) || hits.has(c.id));
  const pinned = list.filter((c) => c.pinned);
  const groups: [string, Conversation[]][] = [];
  for (const c of list.filter((c) => !c.pinned)) {
    const g = groupLabel(c.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(c);
    else groups.push([g, [c]]);
  }

  return (
    <>
      {sidebarOpen.value && <div data-dialog-backdrop class="backdrop fixed inset-0 z-20 md:hidden" onClick={() => (sidebarOpen.value = false)} />}
      <aside
        ref={asideRef}
        class={cx(
          'panel fixed inset-y-0 left-0 z-30 flex w-72 flex-col rounded-r-[22px] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] md:glass md:static md:translate-x-0 md:rounded-[22px] md:shadow-none',
          sidebarOpen.value ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label={t('side.label')}
      >
        {sidebarTabs.length > 0 && (
          <Segmented label={t('side.tabsLabel')} index={allTabs.findIndex((x) => x.id === tab)} count={allTabs.length} class="m-2">
            {allTabs.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                class={cx(
                  'relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 py-1.5 text-sm transition-colors duration-200',
                  tab === x.id ? 'font-medium text-ink-strong' : 'text-muted hover:text-ink'
                )}
                onClick={() => {
                  if (x.id === 'chats') showChat();
                  else {
                    sidebarTab.value = x.id;
                    sidebarTabs.find((y) => y.id === x.id)?.onSelect?.();
                  }
                }}
              >
                <Icon name={x.icon} class="size-3.5" />
                {textOf(x.label)}
              </button>
            ))}
          </Segmented>
        )}
        {ActivePanel ? (
          <ActivePanel />
        ) : (
        <>
        <div class={cx('space-y-2 px-2 pb-2', !sidebarTabs.length && 'pt-2')}>
          <Button variant="outline" class="w-full justify-start" onClick={() => startNewChat(false)}>
            <Icon name="plus" />
            {t('side.newChat')}
          </Button>
          <label class="flex items-center gap-2 rounded-lg bg-glass px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-accent/50">
            <Icon name="search" class="size-3.5 text-faint" />
            <input class="w-full bg-transparent outline-none" placeholder={t('side.searchPlaceholder')} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label={t('side.searchLabel')} />
          </label>
        </div>
        <nav class="scroll-thin flex-1 space-y-3 overflow-y-auto px-2 pb-2">
          {pinned.length > 0 && (
            <section>
              <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('side.pinned')}</h3>
              {pinned.map((c) => (
                <Row key={c.id} c={c} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          )}
          {groups.map(([label, cs]) => (
            <section key={label}>
              <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{label}</h3>
              {cs.map((c) => (
                <Row key={c.id} c={c} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          ))}
          {list.length === 0 && <p class="px-2.5 py-4 text-sm text-muted">{q ? t('side.notFound') : t('side.empty')}</p>}
        </nav>
        </>
        )}
        <Notices />
        <div class="flex items-center gap-2 border-t border-line p-2">
          <Button class="justify-start" onClick={() => openSettings()}>
            <Icon name="settings" />
            {t('side.settings')}
          </Button>
          {dataLock.value === 'unlocked' && (
            <Button aria-label={t('side.lock')} title={t('side.lockTitle')} onClick={() => void lockNow()}>
              <Icon name="lock" />
            </Button>
          )}
        </div>
      </aside>
    </>
  );
}
