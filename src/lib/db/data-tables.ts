// Stored data beyond the core tables (files, images). Each storage module says how its table is backed up,
// restored, re-encrypted and cleaned up with a conversation; the backup code, the passphrase switch and conversation
// deletion go through this list.
import type { DataKey } from '../crypto/data';
import { filesTable } from './files';
import { imagesTable } from './images';

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
  /** How many rows were made in (or brought into) a conversation: the delete confirmation offers to delete them too */
  countMadeIn?(conversationId: string): Promise<number>;
  /**
   * A conversation was deleted. temporary: it only lived in memory (its rows go with it); withItems: the user chose
   * to delete what was made in it too
   */
  onConversationDeleted?(conversationId: string, o: { temporary: boolean; withItems: boolean }): void | Promise<void>;
}

/** In backup order */
export const DATA_TABLES: readonly DataTable<any>[] = [filesTable, imagesTable];
