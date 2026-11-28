// Backups: export and import. A backup is one JSON document, or, when it holds bytes (images, videos, skills' files), a
// zip of that document (backup.json) and those bytes, each an entry of its own. Neither side builds the whole file as one
// string: the JSON is written a row at a time into a Blob, and bytes stay Blobs throughout.
// API keys are never included.
import { db, type Conversation, type ImageParams, type MessageRecord, type SavedPrompt, type Skill, type VideoParams } from './schema';
import { FRONTMATTER_MAX, validateSkill } from '../skills/skill';
import { openValue, seal, unseal } from './sealed';
import { DATA_TABLES } from './data-tables';
import type { Attachment } from './schema';
import type { Part } from '../providers/types';
import { t } from './messages';
import { cleanFolderName, extOfMime } from '../paths';
import { isZip, unzip, zip, ZipError, type ZipEntry } from '../zip';

const openAll = <T extends object>(rows: T[]) => Promise.all(rows.map((r) => unseal(r)));

export const EXPORT_FORMAT = 'nobackend-llm-client/export';
/**
 * The backup format's version. Raise it when what a backup holds changes, and add a backup of the new version to
 * backups/ (backups.test.ts): every version the app has written stays readable
 */
export const EXPORT_VERSION = 8;
/** The JSON document's name in a zip backup */
export const BACKUP_ENTRY = 'backup.json';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  conversations: Conversation[];
  messages: MessageRecord[];
  prompts: SavedPrompt[];
  /** Since v3 */
  skills?: Skill[];
  /** Rows of registered data tables, by table key (e.g. images, files) */
  [table: string]: unknown;
  settings: { key: string; value: unknown }[];
}

/** Text gathered into a Blob a part at a time (the browser may keep a large Blob out of memory; a string it cannot) */
class TextBlob {
  private parts: Blob[] = [];
  private pending: string[] = [];
  private chars = 0;
  write(s: string) {
    this.pending.push(s);
    this.chars += s.length;
    if (this.chars >= 1 << 22) this.flush();
  }
  private flush() {
    this.parts.push(new Blob(this.pending));
    this.pending = [];
    this.chars = 0;
  }
  blob(type: string): Blob {
    this.flush();
    return new Blob(this.parts, { type });
  }
}

/** A backup file of everything in this browser: JSON (application/json), or a zip (application/zip) when it holds bytes */
export async function exportBackup(includeImages = false): Promise<Blob> {
  const d = db();
  const media: ZipEntry[] = [];
  // A Blob in a row (an image's or a skill file's bytes) becomes an entry of the zip, named in the row
  const replacer = (_key: string, v: unknown) => {
    if (!(v instanceof Blob)) return v;
    const file = `media/${media.length + 1}.${/^(image|video)\//.test(v.type) ? extOfMime(v.type) : 'bin'}`;
    media.push({ name: file, data: v });
    return { file };
  };
  const json = new TextBlob();
  json.write(`{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())}`);
  const list = (key: string, rows: unknown[]) => {
    json.write(`,${JSON.stringify(key)}:[`);
    rows.forEach((r, i) => json.write((i ? ',' : '') + JSON.stringify(r, replacer)));
    json.write(']');
  };
  // Data stored encrypted is decrypted here; the caller may encrypt the whole file with a backup password (state/data.ts)
  list('conversations', await openAll(await d.conversations.toArray()));
  list('messages', await openAll(await d.messages.toArray()));
  list('prompts', await openAll(await d.prompts.toArray()));
  list('skills', await openAll(await d.skills.toArray()));
  for (const table of DATA_TABLES) {
    const rows = await table.exportRows({ includeImages });
    if (rows) list(table.key, rows);
  }
  // Connection settings and keys are excluded (avoids attacks that swap baseUrl via import); encrypted ones opened
  list('settings', await Promise.all((await d.settings.toArray()).filter((s) => !String(s.key).startsWith('secret')).map(async (s) => ({ key: s.key, value: s.enc ? await openValue(s) : s.value }))));
  json.write('}');
  const doc = json.blob('application/json');
  return media.length ? zip([{ name: BACKUP_ENTRY, data: doc }, ...media]) : doc;
}

