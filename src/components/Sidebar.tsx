// 会話一覧のサイドバー: 新規 / 検索 / 一覧 / お知らせ / 設定
import { useEffect, useState } from 'preact/hooks';
import { searchMessages, type SearchHit } from '../lib/db/repo';
import type { Conversation } from '../lib/db/schema';
import {
  abortConversation,
  balances,
  balanceAlerts,
  providerById,
  clearLeftoverLocalKeys,
  conversations,
  currentConv,
  currentId,
  isDraft,
  leftoverLocalKeys,
  openConversation,
  openSettings,
  removeConversation,
  settings,
  showToast,
  sidebarOpen,
  startNewChat,
  streamingConv,
  updateConversation
} from '../state/app';
import { Button, Icon, cx } from './ui';
import { askConfirm } from './ConfirmDialog';

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return '今日';
  if (ts >= start - 86400_000) return '昨日';
  if (ts >= start - 7 * 86400_000) return '過去 7 日間';
  if (ts >= start - 30 * 86400_000) return '過去 30 日間';
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
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
          class="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={title}
          autoFocus
          aria-label="会話の名前"
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
        />
      </form>
    );
  }
  return (
    <div class={cx('group flex items-center rounded-lg', active ? 'bg-zinc-200/70 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900')}>
      <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left text-sm" onClick={() => openConversation(c.id)} aria-current={active}>
        {c.temporary && <Icon name="ghost" class="size-3.5 shrink-0 text-sky-600" />}
        {c.pinned ? <Icon name="pin" class="size-3.5 shrink-0 text-zinc-400" /> : null}
        <span class="min-w-0">
          <span class="block truncate">{c.title}</span>
          {snippet && <span class="block truncate text-xs text-zinc-500">{snippet}</span>}
        </span>
        {live && <span class="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500" aria-label="生成中" />}
      </button>
      {/* タッチ端末（hover なし）では常に表示 */}
      <div class="hidden shrink-0 items-center pr-1 group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
        <Button aria-label={c.pinned ? 'ピン留めを外す' : 'ピン留め'} title={c.pinned ? 'ピン留めを外す' : 'ピン留め'} onClick={() => updateConversation({ pinned: c.pinned ? 0 : 1 }, c.id)} class="px-1!">
          <Icon name="pin" class="size-3.5" />
        </Button>
        <Button
          aria-label="名前を変更"
          title="名前を変更"
          onClick={() => {
            setTitle(c.title);
            setRenaming(true);
          }}
          class="px-1!"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
        <Button
          aria-label="削除"
          title="削除"
          class="px-1! hover:text-rose-600"
          onClick={() =>
            void askConfirm({ title: '会話を削除', message: `「${c.title}」を削除します。この操作は取り消せません。`, confirmLabel: '削除', danger: true }).then((ok) => {
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

/** 気づいてほしいこと（1 か所にまとめて表示） */
function Notices() {
  const s = settings.value;
  const backupDays = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86400_000) : null;
  const needBackup = conversations.value.length >= 5 && (backupDays === null || backupDays >= 14);
  const items = [];
  for (const [pid, b] of balanceAlerts.value) {
    const name = providerById(pid)?.name ?? pid;
    items.push(
      <div key={`balance-${pid}`} role="alert" class="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
        <div class="font-semibold">
          {name} の残高がこのアプリでの利用分より ${b.unexplainedUsd.toFixed(2)} 多く減っています
        </div>
        キーが他の場所で使われている可能性があります。心当たりがなければ、{name} の管理画面でキーを無効化してください。
      </div>
    );
  }
  if (leftoverLocalKeys.value)
    items.push(
      <div key="leftover" role="alert" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        <div class="font-semibold">このサイトに以前の API キーが残っています</div>
        今は別オリジンのキー金庫を使っているので不要です。
        <button
          type="button"
          class="ml-1 underline"
          onClick={() =>
            void askConfirm({ title: '残っているキーを削除', message: 'このサイト（アプリと同じオリジン）に保存されている以前の API キーを削除します。キー金庫のキー・会話・設定には影響しません。', confirmLabel: '削除', danger: true }).then(
              (ok) => {
                if (ok) void clearLeftoverLocalKeys().then(() => showToast('残っていたキーを削除しました'));
              }
            )
          }
        >
          削除する
        </button>
      </div>
    );
  if (needBackup)
    items.push(
      <button key="backup" type="button" class="rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" onClick={() => openSettings('privacy')}>
        ブラウザのデータは消えることがあります。{backupDays === null ? 'まだバックアップがありません。' : `最後のバックアップから ${backupDays} 日経っています。`}
      </button>
    );
  return items.length ? <div class="flex flex-col gap-2 px-2 pb-2">{items}</div> : null;
}

export function Sidebar() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Map<string, SearchHit>>(new Map());
  // 本文の全文検索（入力が止まってから 200ms 後）
  useEffect(() => {
    if (!q.trim()) {
      setHits(new Map());
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchMessages(q);
      if (!cancelled) setHits(new Map(r.map((h) => [h.conversationId, h])));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);
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
  const tempDraft = isDraft.value && !!currentConv.value.temporary;

  return (
    <>
      {sidebarOpen.value && <div class="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => (sidebarOpen.value = false)} />}
      <aside
        class={cx(
          'fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform md:static md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-950',
          sidebarOpen.value ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="会話一覧"
      >
        <div class="flex items-center gap-1 p-2">
          <Button variant="outline" class="flex-1 justify-start" onClick={() => startNewChat(false)}>
            <Icon name="plus" />
            新しいチャット
          </Button>
          <Button
            variant="outline"
            title="一時チャット（保存しない）"
            aria-label="一時チャット"
            aria-pressed={tempDraft}
            class={cx(tempDraft && 'border-sky-400 text-sky-700 dark:text-sky-300')}
            onClick={() => startNewChat(true)}
          >
            <Icon name="ghost" />
          </Button>
        </div>
        <div class="px-2 pb-2">
          <label class="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-sm dark:bg-zinc-900">
            <Icon name="search" class="size-3.5 text-zinc-400" />
            <input class="w-full bg-transparent outline-none" placeholder="会話を検索（本文も対象）" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="会話を検索" />
          </label>
        </div>
        <nav class="scroll-thin flex-1 space-y-3 overflow-y-auto px-2 pb-2">
          {pinned.length > 0 && (
            <section>
              <h3 class="px-2.5 py-1 text-xs font-medium text-zinc-500">ピン留め</h3>
              {pinned.map((c) => (
                <Row key={c.id} c={c} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          )}
          {groups.map(([label, cs]) => (
            <section key={label}>
              <h3 class="px-2.5 py-1 text-xs font-medium text-zinc-500">{label}</h3>
              {cs.map((c) => (
                <Row key={c.id} c={c} snippet={ql ? hits.get(c.id)?.snippet : undefined} />
              ))}
            </section>
          ))}
          {list.length === 0 && <p class="px-2.5 py-4 text-sm text-zinc-500">{q ? '見つかりません' : 'まだ会話はありません'}</p>}
        </nav>
        <Notices />
        <div class="flex items-center gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
          <Button class="justify-start" onClick={() => openSettings()}>
            <Icon name="settings" />
            設定
          </Button>
          <span class="ml-auto flex flex-col items-end text-xs text-zinc-500 tabular-nums">
            {Object.entries(balances.value).map(([pid, b]) =>
              b.last ? (
                <span key={pid} title={`${providerById(pid)?.name ?? pid} の残高（最終確認: ${new Date(b.last.at).toLocaleTimeString()}）`}>
                  {Object.keys(balances.value).length > 1 ? `${providerById(pid)?.name ?? pid} ` : '残高 '}${b.last.usd.toFixed(2)}
                </span>
              ) : null
            )}
          </span>
        </div>
      </aside>
    </>
  );
}
