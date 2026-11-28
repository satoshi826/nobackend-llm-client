// Skills: work instructions made of a name, a description and a body (compatible with SKILL.md of Claude's Agent Skills),
// with the files of their folder beside them (files.ts).
// - the model sees only the list of names and descriptions, and reads the body with the load_skill tool when needed (progressive loading)
// - skills the user picks in the input box are sent with their body attached to that message
import type { MessageRecord, Skill } from '../db/schema';
import { formatNumber } from '../i18n';
import { t } from './messages';

export type { Skill } from '../db/schema';

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const BODY_MAX = 200_000;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  modelInvocable: boolean;
  /** Front matter of a SKILL.md the app does not use (license, allowed-tools, metadata, ...), as written */
  frontmatter?: string;
}

/** Longest front matter kept beside the keys the app reads */
export const FRONTMATTER_MAX = 10_000;

/** Validate the content. Returns a message if there is a problem */
export function validateSkill(s: SkillDraft): string | null {
  if (!s.name) return t('validate.nameRequired');
  if (s.name.length > NAME_MAX || !NAME_RE.test(s.name)) return t('validate.nameFormat', { max: NAME_MAX });
  if (!s.description.trim()) return t('validate.descriptionRequired');
  if (s.description.length > DESCRIPTION_MAX) return t('validate.descriptionTooLong', { max: formatNumber(DESCRIPTION_MAX) });
  if (!s.body.trim()) return t('validate.bodyRequired');
  if (s.body.length > BODY_MAX) return t('validate.bodyTooLong', { max: formatNumber(BODY_MAX) });
  return null;
}

// ---- SKILL.md ----

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** The keys the app reads from front matter; every other key is kept as written (SkillDraft.frontmatter) */
const KNOWN_KEYS = new Set(['name', 'description', 'disable-model-invocation']);

/**
 * Front matter: the values of the keys the app reads (single line, quoted, | and > blocks), and the lines of every other
 * key as they are (with what is nested under it), so nothing in them can break reading or be lost
 */
function parseFrontmatter(src: string): { values: Record<string, string>; rest: string } {
  const values: Record<string, string> = {};
  const rest: string[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    // Lines under a key: indented, blank, or a list at the key's own indent
    const nested: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '' || lines[i + 1].startsWith('- '))) nested.push(lines[++i]);
    if (!m) continue;
    const [, key, raw] = m;
    if (!KNOWN_KEYS.has(key)) {
      rest.push(lines[i - nested.length], ...nested);
      continue;
    }
    const block = /^([|>])[-+]?\s*$/.exec(raw);
    if (block) {
      const body = nested.map((l) => l.trim());
      while (body.length && !body[body.length - 1]) body.pop();
      values[key] = block[1] === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      values[key] = unquote(raw);
    }
  }
  while (rest.length && !rest[rest.length - 1].trim()) rest.pop();
  return { values, rest: rest.join('\n') };
}

/** Parse a SKILL.md. Throws if there is no front matter */
export function parseSkillMd(text: string): SkillDraft {
  const src = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(src);
  if (!m) throw new Error(t('parse.noFrontmatter'));
  const { values: fm, rest } = parseFrontmatter(m[1]);
  return {
    name: (fm.name ?? '').trim(),
    description: (fm.description ?? '').trim(),
    body: m[2].replace(/^\s*\n/, '').trimEnd(),
    modelInvocable: !/^(true|yes)$/i.test(fm['disable-model-invocation'] ?? ''),
    // Longer than any real one: left out whole (cut, it would no longer be YAML)
    ...(rest && rest.length <= FRONTMATTER_MAX ? { frontmatter: rest } : {})
  };
}

export function serializeSkillMd(s: SkillDraft): string {
  const lines = ['---', `name: ${s.name}`, `description: ${JSON.stringify(s.description)}`];
  if (!s.modelInvocable) lines.push('disable-model-invocation: true');
  if (s.frontmatter) lines.push(s.frontmatter);
  lines.push('---', '', s.body.trimEnd(), '');
  return lines.join('\n');
}

// ---- Tools that skills make available ----

/** Skills loaded in this conversation: picked in the input box (MessageRecord.skills), or loaded by the model with load_skill */
export function loadedSkills(messages: MessageRecord[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role === 'user') for (const s of m.skills ?? []) out.add(s.name);
    for (const p of m.parts) {
      const name = p.type === 'tool' && p.name === 'load_skill' && p.state === 'output-available' ? (p.input as { name?: unknown } | undefined)?.name : undefined;
      if (typeof name === 'string') out.add(name);
    }
  }
  return out;
}

/** Tools that became available in this conversation: those of its loaded skills that have allowedTools (e.g. built-in skill-creator → save_skill) */
export function unlockedTools(messages: MessageRecord[], list: Pick<Skill, 'name' | 'allowedTools'>[]): Set<string> {
  const loaded = loadedSkills(messages);
  return new Set(list.flatMap((s) => (loaded.has(s.name) ? (s.allowedTools ?? []) : [])));
}

// ---- Text passed to the model ----

/** Skill list appended to the end of the system prompt (without bodies) */
export function skillCatalog(list: Pick<Skill, 'name' | 'description'>[]): string {
  if (!list.length) return '';
  return [
    '## Skills',
    'These skills are step-by-step guides for tasks. When a request matches one, load its instructions with load_skill before you start, and follow them. If none fits, you do not need one.',
    '',
    ...list.map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, ' ')}`)
  ].join('\n');
}

export function skillBlock(s: { name: string; body: string }): string {
  return `<skill name="${s.name}">\n${s.body.trim()}\n</skill>`;
}

/** Prepend the skills the user picked to that message */
export function withAttachedSkills(text: string, attached: { name: string; body: string }[]): string {
  if (!attached.length) return text;
  const names = attached.map((s) => s.name).join(', ');
  const head = `${attached.map(skillBlock).join('\n\n')}\n\nThe user picked the skills above (${names}). Follow their instructions for the request below.`;
  return text.trim() ? `${head}\n\n---\n\n${text}` : head;
}
