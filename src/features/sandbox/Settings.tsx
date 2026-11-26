// Settings → チャット → コードの実行: whether models may run JavaScript, and the "Run" buttons on code blocks
import { saveSettings, settings } from '../../state/settings';
import { PermissionSelect, Section, Toggle } from '../../components/settings-ui';
import { RUN_JAVASCRIPT } from './tool';
import { t } from './messages';

export function SandboxSettings() {
  const s = settings.value;
  return (
    <Section title={t('settings.title')}>
      <p class="text-xs text-muted">{t('settings.desc')}</p>
      <PermissionSelect
        label={t('settings.tool')}
        value={s.toolPermissions[RUN_JAVASCRIPT] ?? 'ask'}
        onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, [RUN_JAVASCRIPT]: v } })}
      />
      <Toggle checked={s.codeRunButtons} onChange={(v) => saveSettings({ codeRunButtons: v })} title={t('settings.runButtons')} desc={t('settings.runButtonsDesc')} />
    </Section>
  );
}
