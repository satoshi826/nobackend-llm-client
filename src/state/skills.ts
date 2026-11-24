// スキルの一覧・編集・取り込み/書き出しと、次の送信に添えるスキル
import { computed, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { Skill } from '../lib/db/schema';
import { parseSkillMd, serializeSkillMd, validateSkill, type SkillDraft } from '../lib/skills/skill';

export const skills = signal<Skill[]>([]);
/** モデルが一覧から選べるスキル */
export const modelSkills = computed(() => skills.value.filter((s) => s.modelInvocable));
/** 次の送信に添えるスキル（ID） */
export const attachedSkillIds = signal<string[]>([]);
export const attachedSkills = computed(() => attachedSkillIds.value.map((id) => skills.value.find((s) => s.id === id)).filter((s): s is Skill => !!s));

export async function loadSkills() {
  skills.value = await repo.listSkills();
}

const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);

/** 新規作成（id なし）または更新。名前の重複・内容の不備は例外 */
export async function saveSkill(draft: SkillDraft, id?: string): Promise<Skill> {
  const d: SkillDraft = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
  const err = validateSkill(d);
  if (err) throw new Error(err);
  if (skills.value.some((s) => s.name === d.name && s.id !== id)) throw new Error(`「${d.name}」という名前のスキルはすでにあります。`);
  const prev = id ? skills.value.find((s) => s.id === id) : undefined;
  const now = Date.now();
  const s: Skill = { id: prev?.id ?? repo.newId(), createdAt: prev?.createdAt ?? now, updatedAt: now, ...d };
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
      const existing = skills.value.find((s) => s.name === draft.name);
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