/** Read a backup file (JSON or zip), validate it, and merge it in (see importAll) */
export async function importBackup(file: Blob): Promise<ImportResult> {
  let files = new Map<string, Blob>();
  let doc: Blob | undefined = file;
  if (await isZip(file)) {
    try {
      files = await unzip(file);
    } catch (e) {
      throw e instanceof ZipError ? new Error(t('export.badFormat')) : e;
    }
    doc = files.get(BACKUP_ENTRY);
    if (!doc) throw new Error(t('export.notBackup'));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await doc.text());
  } catch (e) {
    throw e instanceof SyntaxError ? new Error(t('export.notBackup')) : e;
  }
  return importAll(raw, files);
}

export interface ImportResult {
  conversations: number;
  messages: number;
  prompts: number;
  skills: number;
  skipped: number;
  /** Rows added per data table (e.g. { images: 3, files: 1 }) */
  tables: Record<string, number>;
}

/** Validate the format, then merge (existing IDs are not overwritten, i.e. skipped). files: the zip's entries by name */
export async function importAll(raw: unknown, files: ReadonlyMap<string, Blob> = new Map()): Promise<ImportResult> {
  const f = validate(raw, files);
  const d = db();
  const res: ImportResult = { conversations: 0, messages: 0, prompts: 0, skills: 0, skipped: 0, tables: {} };
  // Encrypt up front, outside the transaction (awaiting inside would close the transaction)
  const conversations = await Promise.all(f.conversations.map((c) => seal('conversations', { ...c, temporary: undefined })));
  const messages = await Promise.all(f.messages.map((m) => seal('messages', m)));
  const prompts = await Promise.all(f.prompts.map((p) => seal('prompts', p)));
  const skills = await Promise.all((f.skills ?? []).map((s) => seal('skills', s)));
  await d.transaction('rw', [d.conversations, d.messages, d.prompts, d.skills], async () => {
    for (const c of conversations) {
      if (await d.conversations.get(c.id)) {
        res.skipped++;
        continue;
      }
      await d.conversations.put(c);
      res.conversations++;
    }
    for (const m of messages) {
      if (await d.messages.get(m.id)) {
        res.skipped++;
        continue;
      }
      await d.messages.put(m);
      res.messages++;
    }
    for (const p of prompts) {
      if (await d.prompts.get(p.id)) {
        res.skipped++;
        continue;
      }
      await d.prompts.put(p);
      res.prompts++;
    }
    // Skill names are unique. If one with the same ID or name exists, keep the local one
    for (const s of skills) {
      if ((await d.skills.get(s.id)) || (await d.skills.where('name').equals(s.name).count())) {
        res.skipped++;
        continue;
      }
      await d.skills.put(s);
      res.skills++;
    }
  });
  for (const t of DATA_TABLES) {
    const rows = f[t.key] as unknown[] | undefined;
    if (rows?.length) res.tables[t.key] = await t.importRows(rows);
  }
  return res;
}

/** Keep only well-formed image request fields */
function cleanImageParams(x: any): ImageParams | undefined {
  if (!x || typeof x !== 'object' || !['generate', 'upscale', 'edit', 'remove-bg'].includes(x.op) || !isStr(x.providerId)) return undefined;
  return {
    op: x.op,
    providerId: x.providerId,
    model: str(x.model) ?? '',
    prompt: str(x.prompt) ?? '',
    qualityTags: isStr(x.qualityTags?.text) && (x.qualityTags.at === 'start' || x.qualityTags.at === 'end') ? { text: x.qualityTags.text, at: x.qualityTags.at } : undefined,
    negativePrompt: str(x.negativePrompt),
    size: str(x.size),
    aspectRatio: str(x.aspectRatio),
    resolution: str(x.resolution),
    variants: Math.min(4, Math.max(1, Number(x.variants) || 1)),
    style: str(x.style),
    seed: Number.isFinite(x.seed) ? x.seed : undefined,
    enhancePrompt: !!x.enhancePrompt || undefined,
    safeMode: x.safeMode !== false,
    format: x.format === 'png' || x.format === 'jpeg' ? x.format : 'webp',
    sourceBlobId: str(x.sourceBlobId),
    scale: x.scale === 4 ? 4 : x.scale === 2 ? 2 : undefined
  };
}

