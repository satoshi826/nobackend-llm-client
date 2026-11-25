// Built-in skills shipped with the app (read-only; can be turned off in settings).
// allowedTools: tools that become available only in conversations that loaded (or picked) this skill
import { t } from './messages';

export interface BuiltinSkill {
  name: string;
  description: string;
  body: string;
  allowedTools: string[];
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'skill-creator',
    // Getters: the text follows the current language when read
    get description() {
      return t('creator.description');
    },
    get body() {
      return t('creator.body');
    },
    allowedTools: ['save_skill']
  }
];

export const BUILTIN_NAMES = new Set(BUILTIN_SKILLS.map((s) => s.name));
