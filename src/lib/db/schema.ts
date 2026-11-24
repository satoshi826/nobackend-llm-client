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
  /** ユーザーが入力欄から指定したスキル（送信時点の本文を保存。再生成でも同じ内容を送る） */
  skills?: { name: string; body: string }[];
}

/** スキル（SKILL.md 互換の作業手順書） */
export interface Skill {
  id: string;
  /** 小文字・数字・ハイフン。一意 */
  name: string;
  description: string;
  body: string;
  /** モデルが一覧から選んで読み込めるか（false ならユーザーが指定したときだけ使う） */
  modelInvocable: boolean;
  createdAt: number;
  updatedAt: number;
  /** モデルが save_skill で作ったスキル（ユーザーが作ったものは省略） */
  createdBy?: 'model';
  // 以下は組み込みスキルだけが持つ（保存しない）
  builtin?: boolean;
  /** このスキルを読み込んだ会話でだけ使えるようになるツール */
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
    // v2: キーはキー金庫（別ページ）が保管するので secrets を廃止。接続先はプリセットから決まるので providers も廃止
    this.version(2).stores({ secrets: null, providers: null });
    // v3: スキル
    this.version(3).stores({ skills: 'id, name, updatedAt' });
    // v4: 使用量の記録（会話を消しても残る）。既存の回答の usage から作り直す
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

/** テスト用 */
export function setDB(d: AppDB) {
  _db = d;
}