function cleanVideoParams(x: any): VideoParams | undefined {
  if (!x || typeof x !== 'object' || !isStr(x.providerId) || !isStr(x.model) || !(Number(x.duration) > 0)) return undefined;
  return {
    providerId: x.providerId,
    model: x.model,
    prompt: str(x.prompt) ?? '',
    duration: Number(x.duration),
    resolution: str(x.resolution),
    aspectRatio: str(x.aspectRatio),
    audio: x.audio === true || undefined,
    startBlobId: str(x.startBlobId)
  };
}

function cleanAttachments(x: unknown): Attachment[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x
    .filter((a: any) => a && isStr(a.fileId) && isStr(a.name) && isStr(a.text))
    .map((a: any) => ({ fileId: a.fileId, name: a.name.slice(0, 200), mime: isStr(a.mime) ? a.mime : 'text/plain', text: a.text, totalChars: Number(a.totalChars) || a.text.length }));
  return out.length ? out : undefined;
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}
const str = (v: unknown) => (isStr(v) ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** An address a source may link to (http and https only: no javascript: or data: links) */
function webUrl(v: unknown): v is string {
  if (!isStr(v) || !/^https?:\/\//i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * What an answer shows: its text and reasoning, image and video file parts (the image or video itself may or may not
 * be in the file), its sources and the provider's own searches. Tool calls and their results are not kept: they carry
 * what a model or a page wrote for a model to read, and the app would send them back
 */
function cleanPart(p: any): Part | undefined {
  if ((p?.type === 'text' || p?.type === 'reasoning') && isStr(p.text)) return { type: p.type, text: p.text, state: 'done' };
  if (p?.type === 'file' && isStr(p.blobId) && isStr(p.mimeType) && /^(image|video)\//.test(p.mimeType))
    return { type: 'file', blobId: p.blobId, name: isStr(p.name) ? p.name : 'image', mimeType: p.mimeType, ...(Number.isFinite(p.width) ? { width: p.width, height: p.height } : {}) };
  if (p?.type === 'source' && webUrl(p.url)) return { type: 'source', url: p.url, title: str(p.title)?.slice(0, 500), snippet: str(p.snippet)?.slice(0, 1000) };
  if (p?.type === 'server-tool' && isStr(p.id) && isStr(p.name))
    return { type: 'server-tool', id: p.id, name: p.name, query: str(p.query)?.slice(0, 500), state: p.state === 'error' ? 'error' : 'done', resultCount: num(p.resultCount), error: str(p.error)?.slice(0, 500) };
  return undefined;
}

/** The line under an answer: the model, its tokens and cost, and why it ended early */
function cleanMeta(x: any): MessageRecord['meta'] {
  if (!x || typeof x !== 'object') return undefined;
  const u = x.usage && typeof x.usage === 'object' ? x.usage : undefined;
  return {
    providerId: str(x.providerId),
    model: str(x.model),
    usage: u && {
      inputTokens: num(u.inputTokens),
      cachedInputTokens: num(u.cachedInputTokens),
      outputTokens: num(u.outputTokens),
      reasoningTokens: num(u.reasoningTokens),
      webSearches: num(u.webSearches),
      priceFactor: num(u.priceFactor)
    },
    costUsd: num(x.costUsd),
    finishReason: str(x.finishReason),
    truncated: num(x.truncated)
  };
}

export function validate(raw: unknown, files: ReadonlyMap<string, Blob> = new Map()): ExportFile {
  const f = raw as ExportFile;
  if (!f || typeof f !== 'object' || f.format !== EXPORT_FORMAT) throw new Error(t('export.notBackup'));
  if (typeof f.version !== 'number' || f.version > EXPORT_VERSION) throw new Error(t('export.tooNew'));
  if (!Array.isArray(f.conversations) || !Array.isArray(f.messages)) throw new Error(t('export.badFormat'));
  const conversations = f.conversations.filter(
    (c) => c && isStr(c.id) && isStr(c.title) && typeof c.createdAt === 'number' && typeof c.updatedAt === 'number'
  ).map((c) => ({
    id: c.id,
    title: c.title.slice(0, 500),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    currentLeafId: isStr(c.currentLeafId) ? c.currentLeafId : null,
    providerId: isStr(c.providerId) ? c.providerId : '',
    modelId: isStr(c.modelId) ? c.modelId : '',
    systemPrompt: isStr(c.systemPrompt) ? c.systemPrompt : '',
    webSearch: c.webSearch === 'auto' || c.webSearch === 'on' ? c.webSearch : 'off',
    pinned: c.pinned ? 1 : 0,
    tags: Array.isArray(c.tags) ? c.tags.filter(isStr) : [],
    ...(isStr(c.workDir) && cleanFolderName(c.workDir) ? { workDir: cleanFolderName(c.workDir) } : {})
  } as Conversation));
  const convIds = new Set(conversations.map((c) => c.id));
  const messages = f.messages
    .filter((m) => m && isStr(m.id) && convIds.has(m.conversationId) && (m.role === 'user' || m.role === 'assistant' || m.role === 'system') && Array.isArray(m.parts))
    .map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      parentId: isStr(m.parentId) ? m.parentId : null,
      groupId: isStr(m.groupId) ? m.groupId : undefined,
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      role: m.role,
      parts: m.parts.map(cleanPart).filter((p) => !!p),
      status: 'done' as const,
      meta: cleanMeta(m.meta),
      compaction:
        m.compaction && isStr(m.compaction.summary) && isStr(m.compaction.coversUntilId)
          ? {
              summary: m.compaction.summary,
              coversUntilId: m.compaction.coversUntilId,
              count: Number(m.compaction.count) || 0,
              model: str(m.compaction.model),
              auto: m.compaction.auto === true || undefined
            }
          : undefined,
      skills: Array.isArray(m.skills)
        ? m.skills.filter((s: any) => s && isStr(s.name) && isStr(s.body)).map((s: any) => ({ name: s.name, body: s.body }))
        : undefined,
      attachments: cleanAttachments(m.attachments),
      imageRequest: cleanImageParams(m.imageRequest),
      videoRequest: cleanVideoParams(m.videoRequest),
      // A finished video answer (a job still running is not carried over: it belongs to this browser's wait)
      video: m.video && cleanVideoParams(m.video.params)
        ? {
            params: cleanVideoParams(m.video.params)!,
            costUsd: num(m.video.costUsd),
            costEstimated: !!m.video.costEstimated || undefined
          }
        : undefined,
      image: m.image && cleanImageParams(m.image.params)
        ? {
            params: cleanImageParams(m.image.params)!,
            seed: Number.isFinite(m.image.seed) ? m.image.seed : undefined,
            blurred: !!m.image.blurred || undefined,
            violations: Number(m.image.violations) || undefined,
            enhancedPrompt: str(m.image.enhancedPrompt),
            costUsd: num(m.image.costUsd),
            costEstimated: !!m.image.costEstimated || undefined
          }
        : undefined
    } as MessageRecord))
    // Reject system messages other than compaction nodes (so instructions cannot be slipped into a conversation)
    .filter((m) => m.role !== 'system' || !!m.compaction);
  const prompts = (Array.isArray(f.prompts) ? f.prompts : [])
    .filter((p) => p && isStr(p.id) && isStr(p.name) && isStr(p.content))
    .map((p) => ({ id: p.id, name: p.name, content: p.content, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now() }));
  const skills = (Array.isArray(f.skills) ? f.skills : [])
    .filter((s) => s && isStr(s.id) && isStr(s.name) && isStr(s.description) && isStr(s.body))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      body: s.body,
      modelInvocable: s.modelInvocable !== false,
      ...(s.createdBy === 'model' ? { createdBy: 'model' as const } : {}),
      ...(isStr(s.frontmatter) && s.frontmatter.length <= FRONTMATTER_MAX ? { frontmatter: s.frontmatter } : {}),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now()
    }))
    .filter((s) => !validateSkill(s));
  const conversationIds = new Set(conversations.map((c) => c.id));
  const tables = Object.fromEntries(DATA_TABLES.map((t) => [t.key, t.clean(f[t.key], { conversationIds, files })]));
  return { format: EXPORT_FORMAT, version: f.version, exportedAt: String(f.exportedAt ?? ''), conversations, messages, prompts, skills, ...tables, settings: [] };
}
