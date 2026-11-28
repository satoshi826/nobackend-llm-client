// The skill tools: load_skill loads the body of a skill listed in the system prompt (and lists the files of its folder),
// read_skill_file reads a file of a loaded skill, save_skill creates or fixes one. They run entirely in the browser;
// nothing is sent out
import type { Skill } from '../../lib/db/schema';
import { skillBlock, validateSkill, type SkillDraft } from '../../lib/skills/skill';
import { cleanSkillPath, isTextMime, type SkillFile } from '../../lib/skills/files';
import { pathKey } from '../../lib/paths';
import type { Tool } from '../../lib/tools/types';
import { READ_CHUNK, READ_LINES, readLines } from '../../lib/tools/lines';
import { t } from './messages';
import { formatBytes, TranslatedError } from '../../lib/i18n';

export const LOAD_SKILL = 'load_skill';

/** Files of a skill listed at once at most (load_skill's result) */
const LISTED_FILES = 50;

/** A skill's files for the model, one a line: 'reference/a.md (3 bytes)', 'assets/x.png (binary: image/png, 3 bytes)' */
export function fileLines(files: SkillFile[], max = LISTED_FILES): string {
  const lines = files.slice(0, max).map((f) => `- ${f.path} (${isTextMime(f.mime) ? '' : `binary: ${f.mime}, `}${f.bytes} bytes)`);
  return lines.join('\n') + (files.length > max ? `\n[${files.length - max} more; read_skill_file with the path "." lists them all]` : '');
}

/** files: a skill's files (none for a built-in one) */
export function makeSkillTool(list: Pick<Skill, 'id' | 'name' | 'body'>[], files: (skillId: string) => Promise<SkillFile[]>): Tool<{ name: string }> {
  const names = list.map((s) => s.name);
  return {
    name: LOAD_SKILL,
    label: t('tool.load'),
    description: 'Load the full instructions of a skill listed under "Skills" in the system prompt.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', enum: names, description: 'The skill name exactly as listed.' } },
      required: ['name']
    },
    risk: 'read',
    summarize: (i) => i.name,
    prepare(raw) {
      const name = (raw as { name?: unknown })?.name;
      if (typeof name !== 'string' || !name) throw new TranslatedError(() => t('tool.missingName'));
      return { name };
    },
    async execute({ name }) {
      const s = list.find((x) => x.name === name);
      if (!s) throw new TranslatedError(() => (names.length ? t('tool.unknown', { name, names: names.join(', ') }) : t('tool.unknownNone', { name })));
      const own = await files(s.id);
      // After the instructions, so the model knows what the skill has; its paths come with it, like its body
      const listed = own.length ? `\n\nFiles in this skill's folder (${own.length}; paths inside it; read them with read_skill_file):\n${fileLines(own)}` : '';
      return { content: skillBlock(s) + listed, details: { name: s.name, chars: s.body.length } };
    }
  };
}

export const READ_SKILL_FILE = 'read_skill_file';

/** The skills of a conversation whose files its model may read: those loaded in it that have files */
export interface SkillFilesDeps {
  skills: Pick<Skill, 'id' | 'name'>[];
  files(skillId: string): Promise<SkillFile[]>;
  /** A text file's text, else its bytes (undefined when there is no such file) */
  read(skillId: string, path: string): Promise<string | Blob | undefined>;
}

const obj = (raw: unknown) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
const int = (v: unknown, min: number) => (Number.isFinite(Number(v)) ? Math.max(min, Math.floor(Number(v))) : undefined);

/** The skill a call names, among those the tools reach */
function skillOf(deps: SkillFilesDeps, name: string): Pick<Skill, 'id' | 'name'> {
  const s = deps.skills.find((x) => x.name === name);
  if (s) return s;
  const names = deps.skills.map((x) => x.name).join(', ');
  throw new TranslatedError(() => (names ? t('tool.unknown', { name, names }) : t('tool.unknownNone', { name })));
}

/** skill and path as a call gives them: path cleaned inside the skill's folder, '' for the whole folder ('.') */
function skillPath(r: Record<string, unknown>): { skill: string; path: string } {
  const skill = typeof r.skill === 'string' ? r.skill : '';
  if (!skill) throw new TranslatedError(() => t('tool.missingName'));
  const raw = typeof r.path === 'string' ? r.path.trim() : '';
  if (!raw) throw new TranslatedError(() => t('tool.missingPath'));
  return { skill, path: /^\.?\/?$/.test(raw) ? '' : cleanSkillPath(raw) };
}

const SKILL_PARAM = (names: string[]) => ({ type: 'string', enum: names, description: 'The skill, as loaded in this conversation.' });

