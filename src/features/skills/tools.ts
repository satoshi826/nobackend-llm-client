// The skill tools: load_skill loads the body of a skill listed in the system prompt (and lists the files of its folder),
// read_skill_file reads a file of a loaded skill, run_skill_script runs one of its scripts in the sandbox, save_skill
// creates or fixes one. They run entirely in the browser; nothing is sent out
import type { Skill } from '../../lib/db/schema';
import { skillBlock, validateSkill, type SkillDraft } from '../../lib/skills/skill';
import { cleanSkillPath, isTextMime, type SkillFile } from '../../lib/skills/files';
import { cleanFileName, extOf, pathKey } from '../../lib/paths';
import { MAX_FILE_CHARS } from '../../lib/db/files';
import { RUN_TIMEOUT_MS, type ScriptJob, type ScriptResult } from '../../lib/sandbox/client';
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
      const listed = own.length ? `\n\nFiles in this skill's folder (${own.length}; paths inside it; read them with read_skill_file, run a .js script with run_skill_script):\n${fileLines(own)}` : '';
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

export const RUN_SKILL_SCRIPT = 'run_skill_script';

/** Where a script finds its skill's files (read-only), and where it starts and writes (the working folder's files given) */
const SKILL_ROOT = '/skill';
const WORK = '/work';
/** Characters of stdout (its start) and of stderr (its end, where errors are) given back to the model */
const STDOUT_CHARS = 8000;
const STDERR_CHARS = 4000;
/** Files written by one run offered for saving at most, and working-folder files given to it */
const MAX_SAVED = 50;
const MAX_INPUTS = 10;

/** A file a script wrote that may be saved in the working folder */
export interface ScriptOutputFile {
  /** Its path in the working folder */
  path: string;
  bytes: number;
  /** A file of the working folder has this path: saving gives it this text */
  replaces: boolean;
}

/** What a run printed, as the card shows it (cut as the model gets it) */
export interface ScriptPrinted {
  code: number;
  stdout: string;
  stderr: string;
}

/** What the card of a run shows once it ended */
export interface ScriptDetails extends Partial<ScriptPrinted> {
  /** It did not end by itself (stopped by the time limit) */
  error?: string;
  saved?: string[];
  /** The user chose not to save the files it wrote */
  declined?: boolean;
}

export interface ScriptDeps extends SkillFilesDeps {
  /** A file of the conversation by path or id: its path as the model sees it, and its text (undefined: no such file) */
  input(ref: string): Promise<{ name: string; text: string } | undefined>;
  /** The libraries these sources require (lib/sandbox/libraries.ts), and the names of all there are */
  libraries(sources: string[]): Promise<Record<string, string>>;
  libraryNames: string[];
  run(job: ScriptJob, signal: AbortSignal): Promise<ScriptResult>;
  /** Which of these working-folder paths a file there has */
  existing(paths: string[]): Promise<Set<string>>;
  /** Ask the user, on the call's card, which files to save: the paths chosen, or null (declined, or stopped) */
  ask(toolCallId: string, files: ScriptOutputFile[], printed: ScriptPrinted, signal: AbortSignal): Promise<string[] | null>;
  /**
   * Save text files in the working folder (named `folder` when this makes it): each one's path and whether it replaced
   * a file, or why it was not saved
   */
  save(files: { path: string; text: string }[], folder: string): Promise<({ path: string; replaced: boolean } | { path: string; error: string })[]>;
}

/** Text cut to `max` characters, keeping its start (or end), with a note on how much there was */
function clip(text: string, total: number, max: number, what: string, keepEnd = false): string {
  if (total <= max && text.length <= max) return text;
  return keepEnd ? `[the first ${total - max} characters of ${what} are left out]\n${text.slice(-max)}` : `${text.slice(0, max)}\n[${what} is cut at ${max} of its ${total} characters]`;
}

