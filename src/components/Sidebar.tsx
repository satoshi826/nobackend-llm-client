// Sidebar: tabs (conversations + tabs registered by features), notices, settings
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from './dialog';
import type { Conversation } from '../lib/db/schema';
import { conversations, countMadeIn, currentId, openConversation, removeConversation, searchMessages, showChat, startNewChat, updateConversation, type SearchHit } from '../state/conversations';
import { abortConversation, streamingConv } from '../state/runs';
import { balanceAlerts } from '../state/balance';
import { clearLeftoverLocalKeys, leftoverLocalKeys } from '../state/keys';
import { dataLock, lockNow } from '../state/lock';
import { providerById } from '../state/models';
import { newerBuild } from '../state/version';
import { openSettings, showToast, sidebarOpen, sidebarTab } from '../state/ui';
import { Button, EmptyState, Icon, IconButton, RowHighlight, SearchField, Segmented, TextField, cx, useSelectedBox } from './ui';
import { askConfirm, askConfirmWithCheck } from './ConfirmDialog';
import { sidebarTabs, textOf } from './extensions';
import { t } from './messages';
import { formatDate, formatNumber } from '../lib/i18n';

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

function Row({ c, active, snippet }: { c: Conversation; active: boolean; snippet?: string }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
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
        <TextField compact
          class="w-full"
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
    <div class={cx('group flex items-center rounded-lg', !active && 'hover:bg-glass-strong')}>
      <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left text-sm" onClick={() => openConversation(c.id)} aria-current={active}>
        {c.temporary && <Icon name="ghost" class="size-3.5 shrink-0 text-accent-text" />}
        {c.pinned ? <Icon name="pin" class="size-3.5 shrink-0 text-faint" /> : null}
        <span class="min-w-0">
          <span class="block truncate">{c.title}</span>
          {snippet && <span class="block truncate text-xs text-muted">{snippet}</span>}
        </span>
        {live && <span class="ml-auto size-1.5 shrink-0 motion-safe:animate-pulse rounded-full bg-accent" aria-label={t('side.generating')} />}
      </button>
      {/* Always shown on touch devices (no hover) */}
      <div class="hidden shrink-0 items-center pr-1 group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
        <IconButton label={c.pinned ? t('side.unpin') : t('side.pin')} onClick={() => updateConversation({ pinned: c.pinned ? 0 : 1 }, c.id)} class="px-1!">
          <Icon name="pin" class="size-3.5" />
        </IconButton>
        <IconButton
          label={t('side.rename')}
          onClick={() => {
            setTitle(c.title);
            setRenaming(true);
          }}
          class="px-1!"
        >
          <Icon name="edit" class="size-3.5" />
        </IconButton>
        <IconButton
          label={t('side.delete')}
          variant="remove"
          class="px-1!"
          onClick={async () => {
            // Its images and files outlive it unless the user ticks the box
            const n = await countMadeIn(c.id);
            const a = await askConfirmWithCheck({
              title: t('side.deleteTitle'),
              message: t('side.deleteMessage', { title: c.title }),
              confirmLabel: t('side.delete'),
              danger: true,
              check: n ? { label: t('side.deleteItems', { n: formatNumber(n) }), desc: t('side.deleteItemsDesc') } : undefined
            });
            if (a) void removeConversation(c.id, { beforeRemove: abortConversation, withItems: a.checked });
          }}
        >
          <Icon name="trash" class="size-3.5" />
        </IconButton>
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
  if (newerBuild.value)
    items.push(
      <div key="update" role="status" class="rounded-lg bg-glass-strong px-3 py-2 text-xs text-ink">
        <div class="font-semibold text-ink-strong">{t('side.updateTitle')}</div>
        {t('side.updateText')}
        <button type="button" class="ml-1 underline" onClick={() => location.reload()}>
          {t('side.updateReload')}
        </button>
      </div>
    );
  return items.length ? <div class="flex flex-col gap-2 px-2 pb-2">{items}</div> : null;
}

const MOBILE = '(max-width: 767px)';

export function Sidebar() {
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // The open conversation's background slides to it (like the settings tabs)
  const current = useSelectedBox(navRef, '[aria-current="true"]');
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
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const r = await searchMessages(q, ctrl.signal);
      if (!ctrl.signal.aborted) setHits(new Map(r.map((h) => [h.conversationId, h])));
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [q]);
  const tab = sidebarTab.value;
  const allTabs = [{ id: 'chats', label: t('side.chats'), icon: 'chat' as const }, ...sidebarTabs];
  const ActivePanel = sidebarTabs.find((x) => x.id === tab)?.Panel;
  const ql = q.trim().toLowerCase();
  const openId = currentId.value;
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
          <Segmented
            label={t('side.tabsLabel')}
            items={allTabs.map((x) => ({ id: x.id, label: textOf(x.label), icon: x.icon }))}
            value={tab}
            onChange={(id) => {
              if (id === 'chats') showChat();
              else {
                sidebarTab.value = id;
                sidebarTabs.find((y) => y.id === id)?.onSelect?.();
              }
            }}
            stretch
            class="m-2"
          />
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
          <SearchField placeholder={t('side.searchPlaceholder')} label={t('side.searchLabel')} value={q} onInput={setQ} />
        </div>
        <nav ref={navRef} class="scroll-thin relative isolate flex-1 space-y-3 overflow-y-auto px-2 pb-2">
          <RowHighlight box={current} class="inset-x-2" />
          {pinned.length > 0 && (
            <section>
              <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{t('side.pinned')}</h3>
              {pinned.map((c) => (
                <Row key={c.id} c={c} active={c.id === openId} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          )}
          {groups.map(([label, cs]) => (
            <section key={label}>
              <h3 class="px-2.5 py-1 text-xs font-medium text-muted">{label}</h3>
              {cs.map((c) => (
                <Row key={c.id} c={c} active={c.id === openId} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          ))}
          {list.length === 0 && <EmptyState icon={q ? 'search' : 'chat'}>{q ? t('side.notFound') : t('side.empty')}</EmptyState>}
        </nav>
        </>
        )}
        <Notices />
        <div class="flex items-center gap-2 border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button class="justify-start" onClick={() => openSettings()}>
            <Icon name="settings" />
            {t('side.settings')}
          </Button>
          {dataLock.value === 'unlocked' && (
            <IconButton label={t('side.lock')} title={t('side.lockTitle')} onClick={() => void lockNow()}>
              <Icon name="lock" />
            </IconButton>
          )}
        </div>
      </aside>
    </>
  );
}
