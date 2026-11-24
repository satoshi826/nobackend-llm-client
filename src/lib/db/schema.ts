import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ModelInfo, ProviderConfig } from '../providers/types';
import type { EncryptedBlob } from '../crypto/passphrase';

export const SCHEMA_VERSION = 1;

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
  /** 一時チャット。true の会話は DB に書かない（メモリのみ） */
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
  /** 圧縮ノード: coversUntilId までの会話を summary に置き換えて送る */
  compaction?: { summary: string; coversUntilId: string; count: number; model?: string; auto?: boolean };
}

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

export interface SecretRecord {
  id: string; // providerId
  /** 平文で保存する場合のみ */
  key?: string;
  /** パスフレーズで暗号化して保存する場合 */
  enc?: EncryptedBlob;
  hosts: string[];
  createdAt: number;
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
  providers!: Table<ProviderConfig, string>;
  models!: Table<ModelRecord, [string, string]>;
  secrets!: Table<SecretRecord, string>;
  settings!: Table<SettingRecord, string>;

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
  }
}

let _db: AppDB | null = null;
export function db(): AppDB {
  if (!_db) _db = new AppDB();
  return _db;
}

/** テスト用 */
export function setDB(d: AppDB) {
  _db = d;
}