/** A file's bytes as text, when they are UTF-8 with no NUL (as a working-folder file can hold), else null */
function asText(v: string | Uint8Array): string | null {
  if (typeof v === 'string') return v;
  if (v.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(v);
  } catch {
    return null;
  }
}

/**
 * run_skill_script: run a JavaScript file of a loaded skill as Node would, in a sandbox worker, then offer the files
 * it wrote to the user to save in the working folder
 */
export function makeRunSkillScriptTool(deps: ScriptDeps): Tool<{ skill: string; path: string; args: string[]; file_ids: string[] }> {
  const libs = deps.libraryNames.length ? `, the libraries ${deps.libraryNames.join(', ')} by name` : '';
  return {
    name: RUN_SKILL_SCRIPT,
    label: t('tool.runScript'),
    description: `Run a JavaScript file of a skill loaded in this conversation, as \`node <path> <args>\` would, in an isolated sandbox with no network and no access to this app, and get back its exit code, what it printed (stdout, stderr) and the files it wrote. CommonJS only (.js, .cjs: require and module.exports, not import/export). It has process (argv, exit, exitCode, env, stdout/stderr.write), console, timers, __dirname, __filename and require of fs (sync, callback and promise forms), path, util${libs} and the skill's own .js and .json files by relative path; no other packages, no child processes. Only JavaScript runs here: a .py or .sh script cannot. The skill's files are at ${SKILL_ROOT}/<path> (read-only). The script starts in ${WORK}: the working-folder files given in file_ids are there at their paths, and the files it writes under ${WORK} are offered to the user to save in the working folder at the same paths (the result says what was saved). It is stopped after ${RUN_TIMEOUT_MS / 1000} seconds. The user approves every run.`,
    parameters: {
      type: 'object',
      properties: {
        skill: SKILL_PARAM(deps.skills.map((s) => s.name)),
        path: { type: 'string', description: 'The script\'s path inside the skill\'s folder, e.g. "scripts/fill.js".' },
        args: { type: 'array', items: { type: 'string' }, description: 'Optional. Its command-line arguments (process.argv.slice(2)).' },
        file_ids: { type: 'array', items: { type: 'string' }, description: `Optional. Paths or ids of working-folder files to give it, at most ${MAX_INPUTS}: each is at ${WORK}/<its path>.` }
      },
      required: ['skill', 'path']
    },
    risk: 'exec',
    // Code from a skill, which may have come from anywhere: the user approves each run, whatever the settings say
    alwaysAsk: true,
    summarize: (i) => [`${i.skill}/${i.path}`, ...i.args].join(' '),
    prepare(raw) {
      const r = obj(raw);
      const { skill, path } = skillPath(r);
      if (!path) throw new TranslatedError(() => t('tool.missingPath'));
      if (extOf(path) === 'mjs') throw new TranslatedError(() => t('script.esm', { path }));
      if (extOf(path) !== 'js' && extOf(path) !== 'cjs') throw new TranslatedError(() => t('script.notJs', { path }));
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      return { skill, path, args: strings(r.args), file_ids: strings(r.file_ids).filter((x) => x.trim()).slice(0, MAX_INPUTS) };
    },
    async execute(i, ctx) {
      const s = skillOf(deps, i.skill);
      const list = await deps.files(s.id);
      const main = list.find((f) => pathKey(f.path) === pathKey(i.path));
      if (!main) throw new TranslatedError(() => t('tool.noFile', { skill: s.name, path: i.path }));
      const files: Record<string, string | Uint8Array> = {};
      const sources: string[] = [];
      for (const f of list) {
        const data = await deps.read(s.id, f.path);
        if (data === undefined) continue;
        files[`${SKILL_ROOT}/${f.path}`] = typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer());
        if (typeof data === 'string' && /\.c?js$/i.test(f.path)) sources.push(data);
      }
      for (const ref of i.file_ids) {
        const f = await deps.input(ref);
        if (!f) throw new TranslatedError(() => t('script.noInput', { ref }));
        files[`${WORK}/${f.name}`] = f.text;
      }
      const job: ScriptJob = { main: `${SKILL_ROOT}/${main.path}`, args: i.args, cwd: WORK, files, readOnly: [SKILL_ROOT], libraries: await deps.libraries(sources), libraryNames: deps.libraryNames };
      const r = await deps.run(job, ctx.signal);
      if (r.error) return { content: `${main.path} of the skill "${s.name}" did not finish: ${r.error}`, isError: true, details: { error: r.error } satisfies ScriptDetails };

      const printed: ScriptPrinted = { code: r.code, stdout: clip(r.stdout, r.stdoutChars, STDOUT_CHARS, 'stdout'), stderr: clip(r.stderr, r.stderrChars, STDERR_CHARS, 'stderr', true) };
      const out = [`Ran ${main.path} of the skill "${s.name}": exit code ${r.code}.`, `stdout:\n${printed.stdout || '(nothing)'}`, ...(printed.stderr ? [`stderr:\n${printed.stderr}`] : [])];
      const details: ScriptDetails = { ...printed };
      // What it wrote under the working directory, as working-folder files: text only, within a file's limit
      const wrote = Object.entries(r.written)
        .filter(([p]) => p.startsWith(`${WORK}/`))
        .map(([p, v]) => ({ path: cleanFileName(p.slice(WORK.length + 1), 'txt'), text: asText(v), bytes: typeof v === 'string' ? new TextEncoder().encode(v).length : v.length }));
      if (!wrote.length) out.push(`It wrote no files in ${WORK}.`);
      else {
        const offered = wrote.flatMap((f) => (f.text !== null && f.text.length <= MAX_FILE_CHARS ? [{ ...f, text: f.text }] : [])).slice(0, MAX_SAVED);
        const why = (f: (typeof wrote)[number]) => (f.text === null ? 'binary: the working folder keeps text files' : f.text.length > MAX_FILE_CHARS ? 'too large for a file' : `more than ${MAX_SAVED} files`);
        const left = wrote.filter((f) => !offered.some((o) => o.path === f.path));
        out.push(`It wrote ${wrote.length === 1 ? '1 file' : `${wrote.length} files`} in ${WORK}: ${wrote.map((f) => `${f.path} (${f.bytes} bytes)`).join(', ')}.`);
        if (left.length) out.push(`Not offered for saving: ${left.map((f) => `${f.path} (${why(f)})`).join(', ')}.`);
        if (offered.length) {
          const existing = await deps.existing(offered.map((f) => f.path));
          const chosen = await deps.ask(ctx.toolCallId, offered.map((f) => ({ path: f.path, bytes: f.bytes, replaces: existing.has(f.path) })), printed, ctx.signal);
          if (!chosen?.length) {
            details.declined = true;
            out.push('The user chose not to save them in the working folder.');
          } else {
            const saved = await deps.save(offered.filter((f) => chosen.includes(f.path)).map(({ path, text }) => ({ path, text })), s.name);
            details.saved = saved.flatMap((x) => ('error' in x ? [] : [x.path]));
            const ok = saved.flatMap((x) => ('error' in x ? [] : [`${JSON.stringify(x.path)} (${x.replaced ? 'replaced its text' : 'new'})`]));
            const failed = saved.flatMap((x) => ('error' in x ? [`${JSON.stringify(x.path)}: ${x.error}`] : []));
            const unchosen = offered.filter((f) => !chosen.includes(f.path)).map((f) => JSON.stringify(f.path));
            if (ok.length) out.push(`Saved in the working folder: ${ok.join(', ')}.`);
            if (unchosen.length) out.push(`The user chose not to save: ${unchosen.join(', ')}.`);
            if (failed.length) out.push(`Could not save: ${failed.join('; ')}.`);
          }
        }
      }
      return { content: out.join('\n'), isError: r.code !== 0, details };
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
