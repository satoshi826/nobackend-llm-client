// Repository layer. Temporary chat conversations are kept in memory only and never written to IndexedDB.
// With a passphrase, the content of conversations, messages, saved prompts and skills is stored encrypted (sealed.ts).
import { db, type Conversation, type MessageRecord, type SavedPrompt, type ModelRecord, type SettingRecord } from './schema';
import type { UsageRecord } from '../usage';
import { currentDataKey, openValue, seal, sealValue, unseal, type SealedTable } from './sealed';
import type { Sealed } from '../crypto/data';
import type { DataKey } from '../crypto/data';
import { DATA_TABLES } from './data-tables';
import { renameFields } from './convert';

const memConversations = new Map<string, Conversation>();
const memMessages = new Map<string, MessageRecord>();
/**
 * Every temporary conversation of this session, also after it is deleted: what is saved for it stays in memory, so
 * a message saved after its conversation went (a run ending late) never reaches the database
 */
const temporaryIds = new Set<string>();

export function newId(): string {
  return crypto.randomUUID();
}

// ---- conversations ----
export async function listConversations(): Promise<Conversation[]> {
  const stored = await Promise.all((await db().conversations.orderBy('updatedAt').reverse().toArray()).map((c) => unseal(c)));
  return [...memConversations.values(), ...stored].sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const mem = memConversations.get(id);
  if (mem) return mem;
  const c = await db().conversations.get(id);
  return c ? unseal(c) : undefined;
}

export async function putConversation(c: Conversation): Promise<void> {
  if (c.temporary) {
    temporaryIds.add(c.id);
    memConversations.set(c.id, c);
    return;
  }
  await db().conversations.put(await seal('conversations', c));
}

/** Delete a conversation and its messages; withItems: also the images and files made in it (see countMadeIn) */
export async function deleteConversation(id: string, withItems = false): Promise<void> {
  if (memConversations.delete(id)) {
    for (const [k, m] of memMessages) if (m.conversationId === id) memMessages.delete(k);
    for (const t of DATA_TABLES) await t.onConversationDeleted?.(id, { temporary: true, withItems });
    return;
  }
  await db().transaction('rw', db().conversations, db().messages, async () => {
    await db().messages.where('conversationId').equals(id).delete();
    await db().conversations.delete(id);
  });
  for (const t of DATA_TABLES) await t.onConversationDeleted?.(id, { temporary: false, withItems });
  for (const [k, m] of searchIndex) if (m.conversationId === id) searchIndex.delete(k);
  searchOrder = null;
}

/** Images and files made in or brought into a stored conversation, which deleting it can take along */
export async function countMadeIn(id: string): Promise<number> {
  if (memConversations.has(id)) return 0;
  let n = 0;
  for (const t of DATA_TABLES) n += (await t.countMadeIn?.(id)) ?? 0;
  return n;
}

// ---- messages ----
export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  if (memConversations.has(conversationId)) {
    return [...memMessages.values()].filter((m) => m.conversationId === conversationId);
  }
  return Promise.all((await db().messages.where('conversationId').equals(conversationId).toArray()).map(async (m) => renameFields(await unseal(m))));
}

/** Save a message; a temporary conversation's (its conversation saved before it) stays in memory */
export async function putMessage(m: MessageRecord): Promise<void> {
  if (temporaryIds.has(m.conversationId)) {
    memMessages.set(m.id, structuredClone(m));
    return;
  }
  const copy = structuredClone(m);
  // Decrypted text for search is kept only when stored text is encrypted (else search reads the database)
  if (currentDataKey()) {
    searchIndex.set(copy.id, searchableOf(copy));
    searchOrder = null;
  }
  await db().messages.put(await seal('messages', copy));
}

// ---- Full-text search ----
export interface SearchHit {
  conversationId: string;
  messageId: string;
  snippet: string;
}

/** A message as search reads it: only its text parts */
interface Searchable {
  id: string;
  conversationId: string;
  createdAt: number;
  texts: string[];
}

function searchableOf(m: MessageRecord): Searchable {
  return { id: m.id, conversationId: m.conversationId, createdAt: m.createdAt, texts: m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])) };
}

/** Where `q` (lowercased) first shows in a message, with a little text around it */
function hitIn(m: Searchable, q: string): SearchHit | undefined {
  for (const text of m.texts) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const start = Math.max(0, i - 20);
    // Strip Markdown syntax (table rules, headings, emphasis, etc.) for display
    const raw = text.slice(start, i + q.length + 40).replace(/\|?-{3,}\|?|[|#*`>]+/g, ' ');
    return { conversationId: m.conversationId, messageId: m.id, snippet: (start > 0 ? '…' : '') + raw.replace(/\s+/g, ' ').trim() };
  }
}

/**
 * Full-text search over conversation text (case-insensitive substring match). Returns the first match per conversation,
 * newest first. signal: stops the scan once a newer search has started
 */
export async function searchMessages(query: string, signal?: AbortSignal, limit = 50): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = new Map<string, SearchHit>();
  const consider = (m: Searchable) => {
    if (hits.has(m.conversationId)) return;
    const hit = hitIn(m, q);
    if (hit) hits.set(m.conversationId, hit);
  };
  for (const m of memMessages.values()) consider(searchableOf(m));
  if (!currentDataKey()) {
    await db()
      .messages.orderBy('createdAt')
      .reverse()
      .until(() => hits.size >= limit || !!signal?.aborted)
      .each((m) => consider(searchableOf(m)));
    return [...hits.values()];
  }
  // When encrypted, search the decrypted text kept in memory (decrypted once, the first time)
  searchLoad ??= loadSearchIndex().catch((e) => {
    searchLoad = null;
    throw e;
  });
  await searchLoad;
  searchOrder ??= [...searchIndex.values()].sort((a, b) => b.createdAt - a.createdAt);
  for (const m of searchOrder) {
    if (signal?.aborted || hits.size >= limit) break;
    consider(m);
  }
  return [...hits.values()];
}

