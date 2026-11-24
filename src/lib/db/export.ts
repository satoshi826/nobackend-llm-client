// JSON エクスポート / インポート。API キーは既定で含めない。
import { db, SCHEMA_VERSION, type Conversation, type MessageRecord, type SavedPrompt, type Skill } from './schema';
import { validateSkill } from '../skills/skill';

export const EXPORT_FORMAT = 'nobackend-llm-client/export';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  conversations: Conversation[];
  messages: MessageRecord[];
  prompts: SavedPrompt[];
  /** v3 から */
  skills?: Skill[];
  settings: { key: string; value: unknown }[];
}

export async function exportAll(): Promise<ExportFile> {
  const d = db();
  return {
    format: EXPORT_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    conversations: await d.conversations.toArray(),
    messages: await d.messages.toArray(),
    prompts: await d.prompts.toArray(),
    skills: await d.skills.toArray(),
    // 接続設定・キーは含めない（インポートで baseUrl を差し替えられる攻撃を避ける）
    settings: (await d.settings.toArray()).filter((s) => !String(s.key).startsWith('secret'))
  };
}

export interface ImportResult {
  conversations: number;
  messages: number;
  prompts: number;
  skills: number;
  skipped: number;
}

/** 形式を検証してからマージ（同じ ID は上書きしない＝スキップ）。 */
export async function importAll(raw: unknown): Promise<ImportResult> {
  const f = validate(raw);
  const d = db();
  const res: ImportResult = { conversations: 0, messages: 0, prompts: 0, skills: 0, skipped: 0 };
  await d.transaction('rw', [d.conversations, d.messages, d.prompts, d.skills], async () => {
    for (const c of f.conversations) {
      if (await d.conversations.get(c.id)) {
        res.skipped++;
        continue;
      }
      await d.conversations.put({ ...c, temporary: undefined });
      res.conversations++;
    }
    for (const m of f.messages) {
      if (await d.messages.get(m.id)) {
        res.skipped++;
        continue;
      }
      await d.messages.put(m);
      res.messages++;
    }
    for (const p of f.prompts) {
      if (await d.prompts.get(p.id)) {
        res.skipped++;
        continue;
      }
      await d.prompts.put(p);
      res.prompts++;
    }
    // スキルは名前が一意。同じ ID か同じ名前があれば手元のものを残す
    for (const s of f.skills ?? []) {
      if ((await d.skills.get(s.id)) || (await d.skills.where('name').equals(s.name).count())) {
        res.skipped++;
        continue;
      }
      await d.skills.put(s);
      res.skills++;
    }
  });
  return res;
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

export function validate(raw: unknown): ExportFile {
  const f = raw as ExportFile;
  if (!f || typeof f !== 'object' || f.format !== EXPORT_FORMAT) throw new Error('このアプリのエクスポートファイルではありません。');
  if (typeof f.version !== 'number' || f.version > SCHEMA_VERSION) throw new Error('より新しいバージョンで作られたファイルです。');
  if (!Array.isArray(f.conversations) || !Array.isArray(f.messages)) throw new Error('ファイルの形式が不正です。');
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
    tags: Array.isArray(c.tags) ? c.tags.filter(isStr) : []
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
      // テキスト系パーツだけ受け入れる（file/tool は参照先がないため）
      parts: m.parts.filter((p: any) => (p?.type === 'text' || p?.type === 'reasoning') && isStr(p.text)).map((p: any) => ({ type: p.type, text: p.text, state: 'done' as const })),
      status: 'done' as const,
      meta: m.meta && typeof m.meta === 'object' ? { model: isStr((m.meta as any).model) ? (m.meta as any).model : undefined } : undefined,
      compaction:
        m.compaction && isStr(m.compaction.summary) && isStr(m.compaction.coversUntilId)
          ? { summary: m.compaction.summary, coversUntilId: m.compaction.coversUntilId, count: Number(m.compaction.count) || 0 }
          : undefined,
      skills: Array.isArray(m.skills)
        ? m.skills.filter((s: any) => s && isStr(s.name) && isStr(s.body)).map((s: any) => ({ name: s.name, body: s.body }))
        : undefined
    } as MessageRecord))
    // 圧縮ノード以外の system メッセージは受け付けない（会話の途中に指示を紛れ込ませないため）
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
  return { format: EXPORT_FORMAT, version: f.version, exportedAt: String(f.exportedAt ?? ''), conversations, messages, prompts, skills, settings: [] };
}
