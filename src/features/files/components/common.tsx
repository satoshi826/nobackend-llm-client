// Small shared pieces of the Files feature UI
import type { FileRecord } from '../../../lib/db/schema';
import { extOf } from '../../../lib/db/files';
import { Icon } from '../../../components/ui';

export function formatChars(n: number): string {
  if (n < 1000) return `${n} 文字`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k 文字`;
  return `${Math.round(n / 1000)}k 文字`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

/** Short type label from the file name */
export function typeLabel(f: Pick<FileRecord, 'name' | 'source'>): string {
  if (f.source?.startsWith('PDF')) return 'PDF';
  return (extOf(f.name) || 'txt').toUpperCase();
}

export function FileIcon({ f, class: cls = 'size-4' }: { f: Pick<FileRecord, 'kind'>; class?: string }) {
  return <Icon name={f.kind === 'upload' ? 'paperclip' : 'file'} class={cls} />;
}
