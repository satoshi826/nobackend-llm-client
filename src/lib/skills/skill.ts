// スキル: 名前・説明・指示本文からなる作業手順書（Claude の Agent Skills の SKILL.md と互換）。
// - モデルには名前と説明の一覧だけを見せ、必要なときに load_skill ツールで本文を読ませる（段階的な読み込み）
// - ユーザーが入力欄から指定したスキルは、そのメッセージに本文を添えて送る
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

/** 内容の検証。問題があればメッセージを返す */
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

/** YAML フロントマターのうち、スキルに必要な「キー: 値」（1 行・引用符・| と > のブロック）だけを読む */
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

/** SKILL.md を読む。フロントマターがなければ例外 */
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

// ---- スキルで使えるようになるツール ----

/**
 * この会話で使えるようになったツール。
 * - ユーザーが入力欄で指定したスキル（MessageRecord.skills）
 * - モデルが load_skill で読み込めたスキル
 * のうち、allowedTools を持つもの（組み込みの skill-creator → save_skill など）
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

// ---- モデルに渡す文 ----

/** システムプロンプトの末尾に付けるスキルの一覧（本文は含めない） */
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

/** ユーザーが指定したスキルを、そのメッセージの前に添える */
export function withAttachedSkills(text: string, attached: { name: string; body: string }[]): string {
  if (!attached.length) return text;
  const names = attached.map((s) => s.name).join('、');
  const head = `${attached.map(skillBlock).join('\n\n')}\n\nユーザーが上のスキル（${names}）を指定しました。その指示に従って、次の依頼に対応してください。`;
  return text.trim() ? `${head}\n\n---\n\n${text}` : head;
}
