// Files inside the chat: the card under a file tool call, and the files attached to a user message
import type { MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { Icon } from '../../../components/ui';
import { openFile } from '../state';
import type { FileToolDetails } from '../tools';
import { formatChars } from './common';

type ToolPart = Extract<Part, { type: 'tool' }>;

export function FileToolDetail({ p }: { p: ToolPart }) {
  const d = p.uiDetails as FileToolDetails | undefined;
  if (!d?.fileId || p.name === 'read_file') return null;
  return (
    <div class="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        onClick={() => void openFile(d.fileId)}
      >
        <Icon name="file" class="size-5 shrink-0 text-sky-600" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{d.name}</span>
          <span class="block text-xs text-zinc-500">
            版 {d.version} · {formatChars(d.chars)}
          </span>
        </span>
        <span class="shrink-0 text-xs text-sky-700 dark:text-sky-400">開く</span>
      </button>
    </div>
  );
}

export function UserAttachments({ m }: { m: MessageRecord }) {
  if (!m.attachments?.length) return null;
  return (
    <div class="mb-1 flex flex-wrap justify-end gap-1">
      {m.attachments.map((a) => (
        <button
          key={a.fileId}
          type="button"
          class="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
          title={a.text.length < a.totalChars ? `先頭 ${a.text.length.toLocaleString()} 文字を送信（全体 ${a.totalChars.toLocaleString()} 文字）` : '送信した内容'}
          onClick={() => void openFile(a.fileId)}
        >
          <Icon name="paperclip" class="size-3" />
          <span class="truncate">{a.name}</span>
          <span class="tabular-nums opacity-70">{formatChars(a.totalChars)}</span>
        </button>
      ))}
    </div>
  );
}
