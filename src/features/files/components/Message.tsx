// Files inside the chat: the card under a file tool call, and the files attached to a user message
import { useEffect, useState } from 'preact/hooks';
import type { FileRecord, MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { Icon } from '../../../components/ui';
import { getFile, openFile } from '../state';
import { filesVersion } from '../../../state/stored';
import type { FileToolDetails } from '../tools';
import { formatBytes } from './common';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** A file as it is now in the Files tab (looked up again after any change): null once deleted, undefined until known */
function useFile(id: string): FileRecord | null | undefined {
  const [file, setFile] = useState<FileRecord | null | undefined>(undefined);
  const v = filesVersion.value;
  useEffect(() => {
    let alive = true;
    void getFile(id).then((f) => alive && setFile(f ?? null), () => {});
    return () => {
      alive = false;
    };
  }, [id, v]);
  return file;
}

export function FileToolDetail({ p }: { p: ToolPart }) {
  const d = p.uiDetails as FileToolDetails | undefined;
  const file = useFile(d?.fileId ?? '');
  if (!d?.fileId || p.name === 'read_file') return null;
  if (file === null)
    return (
      <div class="flex items-center gap-2 border-t border-line px-3 py-2 text-sm text-muted">
        <Icon name="file" class="size-5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{d.name}</span>
        <span class="shrink-0 text-xs">{t('msg.fileDeleted')}</span>
      </div>
    );
  return (
    <div class="border-t border-line px-3 py-2">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg border border-line bg-glass px-3 py-2 text-left hover:bg-glass-strong"
        onClick={() => void openFile(d.fileId)}
      >
        <Icon name="file" class="size-5 shrink-0 text-accent-text" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-ink-strong">{d.name}</span>
          {file && <span class="block text-xs text-muted">{formatBytes(file.bytes)}</span>}
        </span>
        <span class="shrink-0 text-xs text-accent-text">{t('open')}</span>
      </button>
    </div>
  );
}

export function UserAttachments({ m }: { m: MessageRecord }) {
  if (!m.attachments?.length) return null;
  return (
    <div class="mb-1 flex flex-wrap justify-end gap-1">
      {m.attachments.map((a) => (
        <AttachmentChip key={a.fileId} a={a} />
      ))}
    </div>
  );
}

/** A file sent with a message: opens it, or says it was deleted (what was sent stays in the message) */
function AttachmentChip({ a }: { a: NonNullable<MessageRecord['attachments']>[number] }) {
  const file = useFile(a.fileId);
  const exists = file !== null;
  const title = a.text.length < a.totalChars ? t('msg.partial', { sent: formatNumber(a.text.length), total: formatNumber(a.totalChars) }) : t('msg.sent');
  const inner = (
    <>
      <Icon name="paperclip" class="size-3" />
      <span class="truncate">{a.name}</span>
      <span class="tabular-nums opacity-70">{file ? formatBytes(file.bytes) : exists ? '' : t('msg.fileDeleted')}</span>
    </>
  );
  if (!exists) return <span class="inline-flex max-w-full items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted" data-tip={title}>{inner}</span>;
  return (
    <button
      type="button"
      class="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-glass px-2 py-0.5 text-xs text-ink hover:border-line-strong hover:bg-glass-strong"
      data-tip={title}
      onClick={() => void openFile(a.fileId)}
    >
      {inner}
    </button>
  );
}
