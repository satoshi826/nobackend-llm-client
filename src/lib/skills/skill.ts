// Skills: work instructions made of a name, a description and a body (compatible with SKILL.md of Claude's Agent Skills).
// - the model sees only the list of names and descriptions, and reads the body with the load_skill tool when needed (progressive loading)
// - skills the user picks in the input box are sent with their body attached to that message
import type { MessageRecord, Skill } from '../db/schema';

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
}

/** Validate the content. Returns a message if there is a problem */
export function validateSkill(s: SkillDraft): string | null {
  if (!s.name) return '名前を入れてください。';
  if (s.name.length > NAME_MAX || !NAME_RE.test(s.name)) return `名前は半角の小文字・数字・ハイフンで、${NAME_MAX} 文字以内にしてください（例: code-review）。`;
  if (!s.description.trim()) return '説明を入れてください。モデルはこの説明を見て、使うかどうかを決めます。';
  if (s.description.length > DESCRIPTION_MAX) return `説明は ${DESCRIPTION_MAX} 文字以内にしてください。`;
  if (!s.body.trim()) return '指示の本文を入れてください。';
  if (s.body.length > BODY_MAX) return `本文が長すぎます（${BODY_MAX.toLocaleString()} 文字まで）。`;
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

/** Reads only the "key: value" pairs a skill needs from YAML front matter (single line, quoted, | and > blocks) */
function parseFrontmatter(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, key, raw] = m;
    const block = /^([|>])[-+]?\s*$/.exec(raw);
    if (block) {
      const body: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) body.push(lines[++i].trim());
      while (body.length && !body[body.length - 1]) body.pop();
      out[key] = block[1] === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      out[key] = unquote(raw);
    }
  }
  return out;
}

/** Parse a SKILL.md. Throws if there is no front matter */
export function parseSkillMd(text: string): SkillDraft {
  const src = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(src);
  if (!m) throw new Error('先頭に「---」で囲んだ name と description がありません（SKILL.md の形式）。');
  const fm = parseFrontmatter(m[1]);
  return {
    name: (fm.name ?? '').trim(),
    description: (fm.description ?? '').trim(),
    body: m[2].replace(/^\s*\n/, '').trimEnd(),
    modelInvocable: !/^(true|yes)$/i.test(fm['disable-model-invocation'] ?? '')
  };
}

export function serializeSkillMd(s: SkillDraft): string {
  const lines = ['---', `name: ${s.name}`, `description: ${JSON.stringify(s.description)}`];
  if (!s.modelInvocable) lines.push('disable-model-invocation: true');
  lines.push('---', '', s.body.trimEnd(), '');
  return lines.join('\n');
}

// ---- Tools that skills make available ----

/**
 * Tools that became available in this conversation:
 * - from skills the user picked in the input box (MessageRecord.skills)
 * - from skills the model loaded with load_skill
 * whichever of those have allowedTools (e.g. built-in skill-creator → save_skill)
 */
export function unlockedTools(messages: MessageRecord[], list: Pick<Skill, 'name' | 'allowedTools'>[]): Set<string> {
  const out = new Set<string>();
  const add = (name: unknown) => {
    for (const t of list.find((s) => s.name === name)?.allowedTools ?? []) out.add(t);
  };
  for (const m of messages) {
    if (m.role === 'user') for (const s of m.skills ?? []) add(s.name);
    for (const p of m.parts) if (p.type === 'tool' && p.name === 'load_skill' && p.state === 'output-available') add((p.input as { name?: unknown } | undefined)?.name);
  }
  return out;
}

// ---- Text passed to the model ----

/** Skill list appended to the end of the system prompt (without bodies) */
export function skillCatalog(list: Pick<Skill, 'name' | 'description'>[]): string {
  if (!list.length) return '';
  return [
    '## スキル',
    '次のスキル（作業の手順書）を使えます。依頼に合うスキルがあれば、取りかかる前に load_skill ツールでその本文を読み込み、指示に従ってください。合うものがなければ使う必要はありません。',
    '',
    ...list.map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, ' ')}`)
  ].join('\n');
}

export function withSkillCatalog(systemPrompt: string, list: Pick<Skill, 'name' | 'description'>[]): string {
  const cat = skillCatalog(list);
  const sys = systemPrompt.trim();
  return cat ? (sys ? `${sys}\n\n${cat}` : cat) : sys;
}

export function skillBlock(s: { name: string; body: string }): string {
  return `<skill name="${s.name}">\n${s.body.trim()}\n</skill>`;
}

/** Prepend the skills the user picked to that message */
export function withAttachedSkills(text: string, attached: { name: string; body: string }[]): string {
  if (!attached.length) return text;
  const names = attached.map((s) => s.name).join('、');
  const head = `${attached.map(skillBlock).join('\n\n')}\n\nユーザーが上のスキル（${names}）を指定しました。その指示に従って、次の依頼に対応してください。`;
  return text.trim() ? `${head}\n\n---\n\n${text}` : head;
}
