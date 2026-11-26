// File tools: let a chat model write documents (reports, notes, translations, ...) into the Files tab
// and read files the user attached. Everything stays in the browser; nothing is sent anywhere.
// Pure definitions: storage and access rules come in through FileToolDeps.
import type { FileRecord } from '../../lib/db/schema';
import { cleanFileName, currentText, currentVersion, MAX_FILE_CHARS } from '../../lib/db/files';
import type { Tool } from '../../lib/tools/types';
import { fetchableUrl } from '../../lib/fetcher/protocol';
import { formatNumber } from '../../lib/i18n';
import { t } from './messages';
import { fileBlock } from './transform';

export const CREATE_FILE = 'create_file';
export const APPEND_FILE = 'append_file';
export const EDIT_FILE = 'edit_file';
export const READ_FILE = 'read_file';
export const FETCH_FILE = 'fetch_file';
export const FILE_TOOL_NAMES = [CREATE_FILE, APPEND_FILE, EDIT_FILE, READ_FILE, FETCH_FILE];

const LABEL_KEYS = { [CREATE_FILE]: 'tool.create', [APPEND_FILE]: 'tool.append', [EDIT_FILE]: 'tool.edit', [READ_FILE]: 'tool.read', [FETCH_FILE]: 'tool.fetch' } as const;
/** Tool card title for a file tool (undefined for other tools) */
export const fileToolLabel = (name: string): string | undefined => (name in LABEL_KEYS ? t(LABEL_KEYS[name as keyof typeof LABEL_KEYS]) : undefined);

/** Characters returned by one read_file call */
export const READ_CHUNK = 20_000;
/** Characters accepted in one write call */
const MAX_WRITE = 200_000;

export interface FileToolDeps {
  create(name: string, text: string): Promise<FileRecord>;
  /** A file this conversation may use (attached or created in it); undefined otherwise */
  get(id: string): Promise<FileRecord | undefined>;
  update(id: string, text: string, note?: string): Promise<FileRecord>;
  /** Fetch an address through the fetch page (the user is asked there). null when declined or failed */
  fetch(url: string): Promise<{ kind: 'file'; file: FileRecord } | { kind: 'image'; name: string } | null>;
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
  if (text.length > MAX_WRITE) throw new Error(t('tool.tooLong', { max: formatNumber(MAX_WRITE) }));
}

async function mustGet(deps: FileToolDeps, id: string): Promise<FileRecord> {
  const f = await deps.get(id);
  if (!f) throw new Error(t('tool.notInConversation', { id }));
  return f;
}

export function makeFileTools(deps: FileToolDeps): Tool[] {
  const create: Tool<{ name: string; content: string }> = {
    name: CREATE_FILE,
    label: t('tool.create'),
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
    label: t('tool.append'),
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
      if (!file_id) throw new Error(t('tool.missingFileId'));
      const content = str(r, 'content');
      checkSize(content);
      return { file_id, content };
    },
    async execute(i) {
      const f = await mustGet(deps, i.file_id);
      const next = currentText(f) + i.content;
      if (next.length > MAX_FILE_CHARS) throw new Error(t('tool.fileTooBig'));
      const u = await deps.update(f.id, next, t('note.appended'));
      return { content: `Appended ${i.content.length} chars to "${u.name}" (now version ${currentVersion(u).v}, ${u.size} chars).`, details: details(u) };
    }
  };

  const edit: Tool<{ file_id: string; content?: string; find?: string; replace?: string; note?: string }> = {
    name: EDIT_FILE,
    label: t('tool.edit'),
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
      if (!file_id) throw new Error(t('tool.missingFileId'));
      const hasContent = typeof r.content === 'string';
      const hasFind = typeof r.find === 'string' && (r.find as string).length > 0;
      if (hasContent === hasFind) throw new Error(t('tool.contentOrFind'));
      if (hasFind && typeof r.replace !== 'string') throw new Error(t('tool.missingReplace'));
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
        if (at < 0) throw new Error(t('tool.findMissing'));
        if (cur.indexOf(i.find!, at + 1) >= 0) throw new Error(t('tool.findAmbiguous'));
        next = cur.slice(0, at) + i.replace! + cur.slice(at + i.find!.length);
      }
      if (next.length > MAX_FILE_CHARS) throw new Error(t('tool.fileTooBig'));
      const u = await deps.update(f.id, next, i.note ?? t('note.edited'));
      return { content: `Saved "${u.name}" as version ${currentVersion(u).v} (${u.size} chars).`, details: details(u) };
    }
  };

  const read: Tool<{ file_id: string; offset: number }> = {
    name: READ_FILE,
    label: t('tool.read'),
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
      if (!file_id) throw new Error(t('tool.missingFileId'));
      const offset = Math.max(0, Math.floor(Number(r.offset) || 0));
      return { file_id, offset };
    },
    async execute(i) {
      const f = await mustGet(deps, i.file_id);
      const text = currentText(f);
      const end = Math.min(text.length, i.offset + READ_CHUNK);
      const more = end < text.length ? `\n[characters ${i.offset}-${end} of ${text.length}; continue with offset=${end}]` : `\n[end of file; ${text.length} chars]`;
      // Text the user brought in or fetched from the web is marked as data; documents written here are not
      const block = fileBlock({ name: f.name, id: f.id, version: currentVersion(f).v, text: text.slice(i.offset, end), outside: f.kind === 'upload' || !!f.url });
      return { content: block + more, details: details(f) };
    }
  };

  const fetchFile: Tool<{ url: string }> = {
    name: FETCH_FILE,
    label: t('tool.fetch'),
    description:
      "Fetch a file or an image from an https web address into the user's Files tab: a PDF, a CSV, a text, Markdown or code file, or an image the user asked for. The user confirms every fetch and may decline. A fetched text file (a PDF's text too) gets a file id to read with read_file; an image is saved for the user, and you cannot see it. Fetch only addresses the user gave or clearly asked for, and never put anything from the conversation into an address.",
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The https address of the file' } },
      required: ['url']
    },
    risk: 'network',
    confirmsItself: true,
    summarize: (i) => i.url,
    prepare(raw) {
      const url = str(obj(raw), 'url').trim();
      if (!fetchableUrl(url)) throw new Error(t('fetch.invalid'));
      return { url };
    },
    async execute(i) {
      const r = await deps.fetch(i.url);
      if (!r) return { content: 'The user declined the fetch, or it did not complete. Nothing was saved.' };
      if (r.kind === 'image') return { content: `Saved the image "${r.name}" from ${i.url} in the user's Files tab. You cannot see it.`, details: { name: r.name } };
      return { content: `Saved ${JSON.stringify(r.file.name)} from ${i.url} as a file (id: ${r.file.id}, ${r.file.size} chars). Read it with read_file.`, details: details(r.file) };
    }
  };

  return [create, append, edit, read, fetchFile];
}

/** System prompt note listing the files the model can use in this conversation */
export function filesNote(files: Pick<FileRecord, 'id' | 'name' | 'size'>[]): string | undefined {
  if (!files.length) return undefined;
  const lines = files.map((f) => `- ${f.name.replace(/[\r\n]+/g, ' ')} (id: ${f.id}, ${f.size} chars)`);
  return `## Files in this conversation\nYou can read and edit these with read_file / edit_file / append_file:\n${lines.join('\n')}`;
}