/** Decrypted text for search while encrypted (searchable form only). Gone on lock, since the whole page is reloaded */
const searchIndex = new Map<string, Searchable>();
/** searchIndex newest first; null after a change, sorted again by the next search */
let searchOrder: Searchable[] | null = null;
/** The first decryption of every message, shared by the searches started while it runs */
let searchLoad: Promise<void> | null = null;

/** Decrypt every stored message for search, a batch at a time, letting the page draw and take input every 30 ms */
async function loadSearchIndex() {
  const rows = await db().messages.toArray();
  let since = performance.now();
  for (let i = 0; i < rows.length; i += 200) {
    const opened = await Promise.all(rows.slice(i, i + 200).map((r) => unseal<MessageRecord>(r)));
    // A message saved meanwhile is already there, newer
    for (const m of opened) if (!searchIndex.has(m.id)) searchIndex.set(m.id, searchableOf(m));
    if (performance.now() - since > 30) {
      await new Promise((r) => setTimeout(r, 0));
      since = performance.now();
    }
  }
  searchOrder = null;
}

export function clearSearchCache() {
  searchIndex.clear();
  searchOrder = null;
  searchLoad = null;
}

// ---- usage ----
export const addUsage = (r: UsageRecord) => db().usage.put(r);
export const listUsage = (since: number | null) => (since === null ? db().usage.orderBy('at').toArray() : db().usage.where('at').aboveOrEqual(since).toArray());
export const clearUsage = () => db().usage.clear();
/** Usage of one conversation */
export const usageForConversation = (conversationId: string) => db().usage.where('conversationId').equals(conversationId).toArray();

// ---- prompts ----
export const listPrompts = async () => Promise.all((await db().prompts.orderBy('updatedAt').reverse().toArray()).map((p) => unseal(p)));
export const putPrompt = async (p: SavedPrompt) => db().prompts.put(await seal('prompts', p));
export const deletePrompt = (id: string) => db().prompts.delete(id);

// ---- models cache ----
export async function replaceModels(providerId: string, models: Omit<ModelRecord, 'fetchedAt'>[]): Promise<void> {
  const now = Date.now();
  await db().transaction('rw', db().models, async () => {
    await db().models.where('providerId').equals(providerId).filter((m) => m.source === 'fetched').delete();
    await db().models.bulkPut(models.map((m) => ({ ...m, fetchedAt: now })));
  });
}
export const listAllModels = () => db().models.toArray();

// ---- settings ----
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db().settings.get(key);
  return r ? (r.value as T) : fallback;
}
export const setSetting = (key: string, value: unknown) => db().settings.put({ key, value });

/**
 * Settings that hold the user's own text (the default instructions, image prompts) are stored encrypted with a
 * passphrase, like conversations, and so can be read only once unlocked; the rest stay readable before (language,
 * theme, the lock itself). These keys are resealed with the rest of the data
 */
const sealedSettingKeys = new Set<string>();
export function sealSettingKey(key: string) {
  sealedSettingKeys.add(key);
}
export async function getSealedSetting<T>(key: string, fallback: T): Promise<T> {
  const r = (await db().settings.get(key)) as { value?: unknown; enc?: Sealed } | undefined;
  return r ? openValue<T>(r) : fallback;
}
export async function setSealedSetting(key: string, value: unknown) {
  await db().settings.put({ key, ...(await sealValue(value)) } as SettingRecord);
}
async function resealSettings(from: DataKey | null, to: DataKey | null) {
  for (const key of sealedSettingKeys) {
    const r = (await db().settings.get(key)) as { value?: unknown; enc?: Sealed } | undefined;
    if (r) await db().settings.put({ key, ...(await sealValue(await openValue(r, from), to)) } as SettingRecord);
  }
}

// ---- Switching encryption on/off (setting / removing the passphrase) ----
const CORE_SEALED_TABLES = ['conversations', 'messages', 'prompts', 'skills'] as const;

/** Encrypt / decrypt every row of one sealed table (also used by data tables that store sealed rows) */
export async function resealTable(t: SealedTable, from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  const d = db();
  const rows = await d.table(t).toArray();
  let done = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const out = [];
    for (const raw of rows.slice(i, i + 200)) out.push(await seal(t, await unseal(raw, from), to));
    await d.table(t).bulkPut(out);
    done += out.length;
    onProgress?.(done, rows.length);
  }
}

/**
 * Encrypt (to: a data key) or decrypt (to: null) all stored data in bulk.
 * from is the current key (to open already-encrypted data). If interrupted, running it again processes only the rest.
 */
export async function resealAll(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  for (const t of CORE_SEALED_TABLES) await resealTable(t, from, to, onProgress);
  for (const t of DATA_TABLES) await t.reseal?.(from, to, onProgress);
  await resealSettings(from, to);
  clearSearchCache();
}

// ---- Delete everything ----
export async function wipeAll(): Promise<void> {
  memConversations.clear();
  memMessages.clear();
  const d = db();
  d.close();
  await d.delete();
}

/** Row counts per table (diagnostics; reads no content) */
export async function tableCounts(): Promise<Record<string, number>> {
  const d = db();
  const names = ['conversations', 'messages', 'files', 'fileData', 'blobs', 'skills', 'skillFiles', 'prompts', 'usage', 'models'] as const;
  const out: Record<string, number> = {};
  for (const n of names) out[n] = await d.table(n).count();
  return out;
}
