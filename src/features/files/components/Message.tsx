// Files inside the chat: the card under a file tool call, and the files attached to a user message
import { useEffect, useState } from 'preact/hooks';
import type { MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { Icon } from '../../../components/ui';
import { getFile, openFile } from '../state';
import { filesVersion } from '../../../state/stored';
import type { FileToolDetails } from '../tools';
import { formatChars } from './common';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** Whether a file is still in the Files tab (checked by id, again after any change; true until known) */
function useFileExists(id: string): boolean {
  const [exists, setExists] = useState(true);
  const v = filesVersion.value;
  useEffect(() => {
    let alive = true;
    void getFile(id).then((f) => alive && setExists(!!f), () => {});
    return () => {
      alive = false;
    };
  }, [id, v]);
  return exists;
}

export function FileToolDetail({ p }: { p: ToolPart }) {
  const d = p.uiDetails as FileToolDetails | undefined;
  const exists = useFileExists(d?.fileId ?? '');
  if (!d?.fileId || p.name === 'read_file') return null;
  if (!exists)
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
          <span class="block text-xs text-muted">
            {formatChars(d.chars)}
          </span>
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
  const exists = useFileExists(a.fileId);
  const title = a.text.length < a.totalChars ? t('msg.partial', { sent: formatNumber(a.text.length), total: formatNumber(a.totalChars) }) : t('msg.sent');
  const inner = (
    <>
      <Icon name="paperclip" class="size-3" />
      <span class="truncate">{a.name}</span>
      <span class="tabular-nums opacity-70">{exists ? formatChars(a.totalChars) : t('msg.fileDeleted')}</span>
    </>
  );
  if (!exists) return <span class="inline-flex max-w-full items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted" title={title}>{inner}</span>;
  return (
    <button
      type="button"
      class="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-glass px-2 py-0.5 text-xs text-ink hover:border-line-strong hover:bg-glass-strong"
      title={title}
      onClick={() => void openFile(a.fileId)}
    >
      {inner}
    </button>
  );
}
