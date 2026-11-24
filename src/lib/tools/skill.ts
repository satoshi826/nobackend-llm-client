// load_skill: システムプロンプトの一覧にあるスキルの本文を読み込むツール（ブラウザ内で完結。外部に送らない）
import type { Skill } from '../db/schema';
import { skillBlock } from '../skills/skill';
import type { Tool } from './types';

export const LOAD_SKILL = 'load_skill';

export function makeSkillTool(list: Pick<Skill, 'name' | 'body'>[]): Tool<{ name: string }> {
  const names = list.map((s) => s.name);
  return {
    name: LOAD_SKILL,
    label: 'スキルの読み込み',
    description: 'Load the full instructions of one of the skills listed in the system prompt. Call this before starting a task that matches a skill, then follow the loaded instructions.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', enum: names, description: 'Skill name exactly as listed' } },
      required: ['name']
    },
    risk: 'read',
    summarize: (i) => i.name,
    prepare(raw) {
      const name = (raw as { name?: unknown })?.name;
      if (typeof name !== 'string' || !name.trim()) throw new Error('name（スキル名）がありません。');
      return { name: name.trim().replace(/^\//, '') };
    },
    async execute({ name }) {
      const s = list.find((x) => x.name === name);
      if (!s) return { content: `スキル「${name}」はありません。使えるスキル: ${names.join(', ') || 'なし'}`, isError: true };
      return { content: skillBlock(s), details: { name: s.name, chars: s.body.length } };
    }
  };
}
