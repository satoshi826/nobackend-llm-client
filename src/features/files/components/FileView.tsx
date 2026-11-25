// A file in the main area: read, edit, go through versions, download, print (to PDF), use in a chat
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentVersion, extOf } from '../../../lib/db/files';
import type { FileRecord } from '../../../lib/db/schema';
import { conversations, openConversation, showChat, showToast, sidebarOpen } from '../../../state/app';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Markdown } from '../../../components/Markdown';
import { Badge, Button, Icon, Spinner, cx } from '../../../components/ui';
import { parseDelimited } from '../csv';
import { attachExisting, closeFileView, fileReturnsToChat, openFiler, deleteFiles, downloadFile, filesVersion, getFile, renameFile, restoreVersion, saveUserVersion } from '../state';
import { formatChars, typeLabel } from './common';

const BY: Record<string, string> = { model: 'モデル', user: 'あなた', upload: '取り込み' };

export function FileView({ id = '' }: { id?: string }) {
  const [f, setF] = useState<FileRecord | null | undefined>(undefined);
  const [viewV, setViewV] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void getFile(id).then((x) => setF(x ?? null));
  }, [id, filesVersion.value]);
  useEffect(() => {
    setViewV(null);
    setEditing(false);
    setRenaming(false);
  }, [id]);

  if (f === undefined)
    return (
      <main class="grid flex-1 place-items-center text-sm text-zinc-500">
        <Spinner class="size-5" />
      </main>
    );
  if (f === null)
    return (
      <main class="grid flex-1 place-items-center text-sm text-zinc-500">
        <div class="text-center">
          <p>このファイルは見つかりません（削除された可能性があります）。</p>
          <Button class="mt-3" variant="outline" onClick={closeFileView}>
            戻る
          </Button>
        </div>
      </main>
    );

  const latest = currentVersion(f);
  const shown = (viewV !== null && f.versions.find((v) => v.v === viewV)) || latest;
  const isOld = shown.v !== latest.v;
  const conv = f.conversationId ? conversations.value.find((c) => c.id === f.conversationId) : undefined;
  const ext = extOf(f.name);

  const print = () => {
    const src = body.current;
    if (!src) return;
    // Print a copy of the document alone (the app's own layout clips scrolling content)
    const root = document.createElement('div');
    root.id = 'print-root';
    const h = document.createElement('h1');
    h.textContent = f.name;
    root.append(h, src.cloneNode(true));
    document.body.append(root);
    const done = () => {
      root.remove();
      removeEventListener('afterprint', done);
    };
    addEventListener('afterprint', done);
    window.print();
  };

  return (
    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <Button class="md:hidden" aria-label="メニュー" onClick={() => (sidebarOpen.value = true)}>
          <Icon name="menu" />
        </Button>
        {fileReturnsToChat() ? (
          <Button aria-label="会話に戻る" title="会話に戻る" onClick={closeFileView}>
            <Icon name="chevron-left" />
          </Button>
        ) : (
          <>
            <button type="button" class="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" onClick={() => openFiler()}>
              ファイル
            </button>
            <Icon name="chevron-right" class="size-3.5 shrink-0 text-zinc-400" />
          </>
        )}
        {renaming ? (
          <form
            class="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== f.name) void renameFile(f.id, name.trim());
            }}
          >
            <input
              class="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={name}
              autoFocus
              aria-label="ファイル名"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            />
          </form>
        ) : (
          <button
            type="button"
            class="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="名前を変更"
            onClick={() => {
              setName(f.name);
              setRenaming(true);
            }}
          >
            <Icon name={f.kind === 'upload' ? 'paperclip' : 'file'} class={cx('size-4 shrink-0', f.kind === 'upload' ? 'text-emerald-600' : 'text-sky-600')} />
            <span class="truncate font-semibold">{f.name}</span>
          </button>
        )}
        <Badge>{typeLabel(f)}</Badge>
        <span class="hidden text-xs text-zinc-500 tabular-nums sm:inline">{formatChars(shown.text.length)}</span>
        <div class="ml-auto flex flex-wrap items-center gap-0.5">
          {f.versions.length > 1 && (
            <label class="flex items-center gap-1 text-xs text-zinc-500">
              <Icon name="history" class="size-3.5" />
              <select
                class="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                value={String(shown.v)}
                aria-label="版"
                onChange={(e) => setViewV(Number((e.target as HTMLSelectElement).value))}
              >
                {[...f.versions].reverse().map((v) => (
                  <option key={v.v} value={v.v}>
                    版 {v.v}
                    {v.v === latest.v ? '（最新）' : ''} · {new Date(v.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {BY[v.by] ?? v.by}
                    {v.note ? ` · ${v.note}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!editing && (
            <Button
              aria-label="編集"
              title="編集（保存すると新しい版になります）"
              onClick={() => {
                setDraft(shown.text);
                setEditing(true);
              }}
            >
              <Icon name="edit" />
            </Button>
          )}
          <Button
            aria-label="コピー"
            title="内容をコピー"
            onClick={() => void navigator.clipboard.writeText(shown.text).then(() => showToast('コピーしました'))}
          >
            <Icon name="copy" />
          </Button>
          <Button aria-label="ダウンロード" title="ダウンロード" onClick={() => downloadFile(f, shown)}>
            <Icon name="download" />
          </Button>
          <Button aria-label="印刷・PDF に保存" title="印刷・PDF に保存（印刷の画面で「PDF に保存」を選びます）" onClick={print}>
            <Icon name="printer" />
          </Button>
          <Button
            aria-label="会話で使う"
            title="入力欄に添付して、チャットに戻る"
            onClick={() => {
              void attachExisting(f.id);
              showChat();
            }}
          >
            <Icon name="paperclip" />
          </Button>
          {conv && (
            <Button aria-label="元の会話を開く" title={`元の会話「${conv.title}」を開く`} onClick={() => void openConversation(conv.id)}>
              <Icon name="chat" />
            </Button>
          )}
          <Button
            aria-label="削除"
            title="削除"
            class="hover:text-rose-600"
            onClick={async () => {
              if (await askConfirm({ title: 'ファイルを削除', message: `「${f.name}」を、すべての版も含めて削除します。元に戻せません。`, confirmLabel: '削除', danger: true })) await deleteFiles([f.id]);
            }}
          >
            <Icon name="trash" />
          </Button>
        </div>
      </header>
      {isOld && !editing && (
        <div class="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          版 {shown.v} を表示しています（最新は版 {latest.v}）。
          <Button
            variant="outline"
            class="py-1! text-xs"
            onClick={async () => {
              await restoreVersion(f.id, shown.v);
              setViewV(null);
              showToast(`版 ${shown.v} の内容を新しい版として保存しました`);
            }}
          >
            この版に戻す
          </Button>
          <Button class="text-xs" onClick={() => setViewV(null)}>
            最新を表示
          </Button>
        </div>
      )}
      {f.source && <p class="border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">{f.source}したテキストです。表や図の配置は崩れていることがあります。</p>}
      {editing ? (
        <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <textarea
            class="min-h-0 w-full flex-1 resize-none rounded-lg border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={draft}
            aria-label="ファイルの内容"
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          />
          <div class="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              disabled={draft === latest.text}
              onClick={async () => {
                await saveUserVersion(f.id, draft);
                setEditing(false);
                setViewV(null);
                showToast('新しい版として保存しました');
              }}
            >
              保存
            </Button>
          </div>
        </div>
      ) : (
        <div class="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div ref={body} class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <FileBody text={shown.text} ext={ext} />
          </div>
        </div>
      )}
    </main>
  );
}

function FileBody({ text, ext }: { text: string; ext: string }) {
  if (ext === 'md' || ext === 'markdown') return <Markdown text={text} />;
  if (ext === 'csv' || ext === 'tsv') {
    const { rows, truncated } = parseDelimited(text, ext === 'tsv' ? '\t' : ',');
    if (rows.length > 0 && rows.length <= 1000) {
      const [head, ...rest] = rows;
      return (
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i} class="border border-zinc-300 bg-zinc-50 px-2 py-1 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rest.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} class="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && <p class="mt-2 text-xs text-zinc-500">先頭 1,000 行だけを表示しています。全体はダウンロードして確認してください。</p>}
        </div>
      );
    }
  }
  return <pre class="font-mono text-sm break-words whitespace-pre-wrap">{text}</pre>;
}
