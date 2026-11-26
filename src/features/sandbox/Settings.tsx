// Settings → コードの実行: the sandbox, for chat (the JavaScript tool, "Run" on code blocks) and files (HTML / SVG)
import { saveSettings, settings } from '../../state/settings';
import { PermissionSelect, Section, Toggle } from '../../components/settings-ui';
import { RUN_JAVASCRIPT } from './tool';
import { t } from './messages';

export function SandboxSettings() {
  const s = settings.value;
  return (
    <Section>
      <p class="text-xs text-muted">{t('settings.desc')}</p>
      <PermissionSelect
        label={t('settings.tool')}
        value={s.toolPermissions[RUN_JAVASCRIPT] ?? 'ask'}
        onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, [RUN_JAVASCRIPT]: v } })}
      />
      <Toggle checked={s.codeRunButtons} onChange={(v) => saveSettings({ codeRunButtons: v })} title={t('settings.runButtons')} desc={t('settings.runButtonsDesc')} />
      <Toggle checked={s.htmlFilePreview} onChange={(v) => saveSettings({ htmlFilePreview: v })} title={t('settings.htmlPreview')} desc={t('settings.htmlPreviewDesc')} />
    </Section>
  );
}
