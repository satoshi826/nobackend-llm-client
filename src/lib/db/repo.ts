// Repository layer. Temporary chat conversations are kept in memory only and never written to IndexedDB.
// With a passphrase, the content of conversations, messages, saved prompts and skills is stored encrypted (sealed.ts).
import { db, type Conversation, type MessageRecord, type SavedPrompt, type ModelRecord, type Skill } from './schema';
import type { UsageRecord } from '../usage';
import { currentDataKey, seal, unseal } from './sealed';
import type { DataKey } from '../crypto/data';

const memConversations = new Map<string, Conversation>();
const memMessages = new Map<string, MessageRecord>();

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
    memConversations.set(c.id, c);
    return;
  }
  await db().conversations.put(await seal('conversations', c));
}

export async function deleteConversation(id: string): Promise<void> {
  if (memConversations.delete(id)) {
    for (const [k, m] of memMessages) if (m.conversationId === id) memMessages.delete(k);
    return;
  }
  await db().transaction('rw', db().conversations, db().messages, async () => {
    await db().messages.where('conversationId').equals(id).delete();
    await db().conversations.delete(id);
  });
  for (const [k, m] of searchCache) if (m.conversationId === id) searchCache.delete(k);
}

// ---- messages ----
export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  if (memConversations.has(conversationId)) {
    return [...memMessages.values()].filter((m) => m.conversationId === conversationId);
  }
  return Promise.all((await db().messages.where('conversationId').equals(conversationId).toArray()).map((m) => unseal(m)));
}

export async function putMessage(m: MessageRecord, temporary: boolean): Promise<void> {
  if (temporary) {
    memMessages.set(m.id, structuredClone(m));
    return;
  }
  const copy = structuredClone(m);
  searchCache.set(copy.id, copy);
  await db().messages.put(await seal('messages', copy));
}

// ---- Full-text search ----
export interface SearchHit {
  conversationId: string;
  messageId: string;
  snippet: string;
}

/** Full-text search over conversation text (case-insensitive substring match). Returns the first match per conversation. */
export async function searchMessages(query: string, limit = 50): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = new Map<string, SearchHit>();
  const consider = (m: MessageRecord) => {
    if (hits.has(m.conversationId)) return;
    for (const p of m.parts) {
      if (p.type !== 'text') continue;
      const i = p.text.toLowerCase().indexOf(q);
      if (i >= 0) {
        const start = Math.max(0, i - 20);
        // Strip Markdown syntax (table rules, headings, emphasis, etc.) for display
        const raw = p.text.slice(start, i + q.length + 40).replace(/\|?-{3,}\|?|[|#*`>]+/g, ' ');
        const snippet = (start > 0 ? '…' : '') + raw.replace(/\s+/g, ' ').trim();
        hits.set(m.conversationId, { conversationId: m.conversationId, messageId: m.id, snippet });
        return;
      }
    }
  };
  for (const m of memMessages.values()) consider(m);
  if (!currentDataKey()) {
    await db()
      .messages.orderBy('createdAt')
      .reverse()
      .until(() => hits.size >= limit)
      .each(consider);
    return [...hits.values()];
  }
  // When encrypted, search decrypted text kept in memory (everything is decrypted only the first time)
  if (!searchCacheFull) {
    for (const raw of await db().messages.toArray()) if (!searchCache.has(raw.id)) searchCache.set(raw.id, await unseal(raw));
    searchCacheFull = true;
  }
  for (const m of [...searchCache.values()].sort((a, b) => b.createdAt - a.createdAt)) {
    consider(m);
    if (hits.size >= limit) break;
  }
  return [...hits.values()];
}

/** Decrypted text (for search while encrypted). Gone on lock, since the whole page is reloaded */
const searchCache = new Map<string, MessageRecord>();
let searchCacheFull = false;
export function clearSearchCache() {
  searchCache.clear();
  searchCacheFull = false;
}

// ---- usage ----
export const addUsage = (r: UsageRecord) => db().usage.put(r);
export const listUsage = (since: number | null) => (since === null ? db().usage.orderBy('at').toArray() : db().usage.where('at').aboveOrEqual(since).toArray());
export const clearUsage = () => db().usage.clear();

// ---- skills ----
export const listSkills = async () => Promise.all((await db().skills.orderBy('name').toArray()).map((s) => unseal(s)));
export const putSkill = async (s: Skill) => db().skills.put(await seal('skills', s));
export const deleteSkill = (id: string) => db().skills.delete(id);

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
export const listModels = (providerId: string) => db().models.where('providerId').equals(providerId).toArray();

// ---- settings ----
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db().settings.get(key);
  return r ? (r.value as T) : fallback;
}
export const setSetting = (key: string, value: unknown) => db().settings.put({ key, value });

// ---- Switching encryption on/off (setting / removing the passphrase) ----
const SEALED_TABLES = ['conversations', 'messages', 'prompts', 'skills'] as const;

/**
 * Encrypt (to: a data key) or decrypt (to: null) all stored data in bulk.
 * from is the current key (to open already-encrypted data). If interrupted, running it again processes only the rest.
 */
export async function resealAll(from: DataKey | null, to: DataKey | null, onProgress?: (done: number, total: number) => void): Promise<void> {
  const d = db();
  let total = 0;
  for (const t of SEALED_TABLES) total += await d.table(t).count();
  let done = 0;
  for (const t of SEALED_TABLES) {
    const rows = await d.table(t).toArray();
    for (let i = 0; i < rows.length; i += 200) {
      const out = [];
      for (const raw of rows.slice(i, i + 200)) out.push(await seal(t, await unseal(raw, from), to));
      await d.table(t).bulkPut(out);
      done += out.length;
      onProgress?.(done, total);
    }
  }
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
