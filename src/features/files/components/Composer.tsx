// Input box pieces: the attach button (device / saved files) and the list of attached files
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Conversation, FileRecord } from '../../../lib/db/schema';
import { Button, Icon, Modal, Spinner, cx } from '../../../components/ui';
import { ATTACH_INLINE_CHARS, attachExisting, detach, fileList, pendingAttachments, refreshFiles, uploadFiles } from '../state';
import { formatChars, formatDate, FileIcon, typeLabel } from './common';

const ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.html,.htm,.yaml,.yml,.toml,.log,.pdf,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.cs,.php,.rb,.sh,.sql,.css,.srt,.vtt,text/*,application/pdf,application/json';

export function AttachButton({ conv }: { conv: Conversation }) {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  const n = pendingAttachments.value.length;
  return (
    <div class="relative" ref={wrap}>
      <Button
        aria-haspopup="menu"
        aria-expanded={menu}
        title="ファイルを添付（テキスト・Markdown・CSV・JSON・コード・PDF）。入力欄へのドロップ・貼り付けでも添付できます"
        class={cx('text-xs', n > 0 && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300')}
        onClick={() => setMenu(!menu)}
      >
        <Icon name="paperclip" class="size-4" />
        添付{n ? `: ${n}` : ''}
      </Button>
      {menu && (
        <div role="menu" class="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onClick={() => {
              setMenu(false);
              input.current?.click();
            }}
          >
            <Icon name="upload" class="size-4" />
            この端末から選ぶ…
          </button>
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onClick={() => {
              setMenu(false);
              setPicker(true);
            }}
          >
            <Icon name="files" class="size-4" />
            保存済みのファイルから選ぶ…
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        class="hidden"
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          const files = [...(el.files ?? [])];
          el.value = '';
          if (files.length) void uploadFiles(files, conv);
        }}
      />
      {picker && <FilePicker onClose={() => setPicker(false)} />}
    </div>
  );
}

/** Choose files already in the Files tab */
function FilePicker({ onClose }: { onClose(): void }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    void refreshFiles();
  }, []);
  const list = fileList.value;
  const ql = q.trim().toLowerCase();
  const shown = (list ?? []).filter((f) => !ql || f.name.toLowerCase().includes(ql));
  const picked = new Set(pendingAttachments.value.map((a) => a.fileId));
  return (
    <Modal title="保存済みのファイルを添付" onClose={onClose}>
      <input
        class="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        placeholder="ファイル名で絞り込む"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        aria-label="ファイル名で絞り込む"
      />
      {!list ? (
        <p class="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner class="size-4" />
          読み込んでいます
        </p>
      ) : shown.length === 0 ? (
        <p class="text-sm text-zinc-500">{list.length ? '見つかりません' : 'まだファイルはありません。モデルに文書を作ってもらうか、この端末から添付すると、ここに並びます。'}</p>
      ) : (
        <ul class="space-y-1">
          {shown.map((f: FileRecord) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={picked.has(f.id)}
                class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
                onClick={() => {
                  void attachExisting(f.id);
                  onClose();
                }}
              >
                <FileIcon f={f} class="size-4 shrink-0 text-zinc-500" />
                <span class="min-w-0 flex-1 truncate">{f.name}</span>
                <span class="shrink-0 text-xs text-zinc-500 tabular-nums">
                  {typeLabel(f)} · {formatChars(f.size)} · {formatDate(f.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Attached files shown above the text area */
export function AttachmentChips() {
  const list = pendingAttachments.value;
  if (!list.length) return null;
  return (
    <div class="flex flex-wrap gap-1 px-3 pt-2.5">
      {list.map((a) => (
        <span
          key={a.fileId}
          class="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 py-0.5 pr-1 pl-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          title={a.chars && a.chars > ATTACH_INLINE_CHARS ? `長いファイルです。先頭 ${ATTACH_INLINE_CHARS.toLocaleString()} 文字を送り、続きはモデルが read_file で読みます（ツール対応モデルのみ）。` : undefined}
        >
          {a.reading ? <Spinner class="size-3" /> : <Icon name="paperclip" class="size-3" />}
          <span class="truncate">{a.name}</span>
          {a.chars !== undefined && <span class="text-emerald-600/80 tabular-nums dark:text-emerald-300/70">{formatChars(a.chars)}</span>}
          <button type="button" aria-label={`${a.name} を外す`} class="rounded-full p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900" onClick={() => detach(a.fileId)}>
            <Icon name="x" class="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
