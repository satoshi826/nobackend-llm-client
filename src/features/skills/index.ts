// Skills feature (SKILL.md-compatible instructions with the files of their folder; load_skill, read_skill_file,
// run_skill_script, save_skill via skill-creator).
// Importing this module registers it with the core through extension points.
import { registerComposerAddon, registerSettingsTab, registerToolView, registerUserMessageExtra } from '../../components/extensions';
import { registerMessageTransform } from '../../lib/chat/request';
import { skillsTransform } from './transform';
import { SkillButton, SkillsAbove, UserSkills, skillKeys } from './components/Composer';
import { SkillApproval } from './components/SkillApproval';
import { lazyComponent } from '../../components/lazy';
import { attachedSkills, takeAttachedSkills } from './state';
import { LOAD_SKILL, READ_SKILL_FILE, RUN_SKILL_SCRIPT, SAVE_SKILL, type ScriptDetails } from './tools';
import { ScriptRun } from './components/ScriptRun';
import { t } from './messages';

export { allSkills } from './state';
export { RUN_SKILL_SCRIPT } from './tools';

registerComposerAddon({
  id: 'skills',
  Button: SkillButton,
  Above: SkillsAbove,
  onKeyDown: skillKeys,
  hasContent: () => attachedSkills.value.length > 0,
  collect: async () => ({ skills: takeAttachedSkills() })
});
registerUserMessageExtra(UserSkills);
registerToolView({
  names: [LOAD_SKILL],
  label: () => t('skill'),
  icon: 'book',
  editableField: { key: 'name', label: () => t('nameField') },
  doneStatus: () => t('tool.loaded')
});
registerToolView({
  names: [READ_SKILL_FILE],
  label: () => t('tool.readFile'),
  icon: 'book',
  summary: (p) => {
    const i = (p.input ?? {}) as { skill?: string; path?: string };
    return i.skill && i.path !== undefined ? `${i.skill}/${i.path || '.'}` : undefined;
  },
  doneStatus: () => t('tool.loaded')
});
registerToolView({
  names: [RUN_SKILL_SCRIPT],
  label: () => t('tool.runScript'),
  icon: 'code',
  summary: (p) => {
    const i = (p.input ?? {}) as { skill?: string; path?: string; args?: string[] };
    return i.skill && i.path ? [`${i.skill}/${i.path}`, ...(i.args ?? [])].join(' ') : undefined;
  },
  approvalNote: (p) => {
    const i = (p.input ?? {}) as { skill?: string; path?: string };
    return t('script.approvalNote', { skill: i.skill ?? '', path: i.path ?? '' });
  },
  doneStatus: (p) => {
    const code = (p.uiDetails as ScriptDetails | undefined)?.code;
    return code ? t('script.exit', { code }) : undefined;
  },
  Detail: ScriptRun
});
registerToolView({
  names: [SAVE_SKILL],
  label: () => t('tool.save'),
  icon: 'book',
  summary: (p) => (p.input as { name?: string } | undefined)?.name,
  doneStatus: (p) => ((p.uiDetails as { updated?: boolean } | undefined)?.updated ? t('tool.updated') : t('tool.created')),
  Approval: SkillApproval
});
registerSettingsTab({ id: 'skills', label: () => t('tabLabel'), icon: 'book', Component: lazyComponent(() => import('./components/SkillsTab').then((m) => m.SkillsTab)) });

registerMessageTransform(skillsTransform);
