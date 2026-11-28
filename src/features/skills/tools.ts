// The skill tools: load_skill loads the body of a skill listed in the system prompt, save_skill creates or fixes one.
// Both run entirely in the browser; nothing is sent out
import type { Skill } from '../../lib/db/schema';
import { skillBlock, validateSkill, type SkillDraft } from '../../lib/skills/skill';
import type { Tool } from '../../lib/tools/types';
import { t } from './messages';
import { TranslatedError } from '../../lib/i18n';

export const LOAD_SKILL = 'load_skill';

export function makeSkillTool(list: Pick<Skill, 'name' | 'body'>[]): Tool<{ name: string }> {
  const names = list.map((s) => s.name);
  return {
    name: LOAD_SKILL,
    label: t('tool.load'),
    description: 'Load the full instructions of a skill listed under "Skills" in the system prompt. Call it before starting a task that matches the skill, then follow the loaded instructions.',
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
      return { content: skillBlock(s), details: { name: s.name, chars: s.body.length } };
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
