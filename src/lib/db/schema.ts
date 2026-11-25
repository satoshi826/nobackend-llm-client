import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ModelInfo } from '../providers/types';
import type { UsageRecord } from '../usage';

export const SCHEMA_VERSION = 4;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  currentLeafId: string | null;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  webSearch: 'off' | 'auto' | 'on';
  pinned: 0 | 1;
  folderId?: string;
  tags: string[];
  /** Temporary chat. Conversations with true are never written to the DB (memory only) */
  temporary?: boolean;
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'aborted';

export interface MessageRecord extends ChatMessage {
  conversationId: string;
  parentId: string | null;
  groupId?: string;
  createdAt: number;
  status: MessageStatus;
  error?: { kind: string; message: string; hint?: string };
  /** Compaction node: the conversation up to coversUntilId is replaced by summary when sending */
  compaction?: { summary: string; coversUntilId: string; count: number; model?: string; auto?: boolean };
  /** Reply suggestions (made after an answer; encrypted along with the conversation) */
  suggestions?: string[];
  /** Skills the user picked in the input box (body saved as of sending, so regeneration sends the same content) */
  skills?: { name: string; body: string }[];
}

/** Skill (SKILL.md-compatible work instructions) */
export interface Skill {
  id: string;
  /** Lowercase letters, digits and hyphens. Unique */
  name: string;
  description: string;
  body: string;
  /** Whether the model may pick and load it from the list (if false, used only when the user picks it) */
  modelInvocable: boolean;
  createdAt: number;
  updatedAt: number;
  /** Skill created by the model via save_skill (omitted for user-created ones) */
  createdBy?: 'model';
  // Only built-in skills have the following (not stored)
  builtin?: boolean;
  /** Tools that become available only in conversations that loaded this skill */
  allowedTools?: string[];
}

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface BlobRecord {
  id: string;
  hash: string;
  blob: Blob;
}

export interface ModelRecord extends ModelInfo {
  fetchedAt: number;
}

export class AppDB extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<MessageRecord, string>;
  blobs!: Table<BlobRecord, string>;
  prompts!: Table<SavedPrompt, string>;
  models!: Table<ModelRecord, [string, string]>;
  settings!: Table<SettingRecord, string>;
  skills!: Table<Skill, string>;
  usage!: Table<UsageRecord, string>;

  constructor(name = 'nobackend-llm-client') {
    super(name);
    this.version(1).stores({
      conversations: 'id, updatedAt, folderId, pinned, *tags',
      messages: 'id, conversationId, parentId, groupId, createdAt',
      blobs: 'id, hash',
      prompts: 'id, name, updatedAt',
      providers: 'id',
      models: '[providerId+id], providerId, fetchedAt',
      secrets: 'id',
      settings: 'key'
    });
    // v2: secrets removed since keys are kept by the key vault (a separate page). providers removed too since connections come from presets
    this.version(2).stores({ secrets: null, providers: null });
    // v3: skills
    this.version(3).stores({ skills: 'id, name, updatedAt' });
    // v4: usage records (survive deleting conversations). Rebuilt from the usage of existing answers
    this.version(4)
      .stores({ usage: 'id, at, providerId' })
      .upgrade(async (tx) => {
        const rows: UsageRecord[] = [];
        await tx
          .table('messages')
          .filter((m: MessageRecord) => m.role === 'assistant' && !!(m.meta?.usage || m.meta?.costUsd !== undefined))
          .each((m: MessageRecord) => {
            const u = m.meta?.usage ?? {};
            rows.push({
              id: m.id,
              at: m.createdAt,
              providerId: m.meta?.providerId ?? '',
              model: m.meta?.model ?? '',
              kind: 'chat',
              inputTokens: u.inputTokens ?? 0,
              cachedInputTokens: u.cachedInputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              reasoningTokens: u.reasoningTokens ?? 0,
              ...(m.meta?.costUsd !== undefined ? { costUsd: m.meta.costUsd } : {})
            });
          });
        if (rows.length) await tx.table('usage').bulkPut(rows);
      });
  }
}

let _db: AppDB | null = null;
export function db(): AppDB {
  if (!_db) _db = new AppDB();
  return _db;
}

/** For tests */
export function setDB(d: AppDB) {
  _db = d;
}
