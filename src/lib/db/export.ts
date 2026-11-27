// JSON export / import. API keys are not included by default.
import { db, SCHEMA_VERSION, type Conversation, type ImageParams, type MessageRecord, type SavedPrompt, type Skill, type VideoParams } from './schema';
import { validateSkill } from '../skills/skill';
import { seal, unseal } from './sealed';
import { dataTables } from './data-tables';
import type { Attachment } from './schema';
import { t } from './messages';
import { cleanFolderName } from '../paths';

const openAll = <T extends object>(rows: T[]) => Promise.all(rows.map((r) => unseal(r)));

export const EXPORT_FORMAT = 'nobackend-llm-client/export';

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

export async function exportAll(includeImages = false): Promise<ExportFile> {
  const d = db();
  return {
    format: EXPORT_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    // Data stored encrypted is decrypted on export too (backup files are not encrypted)
    conversations: await openAll(await d.conversations.toArray()),
    messages: await openAll(await d.messages.toArray()),
    prompts: await openAll(await d.prompts.toArray()),
    skills: await openAll(await d.skills.toArray()),
    ...(await tableRows(includeImages)),
    // Connection settings and keys are excluded (avoids attacks that swap baseUrl via import)
    settings: (await d.settings.toArray()).filter((s) => !String(s.key).startsWith('secret'))
  };
}

async function tableRows(includeImages: boolean): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of dataTables()) {
    const rows = await t.exportRows({ includeImages });
    if (rows) out[t.key] = rows;
  }
  return out;
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

/** Validate the format, then merge (existing IDs are not overwritten, i.e. skipped). */
export async function importAll(raw: unknown): Promise<ImportResult> {
  const f = validate(raw);
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
  for (const t of dataTables()) {
    const rows = f[t.key] as unknown[] | undefined;
    if (rows?.length) res.tables[t.key] = await t.importRows(rows);
  }
  return res;
}

/** Keep only well-formed image request fields */
function cleanImageParams(x: any): ImageParams | undefined {
  if (!x || typeof x !== 'object' || !['generate', 'upscale', 'edit', 'remove-bg'].includes(x.op) || !isStr(x.providerId)) return undefined;
  const str = (v: unknown) => (isStr(v) ? v : undefined);
  return {
    op: x.op,
    providerId: x.providerId,
    model: str(x.model) ?? '',
    prompt: str(x.prompt) ?? '',
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
  const str = (v: unknown) => (isStr(v) ? v : undefined);
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

export function validate(raw: unknown): ExportFile {
  const f = raw as ExportFile;
  if (!f || typeof f !== 'object' || f.format !== EXPORT_FORMAT) throw new Error(t('export.notBackup'));
  if (typeof f.version !== 'number' || f.version > SCHEMA_VERSION) throw new Error(t('export.tooNew'));
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
      // Text parts, plus image and video file parts (the image or video itself may or may not be in the file); tool
      // parts have nothing to refer to
      parts: m.parts
        .filter((p: any) => ((p?.type === 'text' || p?.type === 'reasoning') && isStr(p.text)) || (p?.type === 'file' && isStr(p.blobId) && isStr(p.mimeType) && /^(image|video)\//.test(p.mimeType)))
        .map((p: any) =>
          p.type === 'file'
            ? { type: 'file' as const, blobId: p.blobId, name: isStr(p.name) ? p.name : 'image', mimeType: p.mimeType, ...(Number.isFinite(p.width) ? { width: p.width, height: p.height } : {}) }
            : { type: p.type, text: p.text, state: 'done' as const }
        ),
      status: 'done' as const,
      meta: m.meta && typeof m.meta === 'object' ? { model: isStr((m.meta as any).model) ? (m.meta as any).model : undefined } : undefined,
      compaction:
        m.compaction && isStr(m.compaction.summary) && isStr(m.compaction.coversUntilId)
          ? { summary: m.compaction.summary, coversUntilId: m.compaction.coversUntilId, count: Number(m.compaction.count) || 0 }
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
            costUsd: Number.isFinite(m.video.costUsd) ? m.video.costUsd : undefined,
            costEstimated: !!m.video.costEstimated || undefined
          }
        : undefined,
      image: m.image && cleanImageParams(m.image.params)
        ? {
            params: cleanImageParams(m.image.params)!,
            seed: Number.isFinite(m.image.seed) ? m.image.seed : undefined,
            blurred: !!m.image.blurred || undefined,
            violations: Number(m.image.violations) || undefined
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
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now()
    }))
    .filter((s) => !validateSkill(s));
  const conversationIds = new Set(conversations.map((c) => c.id));
  const tables = Object.fromEntries(dataTables().map((t) => [t.key, t.clean(f[t.key], { conversationIds })]));
  return { format: EXPORT_FORMAT, version: f.version, exportedAt: String(f.exportedAt ?? ''), conversations, messages, prompts, skills, ...tables, settings: [] };
}
