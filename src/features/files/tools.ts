// File tools: let a chat model write documents (reports, notes, translations, ...) into the Files tab
// and read files the user attached. Everything stays in the browser; nothing is sent anywhere.
// Pure definitions: storage and access rules come in through FileToolDeps.
import type { FileRecord } from '../../lib/db/schema';
import { cleanFileName, currentText, currentVersion, MAX_FILE_CHARS } from '../../lib/db/files';
import type { Tool } from '../../lib/tools/types';

export const CREATE_FILE = 'create_file';
export const APPEND_FILE = 'append_file';
export const EDIT_FILE = 'edit_file';
export const READ_FILE = 'read_file';
export const FILE_TOOL_NAMES = [CREATE_FILE, APPEND_FILE, EDIT_FILE, READ_FILE];

/** Characters returned by one read_file call */
export const READ_CHUNK = 20_000;
/** Characters accepted in one write call */
const MAX_WRITE = 200_000;

export interface FileToolDeps {
  create(name: string, text: string): Promise<FileRecord>;
  /** A file this conversation may use (attached or created in it); undefined otherwise */
  get(id: string): Promise<FileRecord | undefined>;
  update(id: string, text: string, note?: string): Promise<FileRecord>;
}

/** What the tool card shows */
export interface FileToolDetails {
  fileId: string;
  name: string;
  version: number;
  chars: number;
}

const details = (f: FileRecord): FileToolDetails => ({ fileId: f.id, name: f.name, version: currentVersion(f).v, chars: f.size });
const str = (r: Record<string, unknown>, k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
const obj = (raw: unknown) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});

function checkSize(text: string) {
  if (text.length > MAX_WRITE) throw new Error(`一度に書ける長さ（${MAX_WRITE.toLocaleString()} 文字）を超えています。append_file で分けて書いてください。`);
}

async function mustGet(deps: FileToolDeps, id: string): Promise<FileRecord> {
  const f = await deps.get(id);
  if (!f) throw new Error(`ファイル ${id} は、この会話では使えません（添付されたファイルか、この会話で作ったファイルだけが使えます）。`);
  return f;
}

