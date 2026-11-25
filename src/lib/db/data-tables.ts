// Stored data beyond the core tables (images, files, ...). Each storage module registers how its table
// is backed up, restored, re-encrypted and cleaned up with a conversation, so the backup code, the
// passphrase switch and conversation deletion do not need to know every table.
import type { DataKey } from '../crypto/data';

export interface DataTable<Row = unknown> {
  /** Property name in backup files (kept stable: older backups use it too) */
  key: string;
  /** Rows for a backup; undefined leaves the property out (e.g. images unless the user asked for them) */
  exportRows(opts: { includeImages: boolean }): Promise<Row[] | undefined>;
  /** Keep only well-formed rows from a backup file */
  clean(raw: unknown, ctx: { conversationIds: Set<string> }): Row[];
  /** Add rows that do not exist yet; returns how many were added */
  importRows(rows: Row[]): Promise<number>;
  /** Encrypt (to: a key) or decrypt (to: null) every row; safe to re-run after an interruption */
  reseal?(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** A conversation was deleted (temporary: it only lived in memory) */
  onConversationDeleted?(conversationId: string, temporary: boolean): void | Promise<void>;
}

const tables: DataTable<any>[] = [];

export function registerDataTable<Row>(t: DataTable<Row>) {
  const i = tables.findIndex((x) => x.key === t.key);
  if (i >= 0) tables[i] = t;
  else tables.push(t);
}

export function dataTables(): readonly DataTable<any>[] {
  return tables;
}
