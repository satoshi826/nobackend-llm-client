// Files inside the chat: the card under a file tool call, and the files attached to a user message
import type { MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { Icon } from '../../../components/ui';
import { openFile } from '../state';
import type { FileToolDetails } from '../tools';
import { formatChars } from './common';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

type ToolPart = Extract<Part, { type: 'tool' }>;

export function FileToolDetail({ p }: { p: ToolPart }) {
  const d = p.uiDetails as FileToolDetails | undefined;
  if (!d?.fileId || p.name === 'read_file') return null;
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
            {t('version', { v: d.version })} · {formatChars(d.chars)}
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
        <button
          key={a.fileId}
          type="button"
          class="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-glass px-2 py-0.5 text-xs text-ink hover:border-line-strong hover:bg-glass-strong"
          title={a.text.length < a.totalChars ? t('msg.partial', { sent: formatNumber(a.text.length), total: formatNumber(a.totalChars) }) : t('msg.sent')}
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
