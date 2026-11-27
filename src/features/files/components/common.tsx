// Small shared pieces of the Files feature UI
import type { FileRecord } from '../../../lib/db/schema';
import { baseName, extOf, folderOf } from '../../../lib/paths';
import { formatDate as fmtDate, formatNumber, formatTime } from '../../../lib/i18n';
import { Icon } from '../../../components/ui';
import { t } from '../messages';

export function formatChars(n: number): string {
  return t('chars', { n: formatNumber(n, n < 10_000 ? undefined : { notation: 'compact', maximumFractionDigits: 1 }) });
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? formatTime(ts) : fmtDate(ts, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** Short type label from the file name */
export function typeLabel(f: Pick<FileRecord, 'name' | 'fromPdf'>): string {
  if (f.fromPdf) return 'PDF';
  return (extOf(f.name) || 'txt').toUpperCase();
}

/** A file's name with its folders dimmed (a name is a path: site/css/style.css); from: a folder shown, left out of the name */
export function PathName({ name, from }: { name: string; from?: string | null }) {
  if (from && name.toLowerCase().startsWith(from.toLowerCase())) name = name.slice(from.length);
  const folder = folderOf(name);
  return (
    <>
      {folder && <span class="text-muted">{folder}</span>}
      {baseName(name)}
    </>
  );
}

export function FileIcon({ f, class: cls = 'size-4' }: { f: Pick<FileRecord, 'origin'>; class?: string }) {
  return <Icon name={f.origin.kind === 'made' ? 'sparkle' : 'upload'} class={cls} />;
}
