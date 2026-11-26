import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ModelInfo } from '../providers/types';
import type { UsageRecord } from '../usage';
import type { Sealed } from '../crypto/data';

export const SCHEMA_VERSION = 6;

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
  /** Image mode: messages sent from the input box are image prompts */
  imageMode?: boolean;
  /** Image model chosen for this conversation in image mode ("provider|model"; none = the default) */
  imageModel?: string;
}

/** What an image request asks for (saved on the user message so it can be regenerated) */
export interface ImageParams {
  op: 'generate' | 'upscale' | 'edit' | 'remove-bg';
  providerId: string;
  /** Image model (generate / edit) */
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  variants: number;
  style?: string;
  /** Fixed seed; undefined means random */
  seed?: number;
  enhancePrompt?: boolean;
  safeMode: boolean;
  format: 'webp' | 'png' | 'jpeg';
  /** Source image (upscale / edit / remove-bg) */
  sourceBlobId?: string;
  scale?: 2 | 4;
}

/** What came back for an image request (saved on the assistant message) */
export interface ImageResult {
  params: ImageParams;
  /** Seed actually used (when the request fixed one) */
  seed?: number;
  blurred?: boolean;
  /** Variants dropped by the provider's content policy */
  violations?: number;
  enhancedPrompt?: string;
  /** Alternatives the provider suggested after a content-policy rejection */
  suggestion?: { prompt?: string; model?: string };
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
  /** Image request (user message) */
  imageRequest?: ImageParams;
  /** Image result (assistant message); the images themselves are file parts pointing at the blobs table */
  image?: ImageResult;
  /** Skills the user picked in the input box (body saved as of sending, so regeneration sends the same content) */
  skills?: { name: string; body: string }[];
  /** Files the user attached (text saved as of sending, so regeneration sends the same content) */
  attachments?: Attachment[];
}

/** A file attached to a user message. text is what is sent to the model (possibly only the beginning) */
export interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  version: number;
  text: string;
  /** Length of the whole file; larger than text.length when only the beginning is sent */
  totalChars: number;
}

/** One saved state of a file */
export interface FileVersion {
  v: number;
  at: number;
  text: string;
  /** Who made this version */
  by: 'model' | 'user' | 'upload';
  /** Short note, e.g. "appended" or the model's change summary */
  note?: string;
}

/** What is known about a version without its text */
export type FileVersionInfo = Omit<FileVersion, 'text'>;

/** The text of an earlier version of a file, kept apart so lists and edits never load or rewrite the history */
export interface FileVersionText {
  /** `${fileId}:${v}` */
  id: string;
  fileId: string;
  v: number;
  text: string;
}

/**
 * A text file: documents the model wrote (kind 'document') and files the user brought in (kind 'upload').
 * Images stay in the blobs table. name and versions are encrypted with a passphrase.
 */
export interface FileRecord {
  id: string;
  name: string;
  mime: string;
  kind: 'document' | 'upload';
  /** Conversation it was made or attached in (the file outlives the conversation) */
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  /** Characters in the latest version */
  size: number;
  /** For uploads: where the text came from (e.g. "PDF から抽出") */
  source?: string;
  /** The web address it was fetched from (on the user's request) */
  url?: string;
  /** The current version, with its text */
  current: FileVersion;
  /** Earlier versions without their text, oldest first (texts: FileVersionText). Beyond a limit the oldest are dropped */
  history: FileVersionInfo[];
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

/**
 * Encrypted bytes. The ciphertext is kept as a Blob, so reading a record does not load it: IndexedDB keeps a Blob
 * on disk until it is read
 */
export interface SealedBytes {
  iv: string;
  data: Blob;
}

/** Where an image came from when it was not made in a chat: the user's device, or a web address fetched on request */
export type ImageSource = { kind: 'upload' } | { kind: 'web'; url: string };

/** Name and origin of an image brought in by the user (images made in a chat have none) */
export interface ImageInfo {
  name: string;
  source: ImageSource;
}

/**
 * A stored image. With a passphrase the bytes are encrypted (enc) instead of kept as a Blob, and so is its
 * info (infoEnc). Images made in a chat belong to a conversation and message; brought-in images to none.
 */
export interface BlobRecord {
  id: string;
  conversationId?: string;
  messageId?: string;
  createdAt: number;
  mime: string;
  size: number;
  blob?: Blob;
  enc?: SealedBytes;
  /** A small copy for grids and previews (encrypted like the image); made when first needed for older images */
  thumb?: Blob | SealedBytes;
  info?: ImageInfo;
  infoEnc?: Sealed;
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
  files!: Table<FileRecord, string>;
  fileVersions!: Table<FileVersionText, string>;

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
    // v5: images (blobs) indexed by conversation and time; the old hash index was never used
    this.version(5).stores({ blobs: 'id, conversationId, createdAt' });
    // v3: skills
    this.version(3).stores({ skills: 'id, name, updatedAt' });
    // v6: files (documents written by the model, files the user uploaded)
    this.version(6).stores({ files: 'id, updatedAt, conversationId, kind' });
    // v7: usage records indexed by conversation (the header shows each conversation's cost)
    this.version(7).stores({ usage: 'id, at, providerId, conversationId' });
    // v8: encrypted image bytes kept as Blobs (were ArrayBuffers, which every read of a record loaded into memory)
    // v9: earlier versions of a file in their own table (the file record keeps the current one). Records in the
    // old shape (all versions inside, possibly encrypted) are converted when first read: lib/db/files.ts
    this.version(9).stores({ fileVersions: 'id, fileId' });
    this.version(8)
      .stores({ blobs: 'id, conversationId, createdAt' })
      .upgrade((tx) =>
        tx
          .table('blobs')
          .toCollection()
          .modify((r: { enc?: { iv: string; data: Blob | ArrayBuffer } }) => {
            if (r.enc && !(r.enc.data instanceof Blob)) r.enc = { iv: r.enc.iv, data: new Blob([r.enc.data]) };
          })
      );
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
