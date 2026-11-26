// Encryption layer for stored data. Active only when there is a passphrase (i.e. a data key is set).
// Fields used for sorting and search indexes (IDs, timestamps, conversation IDs, etc.) stay in plaintext;
// the content (text, titles, instructions, etc.) is bundled into enc and encrypted.
// Crypto cannot be awaited inside an IndexedDB transaction, so conversion happens before writes and after reads.
import { openJSON, sealJSON, type DataKey, type Sealed } from '../crypto/data';
import type { Conversation, FileRecord, FileVersionText, MessageRecord, SavedPrompt, Skill } from './schema';
import { t } from './messages';

let dataKey: DataKey | null = null;

export function setDataKey(k: DataKey | null) {
  dataKey = k;
}

export function currentDataKey(): DataKey | null {
  return dataKey;
}

export class DataLockedError extends Error {
  constructor() {
    super(t('sealed.locked'));
  }
}

/** Fields to encrypt (per table) */
export const SECRET_FIELDS = {
  conversations: ['title', 'systemPrompt', 'tags'],
  messages: ['parts', 'vendorState', 'skills', 'compaction', 'error', 'suggestions', 'imageRequest', 'image', 'attachments'],
  prompts: ['name', 'content'],
  skills: ['description', 'body'],
  files: ['name', 'current', 'history', 'source', 'url'],
  fileVersions: ['text']
} as const;

export type SealedTable = keyof typeof SECRET_FIELDS;
type WithEnc<T> = T & { enc?: Sealed };

/** Convert to the encrypted storage form (unchanged if there is no data key) */
export async function seal<T extends object>(table: SealedTable, rec: T, key: DataKey | null = dataKey): Promise<WithEnc<T>> {
  if (!key) return rec;
  const plain: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
  const secret: Record<string, unknown> = {};
  for (const f of SECRET_FIELDS[table]) {
    if (f in plain) {
      secret[f] = plain[f];
      delete plain[f];
    }
  }
  delete plain.enc;
  return { ...(plain as T), enc: await sealJSON(key, secret) };
}

/** Restore from the stored form (unchanged if not encrypted) */
export async function unseal<T extends object>(rec: WithEnc<T>, key: DataKey | null = dataKey): Promise<T> {
  if (!rec?.enc) return rec;
  if (!key) throw new DataLockedError();
  const { enc, ...rest } = rec;
  const secret = await openJSON<Record<string, unknown>>(key, enc);
  return { ...(rest as unknown as T), ...secret };
}

export const isSealed = (rec: unknown): boolean => !!(rec as { enc?: unknown })?.enc;

// Type check (table-to-type mapping)
export type SealedTypes = { conversations: Conversation; messages: MessageRecord; prompts: SavedPrompt; skills: Skill; files: FileRecord; fileVersions: FileVersionText };
