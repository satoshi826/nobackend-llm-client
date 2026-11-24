// スキルの一覧・編集・取り込み/書き出しと、次の送信に添えるスキル
import { computed, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { Skill } from '../lib/db/schema';
import { parseSkillMd, serializeSkillMd, validateSkill, type SkillDraft } from '../lib/skills/skill';
import { BUILTIN_NAMES, BUILTIN_SKILLS } from '../lib/skills/builtin';
import { saveSettings, settings } from './settings';

/** ユーザー（とモデル）が作ったスキル */
export const skills = signal<Skill[]>([]);
/** 組み込みスキル（オフにしたものも含む） */
export const builtinSkills: Skill[] = BUILTIN_SKILLS.map((b) => ({
  id: `builtin:${b.name}`,
  name: b.name,
  description: b.description,
  body: b.body,
  modelInvocable: true,
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
  allowedTools: b.allowedTools
}));
/** 使えるスキル（オンの組み込み + ユーザーのスキル） */
export const allSkills = computed(() => [...builtinSkills.filter((s) => !settings.value.disabledBuiltinSkills.includes(s.name)), ...skills.value]);
/** モデルが一覧から選べるスキル */
export const modelSkills = computed(() => allSkills.value.filter((s) => s.modelInvocable));
/** 次の送信に添えるスキル（ID） */
export const attachedSkillIds = signal<string[]>([]);
export const attachedSkills = computed(() => attachedSkillIds.value.map((id) => allSkills.value.find((s) => s.id === id)).filter((s): s is Skill => !!s));

export async function setBuiltinEnabled(name: string, on: boolean) {
  const cur = settings.value.disabledBuiltinSkills.filter((n) => n !== name);
  await saveSettings({ disabledBuiltinSkills: on ? cur : [...cur, name] });
}

export async function loadSkills() {
  skills.value = await repo.listSkills();
}

const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);

/**
 * 新規作成（id なし）または更新。名前の重複・内容の不備は例外。
 * by: 'model' は save_skill から作ったとき（新規のときだけ印を付ける）
 */
export async function saveSkill(draft: SkillDraft, id?: string, by?: 'model'): Promise<Skill> {
  const d: SkillDraft = { name: draft.name.trim(), description: draft.description.trim(), body: draft.body, modelInvocable: draft.modelInvocable };
  const err = validateSkill(d);
  if (err) throw new Error(err);
  if (BUILTIN_NAMES.has(d.name)) throw new Error(`「${d.name}」は組み込みスキルの名前なので使えません。`);
  if (skills.value.some((s) => s.name === d.name && s.id !== id)) throw new Error(`「${d.name}」という名前のスキルはすでにあります。`);
  const prev = id ? skills.value.find((s) => s.id === id) : undefined;
  const now = Date.now();
  const createdBy = prev ? prev.createdBy : by;
  const s: Skill = { id: prev?.id ?? repo.newId(), createdAt: prev?.createdAt ?? now, updatedAt: now, ...d, ...(createdBy ? { createdBy } : {}) };
  await repo.putSkill(s);
  skills.value = [...skills.value.filter((x) => x.id !== s.id), s].sort(byName);
  return s;
}

export async function setModelInvocable(id: string, on: boolean) {
  const s = skills.value.find((x) => x.id === id);
  if (s) await saveSkill({ ...s, modelInvocable: on }, id);
}

export async function removeSkill(id: string) {
  await repo.deleteSkill(id);
  skills.value = skills.value.filter((s) => s.id !== id);
  attachedSkillIds.value = attachedSkillIds.value.filter((x) => x !== id);
}

export interface SkillImportResult {
  added: string[];
  updated: string[];
  errors: string[];
}

/** SKILL.md（.md）を取り込む。同じ名前のスキルがあれば内容を置き換える */
export async function importSkillFiles(files: File[]): Promise<SkillImportResult> {
  const res: SkillImportResult = { added: [], updated: [], errors: [] };
  for (const f of files) {
    try {
      if (f.size > 1_000_000) throw new Error('ファイルが大きすぎます。');
      const draft = parseSkillMd(await f.text());
      const existing = skills.value.find((s) => s.name === draft.name.trim());
      await saveSkill(draft, existing?.id);
      (existing ? res.updated : res.added).push(draft.name);
    } catch (e) {
      res.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return res;
}

export function downloadSkill(s: Skill) {
  const blob = new Blob([serializeSkillMd(s)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Claude のスキルはフォルダ名 = スキル名、中身が SKILL.md
  a.download = `${s.name}.SKILL.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function toggleAttachedSkill(id: string) {
  const cur = attachedSkillIds.value;
  attachedSkillIds.value = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}
