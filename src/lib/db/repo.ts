// リポジトリ層。一時チャット（temporary）の会話はメモリにだけ保持し、IndexedDB には書かない。
import { db, type Conversation, type MessageRecord, type SavedPrompt, type SecretRecord, type ModelRecord } from './schema';
import type { ProviderConfig } from '../providers/types';
import { decryptSecret, encryptSecret } from '../crypto/passphrase';

const memConversations = new Map<string, Conversation>();
const memMessages = new Map<string, MessageRecord>();
/** 「このセッションのみ」保存のキー（メモリのみ） */
const memSecrets = new Map<string, SecretRecord>();

export function newId(): string {
  return crypto.randomUUID();
}

// ---- conversations ----
export async function listConversations(): Promise<Conversation[]> {
  const stored = await db().conversations.orderBy('updatedAt').reverse().toArray();
  return [...memConversations.values(), ...stored].sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return memConversations.get(id) ?? (await db().conversations.get(id));
}

export async function putConversation(c: Conversation): Promise<void> {
  if (c.temporary) {
    memConversations.set(c.id, c);
    return;
  }
  await db().conversations.put(c);
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
}

// ---- messages ----
export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  if (memConversations.has(conversationId)) {
    return [...memMessages.values()].filter((m) => m.conversationId === conversationId);
  }
  return db().messages.where('conversationId').equals(conversationId).toArray();
}

export async function putMessage(m: MessageRecord, temporary: boolean): Promise<void> {
  if (temporary) {
    memMessages.set(m.id, structuredClone(m));
    return;
  }
  await db().messages.put(structuredClone(m));
}

// ---- 全文検索 ----
export interface SearchHit {
  conversationId: string;
  messageId: string;
  snippet: string;
}

/** 会話本文の全文検索（大文字小文字を区別しない部分一致）。会話ごとに最初の一致を返す。 */
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
        // Markdown の記号（表の罫線・見出し・強調など）は表示用に取り除く
        const raw = p.text.slice(start, i + q.length + 40).replace(/\|?-{3,}\|?|[|#*`>]+/g, ' ');
        const snippet = (start > 0 ? '…' : '') + raw.replace(/\s+/g, ' ').trim();
        hits.set(m.conversationId, { conversationId: m.conversationId, messageId: m.id, snippet });
        return;
      }
    }
  };
  for (const m of memMessages.values()) consider(m);
  await db()
    .messages.orderBy('createdAt')
    .reverse()
    .until(() => hits.size >= limit)
    .each(consider);
  return [...hits.values()];
}

// ---- prompts ----
export const listPrompts = () => db().prompts.orderBy('updatedAt').reverse().toArray();
export const putPrompt = (p: SavedPrompt) => db().prompts.put(p);
export const deletePrompt = (id: string) => db().prompts.delete(id);

// ---- providers ----
export const listProviders = () => db().providers.toArray();
export const putProvider = (p: ProviderConfig) => db().providers.put(p);

// ---- models cache ----
export async function replaceModels(providerId: string, models: Omit<ModelRecord, 'fetchedAt'>[]): Promise<void> {
  const now = Date.now();
  await db().transaction('rw', db().models, async () => {
    await db().models.where('providerId').equals(providerId).filter((m) => m.source === 'fetched').delete();
    await db().models.bulkPut(models.map((m) => ({ ...m, fetchedAt: now })));
  });
}
export const listModels = (providerId: string) => db().models.where('providerId').equals(providerId).toArray();

// ---- secrets ----
// 保存方法: plain（このブラウザに保存）/ encrypted（パスフレーズで暗号化して保存）/ session（保存しない）
export type SecretMode = 'plain' | 'encrypted' | 'session';

export interface SecretStatus {
  present: boolean;
  mode: SecretMode | null;
  locked: boolean;
  hosts: string[];
  last4: string;
}

/** 使える状態のキー（解錠済み・平文保存・セッション限定）を返す。ロック中なら undefined。 */
export async function getSecret(providerId: string): Promise<{ key: string; hosts: string[] } | undefined> {
  const m = memSecrets.get(providerId);
  if (m) return { key: m.key!, hosts: m.hosts };
  const r = await db().secrets.get(providerId);
  if (r?.key) return { key: r.key, hosts: r.hosts };
  return undefined;
}

export async function getSecretStatus(providerId: string): Promise<SecretStatus> {
  const m = memSecrets.get(providerId);
  const r = await db().secrets.get(providerId);
  if (r?.enc) return { present: true, mode: 'encrypted', locked: !m, hosts: r.hosts, last4: m?.key?.slice(-4) ?? '' };
  if (r?.key) return { present: true, mode: 'plain', locked: false, hosts: r.hosts, last4: r.key.slice(-4) };
  if (m) return { present: true, mode: 'session', locked: false, hosts: m.hosts, last4: m.key!.slice(-4) };
  return { present: false, mode: null, locked: false, hosts: [], last4: '' };
}

export async function setSecret(rec: { id: string; key: string; hosts: string[] }, mode: SecretMode, passphrase?: string): Promise<void> {
  const base = { id: rec.id, hosts: rec.hosts, createdAt: Date.now() };
  if (mode === 'session') {
    memSecrets.set(rec.id, { ...base, key: rec.key });
    await db().secrets.delete(rec.id);
  } else if (mode === 'encrypted') {
    const enc = await encryptSecret(rec.key, passphrase ?? '');
    await db().secrets.put({ ...base, enc });
    memSecrets.set(rec.id, { ...base, key: rec.key }); // 保存直後は解錠状態
  } else {
    memSecrets.delete(rec.id);
    await db().secrets.put({ ...base, key: rec.key });
  }
}

export async function unlockSecret(providerId: string, passphrase: string): Promise<void> {
  const r = await db().secrets.get(providerId);
  if (!r?.enc) return;
  const key = await decryptSecret(r.enc, passphrase);
  memSecrets.set(providerId, { id: providerId, key, hosts: r.hosts, createdAt: r.createdAt });
}

/** 暗号化キーをメモリから消して再びロックする */
export function lockSecret(providerId: string): void {
  memSecrets.delete(providerId);
}

export async function deleteSecret(providerId: string): Promise<void> {
  memSecrets.delete(providerId);
  await db().secrets.delete(providerId);
}

// ---- settings ----
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db().settings.get(key);
  return r ? (r.value as T) : fallback;
}
export const setSetting = (key: string, value: unknown) => db().settings.put({ key, value });

// ---- 全削除 ----
/** 本体オリジンに保存されているキーの件数（キー金庫モードでの残存チェック用） */
export async function countStoredSecrets(): Promise<number> {
  return db().secrets.count();
}

/** 本体オリジンに保存されているキーをすべて消す（会話・設定は消さない） */
export async function clearStoredSecrets(): Promise<void> {
  memSecrets.clear();
  await db().secrets.clear();
}

export async function wipeAll(): Promise<void> {
  memConversations.clear();
  memMessages.clear();
  memSecrets.clear();
  const d = db();
  d.close();
  await d.delete();
}