/** read_skill_file: a file of a skill loaded in the conversation, with line numbers as read_file gives them */
export function makeReadSkillFileTool(deps: SkillFilesDeps): Tool<{ skill: string; path: string; offset: number; limit: number }> {
  return {
    name: READ_SKILL_FILE,
    label: t('tool.readFile'),
    description: `Read a file of a skill loaded in this conversation (its files are listed under its instructions), with line numbers: up to ${READ_LINES} lines or ${READ_CHUNK} characters per call; a note at the end gives the line to continue from. A folder's path lists the files in it ("." for all of them). Binary files (images, PDFs) cannot be read.`,
    parameters: {
      type: 'object',
      properties: {
        skill: SKILL_PARAM(deps.skills.map((s) => s.name)),
        path: { type: 'string', description: 'The path inside the skill\'s folder, e.g. "reference/forms.md".' },
        offset: { type: 'number', description: 'Optional. The line to start from, 1-based; default 1.' },
        limit: { type: 'number', description: `Optional. How many lines; default ${READ_LINES}.` }
      },
      required: ['skill', 'path']
    },
    risk: 'read',
    // Like load_skill: it reads what the user brought in as the skill, and sends nothing
    defaultPermission: 'allow',
    summarize: (i) => `${i.skill}/${i.path}${i.offset > 1 ? `:${i.offset}` : ''}`,
    prepare(raw) {
      const r = obj(raw);
      return { ...skillPath(r), offset: int(r.offset, 1) ?? 1, limit: Math.min(READ_LINES, int(r.limit, 1) ?? READ_LINES) };
    },
    async execute(i) {
      const s = skillOf(deps, i.skill);
      const files = await deps.files(s.id);
      const key = pathKey(i.path);
      const f = i.path ? files.find((x) => pathKey(x.path) === key) : undefined;
      const details = { skill: s.name, path: i.path || '.' };
      if (!f) {
        const inside = files.filter((x) => !key || pathKey(x.path).startsWith(`${key}/`));
        if (!inside.length) throw new TranslatedError(() => t('tool.noFile', { skill: s.name, path: i.path }));
        return { content: `Files in ${i.path ? JSON.stringify(`${i.path}/`) : 'the folder'} of the skill "${s.name}" (${inside.length}):\n${fileLines(inside, Infinity)}`, details };
      }
      if (!isTextMime(f.mime)) throw new TranslatedError(() => t('tool.binary', { path: f.path, mime: f.mime, size: formatBytes(f.bytes) }));
      const text = await deps.read(s.id, f.path);
      if (typeof text !== 'string') throw new TranslatedError(() => t('tool.noFile', { skill: s.name, path: f.path }));
      const got = readLines(text, i.offset, i.limit, JSON.stringify(f.path));
      if ('past' in got) return { content: got.past, details };
      return { content: `<skill_file skill="${s.name}" path=${JSON.stringify(f.path)}>\n${got.lines}\n</skill_file>${got.note}`, details };
    }
  };
}

export const SAVE_SKILL = 'save_skill';

export interface SaveSkillInput {
  name: string;
  description: string;
  body: string;
  model_invocable: boolean;
}

export interface SaveSkillDeps {
  find(name: string): Pick<Skill, 'id' | 'name' | 'builtin'> | undefined;
  save(draft: SkillDraft, id: string | undefined): Promise<unknown>;
}

/** save_skill: create or fix a skill (always goes through user approval) */
export function makeSaveSkillTool(deps: SaveSkillDeps): Tool<SaveSkillInput> {
  return {
    name: SAVE_SKILL,
    label: t('tool.save'),
    description:
      'Create a new skill, or update an existing skill with the same name. The user reviews and may edit the draft before it is saved. When updating, load the current skill first and keep the parts the user did not ask to change.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'lowercase letters, digits and hyphens, e.g. meeting-notes. Same name = update.' },
        description: { type: 'string', description: 'What the skill does and when to use it (1-2 sentences). Models decide from this alone.' },
        body: { type: 'string', description: 'The instructions in Markdown.' },
        model_invocable: { type: 'boolean', description: 'Let models load it on their own (default true).' }
      },
      required: ['name', 'description', 'body']
    },
    risk: 'write',
    // Saving a skill always goes through the user, whatever the settings say
    alwaysAsk: true,
    summarize: (i) => i.name,
    prepare(raw) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const input: SaveSkillInput = {
        name: typeof r.name === 'string' ? r.name.trim().toLowerCase() : '',
        description: typeof r.description === 'string' ? r.description.trim() : '',
        body: typeof r.body === 'string' ? r.body : '',
        model_invocable: r.model_invocable !== false
      };
      const draft = { name: input.name, description: input.description, body: input.body, modelInvocable: input.model_invocable };
      if (validateSkill(draft)) throw new TranslatedError(() => validateSkill(draft)!);
      if (deps.find(input.name)?.builtin) throw new TranslatedError(() => t('tool.builtinReadOnly', { name: input.name }));
      return input;
    },
    async execute(i) {
      const existing = deps.find(i.name);
      await deps.save({ name: i.name, description: i.description, body: i.body, modelInvocable: i.model_invocable }, existing?.id);
      // For the model only: English, like the descriptions
      return { content: `${existing ? 'Updated' : 'Created'} the skill ${JSON.stringify(i.name)}.`, details: { name: i.name, updated: !!existing } };
    }
  };
}
