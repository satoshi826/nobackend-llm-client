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
  tags: string[];
  /**
   * The working folder ('todo-app/'): made with the conversation's first file. The model reads and writes only inside
   * it (lib/db/paths.ts); the files in it keep the conversation they were made in (FileRecord.conversationId)
   */
  workDir?: string;
  /** Temporary chat. Conversations with true are never written to the DB (memory only) */
  temporary?: boolean;
  /** Image mode: messages sent from the input box are image prompts */
  imageMode?: boolean;
  /** Image model chosen for this conversation in image mode ("provider|model"; none = the default) */
  imageModel?: string;
  /** Video mode: messages sent from the input box are video prompts (turning it on turns image mode off, and back) */
  videoMode?: boolean;
  /** Video model chosen for this conversation in video mode ("provider|model"; none = the default) */
  videoModel?: string;
}

/** What an image request asks for (saved on the user message so it can be regenerated) */
export interface ImageParams {
  op: 'generate' | 'upscale' | 'edit' | 'remove-bg';
  providerId: string;
  /** Image model (generate / edit) */
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** The model's size (ImageSize.id); requests saved before it have only the aspect ratio and resolution */
  size?: string;
  /** The size's aspect ratio and tier, kept with it for the providers that send them and for display */
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

/** What a video request asks for (saved on the user message so it can be made again) */
export interface VideoParams {
  providerId: string;
  model: string;
  prompt: string;
  /** Seconds */
  duration: number;
  resolution?: string;
  aspectRatio?: string;
  /** With sound (models that make it on request) */
  audio?: boolean;
  /** The first frame: a stored image */
  startBlobId?: string;
}

/** A video job at the provider, kept while it runs so waiting can go on after a reload */
export interface VideoJob {
  id: string;
  /** A one-time keyless download address some providers hand out when the job is queued (Venice) */
  downloadUrl?: string;
}

/** What came back for a video request (saved on the assistant message; the video itself is a file part) */
export interface VideoResult {
  params: VideoParams;
  job?: VideoJob;
  /** USD: as the provider reported it, else the estimate shown before sending */
  costUsd?: number;
  costEstimated?: boolean;
  /** A model the provider suggested after a content-policy rejection */
  suggestedModel?: string;
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
  /** Video request (user message) */
  videoRequest?: VideoParams;
  /** Video result (assistant message) */
  video?: VideoResult;
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
  text: string;
  /** Length of the whole file; larger than text.length when only the beginning is sent */
  totalChars: number;
}

/** Where a file or an image came from: made in a chat (by a model, or a page saving its data), the user's device, or the web */
export type Origin = { kind: 'made' } | { kind: 'upload' } | { kind: 'web'; url: string };

/** Who saved a file's text: a model, the user (editing, or a page of theirs saving its data), or an upload */
export type SavedBy = 'model' | 'user' | 'upload';

/** When and by whom a text was saved */
export interface TextStamp {
  at: number;
  by: SavedBy;
}

/**
 * A text file, without its text (lists never load texts): documents a model wrote, files the user brought in, data a
 * page saved. Its name is its path (lib/paths.ts). With a passphrase name, origin and preview are encrypted.
 */
export interface FileRecord {
  id: string;
  name: string;
  mime: string;
  origin: Origin;
  /** The text was extracted from a PDF (an upload or a fetch) */
  fromPdf?: boolean;
  /** Conversation it was made or attached in (the file outlives the conversation) */
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  /** The current text's size in UTF-8 bytes (what it takes on a disk; images count theirs the same way) */
  bytes: number;
  /** The current text's first characters, for cards and lists */
  preview: string;
  current: TextStamp;
  /** The text before the last change, kept for undo */
  previous?: TextStamp;
}

/** Characters of a file's text kept in its record, for cards and lists */
export const PREVIEW_CHARS = 300;

/** A text's size in UTF-8 bytes */
export const textBytes = (text: string): number => new TextEncoder().encode(text).length;

/** A file's text: its current one, and the one before its last change. Encrypted with a passphrase */
export interface FileText {
  /** `<fileId>:current` or `<fileId>:previous` */
  id: string;
  fileId: string;
  text: string;
}

/** A row of the table before fileTexts (read only while stored data is converted; goes before release) */
export interface FileVersionText {
  id: string;
  fileId: string;
  text: string;
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

/** An image's path (named by the time it was saved when it came with no name) and where it came from */
export interface ImageInfo {
  path: string;
  origin: Origin;
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
  fileTexts!: Table<FileText, string>;

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
    // v10: conversations lose the folderId index (a field never used; folders now hold files, see workDir)
    this.version(10).stores({ conversations: 'id, updatedAt, pinned, *tags' });
    // v11: file texts in their own table (a file record is what lists show); the kind index goes (origin replaced it).
    // Stored records are converted once after unlock (lib/db/convert.ts), as they are encrypted
    this.version(11).stores({ files: 'id, updatedAt, conversationId', fileTexts: 'id, fileId' });
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
let dbName = 'nobackend-llm-client';
export function db(): AppDB {
  if (!_db) _db = new AppDB(dbName);
  return _db;
}

/** Use another database (perf mode keeps its generated data apart from the real one); call before the first db() */
export function setDatabaseName(name: string) {
  if (_db) throw new Error('The database is already open');
  dbName = name;
}