export function makeFileTools(deps: FileToolDeps): Tool[] {
  const create: Tool<{ name: string; content: string }> = {
    name: CREATE_FILE,
    label: 'ファイルの作成',
    description:
      'Create a new file in the user\'s Files tab, e.g. a report, notes, a translation or a table. Use it when the user asks for a document or a deliverable, or when the result is long. Markdown (.md) unless another format fits better (.csv, .json, .txt, ...). For long documents write the first part here and continue with append_file. After creating it, reply briefly (what it contains) instead of repeating the content.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name with extension, e.g. "market-report.md"' },
        content: { type: 'string', description: 'Full text (or the first part) of the file' }
      },
      required: ['name', 'content']
    },
    risk: 'write',
    summarize: (i) => i.name,
    prepare(raw) {
      const r = obj(raw);
      const name = cleanFileName(str(r, 'name'));
      const content = str(r, 'content');
      checkSize(content);
      return { name, content };
    },
    async execute(i) {
      const f = await deps.create(i.name, i.content);
      return {
        content: `Created "${f.name}" (id: ${f.id}, version 1, ${f.size} chars). The user sees it as a file card and can open it from the Files tab.`,
        details: details(f)
      };
    }
  };

  const append: Tool<{ file_id: string; content: string }> = {
    name: APPEND_FILE,
    label: 'ファイルへの追記',
    description: 'Append text to the end of a file created in this conversation (to write long documents in parts). Include a leading newline when starting a new section.',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'id returned by create_file' },
        content: { type: 'string', description: 'Text to add at the end' }
      },
      required: ['file_id', 'content']
    },
    risk: 'write',
    summarize: (i) => i.file_id,
    prepare(raw) {
      const r = obj(raw);
      const file_id = str(r, 'file_id').trim();
      if (!file_id) throw new Error('file_id がありません。');
      const content = str(r, 'content');
      checkSize(content);
      return { file_id, content };
    },
    async execute(i) {
      const f = await mustGet(deps, i.file_id);
      const next = currentText(f) + i.content;
      if (next.length > MAX_FILE_CHARS) throw new Error('ファイルが大きくなりすぎます。別のファイルに分けてください。');
      const u = await deps.update(f.id, next, '追記');
      return { content: `Appended ${i.content.length} chars to "${u.name}" (now version ${currentVersion(u).v}, ${u.size} chars).`, details: details(u) };
    }
  };

  const edit: Tool<{ file_id: string; content?: string; find?: string; replace?: string; note?: string }> = {
    name: EDIT_FILE,
    label: 'ファイルの編集',
    description:
      'Change a file as a new version (older versions are kept). Either give the whole new text in "content", or replace one exact passage: "find" (must occur exactly once) and "replace". Read the file first if you have not seen its current text.',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string' },
        content: { type: 'string', description: 'Whole new text (replaces everything)' },
        find: { type: 'string', description: 'Exact passage to replace' },
        replace: { type: 'string', description: 'Replacement for "find"' },
        note: { type: 'string', description: 'Short summary of the change' }
      },
      required: ['file_id']
    },
    risk: 'write',
    summarize: (i) => i.note || i.file_id,
    prepare(raw) {
      const r = obj(raw);
      const file_id = str(r, 'file_id').trim();
      if (!file_id) throw new Error('file_id がありません。');
      const hasContent = typeof r.content === 'string';
      const hasFind = typeof r.find === 'string' && (r.find as string).length > 0;
      if (hasContent === hasFind) throw new Error('content（全体の置き換え）か find と replace（一部の置き換え）の、どちらか一方を指定してください。');
      if (hasFind && typeof r.replace !== 'string') throw new Error('replace がありません。');
      const out = { file_id, ...(hasContent ? { content: r.content as string } : { find: r.find as string, replace: r.replace as string }), ...(str(r, 'note') ? { note: str(r, 'note').slice(0, 200) } : {}) };
      checkSize('content' in out ? out.content : out.replace);
      return out;
    },
    async execute(i) {
      const f = await mustGet(deps, i.file_id);
      let next: string;
      if (i.content !== undefined) next = i.content;
      else {
        const cur = currentText(f);
        const at = cur.indexOf(i.find!);
        if (at < 0) throw new Error('find の文字列がファイル内に見つかりません。read_file で今の内容を確かめてください。');
        if (cur.indexOf(i.find!, at + 1) >= 0) throw new Error('find の文字列がファイル内に複数あります。前後を含めて、1 か所に決まるようにしてください。');
        next = cur.slice(0, at) + i.replace! + cur.slice(at + i.find!.length);
      }
      if (next.length > MAX_FILE_CHARS) throw new Error('ファイルが大きくなりすぎます。');
      const u = await deps.update(f.id, next, i.note ?? '編集');
      return { content: `Saved "${u.name}" as version ${currentVersion(u).v} (${u.size} chars).`, details: details(u) };
    }
  };

  const read: Tool<{ file_id: string; offset: number }> = {
    name: READ_FILE,
    label: 'ファイルの読み込み',
    description: `Read a file attached to or created in this conversation, ${READ_CHUNK.toLocaleString('en')} characters at a time. Use "offset" to continue where the previous read (or an attachment excerpt) stopped.`,
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string' },
        offset: { type: 'number', description: 'Character offset to start from (default 0)' }
      },
      required: ['file_id']
    },
    risk: 'read',
    summarize: (i) => (i.offset ? `${i.file_id} @${i.offset}` : i.file_id),
    prepare(raw) {
      const r = obj(raw);
      const file_id = str(r, 'file_id').trim();
      if (!file_id) throw new Error('file_id がありません。');
      const offset = Math.max(0, Math.floor(Number(r.offset) || 0));
      return { file_id, offset };
    },
    async execute(i) {
      const f = await mustGet(deps, i.file_id);
      const text = currentText(f);
      const end = Math.min(text.length, i.offset + READ_CHUNK);
      const more = end < text.length ? `\n[characters ${i.offset}-${end} of ${text.length}; continue with offset=${end}]` : `\n[end of file; ${text.length} chars]`;
      return { content: `<file name="${f.name}" id="${f.id}" version="${currentVersion(f).v}">\n${text.slice(i.offset, end)}\n</file>${more}`, details: details(f) };
    }
  };

  return [create, append, edit, read];
}

/** System prompt note listing the files the model can use in this conversation */
export function filesNote(files: Pick<FileRecord, 'id' | 'name' | 'size'>[]): string | undefined {
  if (!files.length) return undefined;
  const lines = files.map((f) => `- ${f.name} (id: ${f.id}, ${f.size} chars)`);
  return `## Files in this conversation\nYou can read and edit these with read_file / edit_file / append_file:\n${lines.join('\n')}`;
}
