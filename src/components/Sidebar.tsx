// Sidebar: tabs (conversations + tabs registered by features), notices, settings
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useComputed } from '@preact/signals';
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
import { DEFAULT_SETTINGS, SIDEBAR_WIDTH, saveSettings, settings } from '../state/settings';
import { Button, EmptyState, Icon, IconButton, MoreMark, RowHighlight, SearchField, Segmented, TextField, cx, useBatches, useSelectedBox } from './ui';
import { askConfirm, askConfirmWithCheck } from './ConfirmDialog';
import { sidebarTabs, textOf } from './extensions';
import { t } from './messages';
import { formatDate, formatNumber } from '../lib/i18n';

/** The label of the group a conversation last changed at `ts` goes in, counted from today (made once per listing) */
function grouper(): (ts: number) => string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const months = new Map<number, string>();
  return (ts) => {
    if (ts >= start) return t('side.today');
    if (ts >= start - 86400_000) return t('side.yesterday');
    if (ts >= start - 7 * 86400_000) return t('side.last7');
    if (ts >= start - 30 * 86400_000) return t('side.last30');
    const d = new Date(ts);
    const k = d.getFullYear() * 12 + d.getMonth();
    let label = months.get(k);
    if (label === undefined) months.set(k, (label = formatDate(d, { year: 'numeric', month: 'long' })));
    return label;
  };
}

/** Rows drawn at once in the conversation list (more as it scrolls) */
const BATCH = 100;

/** A conversation in the list; drawn again only when it, its being open, or its being answered changes */
const Row = memo(function Row({ c, active, snippet }: { c: Conversation; active: boolean; snippet?: string }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  // Whether this one is being answered (not the whole set: another conversation's answer does not draw this row)
  const live = useComputed(() => streamingConv.value.has(c.id)).value;
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
});

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

/**
 * The conversations tab: new chat, search, and the list grouped by when each conversation last changed. Kept apart
 * from the sidebar's frame, so opening or closing the sidebar does not draw the list again
 */
function Chats() {
  const navRef = useRef<HTMLElement>(null);
  // The open conversation's background slides to it (like the settings tabs)
  const current = useSelectedBox(navRef, '[aria-current="true"]');
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
  const ql = q.trim().toLowerCase();
  const openId = currentId.value;
  const all = conversations.value;
  // Pinned first, then the groups by date, as one list of headings and rows (so it can be drawn in batches)
  const lines = useMemo(() => {
    const list = all.filter((c) => !ql || c.title.toLowerCase().includes(ql) || hits.has(c.id));
    const out: ({ heading: string } | Conversation)[] = [];
    const pinned = list.filter((c) => c.pinned);
    if (pinned.length) out.push({ heading: t('side.pinned') }, ...pinned);
    const groupOf = grouper();
    let last = '';
    for (const c of list) {
      if (c.pinned) continue;
      const g = groupOf(c.updatedAt);
      if (g !== last) out.push({ heading: (last = g) });
      out.push(c);
    }
    return out;
  }, [all, ql, hits]);
  const batches = useBatches(lines.length, BATCH, navRef, [ql]);
  return (
    <>
      <div class={cx('space-y-2 px-2 pb-2', !sidebarTabs.length && 'pt-2')}>
        <Button variant="outline" class="w-full justify-start" onClick={() => startNewChat(false)}>
          <Icon name="plus" />
          {t('side.newChat')}
        </Button>
        <SearchField placeholder={t('side.searchPlaceholder')} label={t('side.searchLabel')} value={q} onInput={setQ} />
      </div>
      <nav ref={navRef} class="scroll-thin relative isolate flex-1 overflow-y-auto px-2 pb-2">
        <RowHighlight box={current} class="inset-x-2" />
        {lines.slice(0, batches.limit).map((x, i) =>
          'heading' in x ? (
            <h3 key={`h:${x.heading}`} class={cx('px-2.5 py-1 text-xs font-medium text-muted', i > 0 && 'mt-3')}>
              {x.heading}
            </h3>
          ) : (
            <Row key={x.id} c={x} active={x.id === openId} snippet={ql ? hits.get(x.id)?.snippet : undefined} />
          )
        )}
        <MoreMark batches={batches} />
        {lines.length === 0 && <EmptyState icon={q ? 'search' : 'chat'}>{q ? t('side.notFound') : t('side.empty')}</EmptyState>}
      </nav>
    </>
  );
}

/**
 * The sidebar's right edge on wide screens: dragged (or moved with the arrow keys) it sets the width, saved when let
 * go; a double click puts the default back
 */
function WidthHandle({ width, onWidth }: { width: number; onWidth(w: number): void }) {
  const fit = (w: number) => Math.round(Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, w)));
  const save = (w: number) => void saveSettings({ sidebarWidth: fit(w) });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('side.resize')}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      tabIndex={0}
      class="group/edge absolute inset-y-4 -right-2.5 z-10 hidden w-2 cursor-col-resize touch-none justify-center outline-none md:flex"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const from = e.clientX;
        let w = width;
        const move = (m: PointerEvent) => onWidth((w = fit(width + m.clientX - from)));
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          save(w);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onDblClick={() => {
        onWidth(DEFAULT_SETTINGS.sidebarWidth);
        save(DEFAULT_SETTINGS.sidebarWidth);
      }}
      onKeyDown={(e) => {
        const by = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
        if (!by) return;
        e.preventDefault();
        onWidth(fit(width + by));
        save(width + by);
      }}
    >
      <span class="h-full w-0.5 rounded-full bg-transparent transition-colors group-hover/edge:bg-line-strong group-focus-visible/edge:bg-accent group-active/edge:bg-accent" />
    </div>
  );
}

export function Sidebar() {
  const asideRef = useRef<HTMLElement>(null);
  // The saved width, or the one being dragged to (saved when the drag ends)
  const [dragged, setWidth] = useState<number | null>(null);
  const width = dragged ?? settings.value.sidebarWidth;
  useEffect(() => setWidth(null), [settings.value.sidebarWidth]);
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
  const tab = sidebarTab.value;
  const allTabs = [{ id: 'chats', label: t('side.chats'), icon: 'chat' as const }, ...sidebarTabs];
  const ActivePanel = sidebarTabs.find((x) => x.id === tab)?.Panel;

  return (
    <>
      {sidebarOpen.value && <div data-dialog-backdrop class="backdrop fixed inset-0 z-20 md:hidden" onClick={() => (sidebarOpen.value = false)} />}
      <aside
        ref={asideRef}
        class={cx(
          'panel fixed inset-y-0 left-0 z-30 flex w-72 flex-col rounded-r-[22px] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] md:glass md:relative md:w-(--sidebar-w) md:shrink-0 md:translate-x-0 md:rounded-[22px] md:shadow-none',
          sidebarOpen.value ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ '--sidebar-w': `${width}px` }}
        aria-label={t('side.label')}
      >
        <WidthHandle width={width} onWidth={setWidth} />
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
        {ActivePanel ? <ActivePanel /> : <Chats />}
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
