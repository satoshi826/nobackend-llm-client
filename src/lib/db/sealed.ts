// Encryption layer for stored data. Active only when there is a passphrase (i.e. a data key is set).
// Only the fields ordering, indexes and joins need (IDs, timestamps, conversation IDs) stay in plain text
// (PLAIN_FIELDS); everything else is bundled into enc and encrypted.
// Crypto cannot be awaited inside an IndexedDB transaction, so conversion happens before writes and after reads.
import { openJSON, sealJSON, type DataKey, type Sealed } from '../crypto/data';
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

/**
 * Fields left in plain text (per table): only what ordering, indexes and joins need. Everything else is encrypted,
 * so a field added later is encrypted without anyone having to list it
 */
export const PLAIN_FIELDS = {
  conversations: ['id', 'createdAt', 'updatedAt', 'pinned'],
  messages: ['id', 'conversationId', 'parentId', 'createdAt'],
  prompts: ['id', 'createdAt', 'updatedAt'],
  // The name stays plain: skills are listed by it and kept unique through its index
  skills: ['id', 'name', 'createdAt', 'updatedAt'],
  files: ['id', 'conversationId', 'createdAt', 'updatedAt'],
  fileTexts: ['id', 'fileId'],
  fileVersions: ['id', 'fileId']
} as const;

export type SealedTable = keyof typeof PLAIN_FIELDS;
type WithEnc<T> = T & { enc?: Sealed };

/** Convert to the encrypted storage form (unchanged if there is no data key) */
export async function seal<T extends object>(table: SealedTable, rec: T, key: DataKey | null = dataKey): Promise<WithEnc<T>> {
  if (!key) return rec;
  const keep = new Set<string>(PLAIN_FIELDS[table]);
  const plain: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [f, v] of Object.entries(rec as Record<string, unknown>)) {
    if (f === 'enc') continue;
    if (keep.has(f)) plain[f] = v;
    else secret[f] = v;
  }
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
