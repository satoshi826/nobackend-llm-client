// Settings → コードの実行: the sandbox, for chat (the JavaScript tool, "Run" on code blocks) and files (HTML / SVG)
import { saveSettings, settings } from '../../state/settings';
import { Group, PermissionRow, ToggleRow } from '../../components/settings-ui';
import { RUN_JAVASCRIPT } from './tool';
import { t } from './messages';

export function SandboxSettings() {
  const s = settings.value;
  return (
    <div class="space-y-8">
      <Group note={t('settings.desc')}>
        <PermissionRow label={t('settings.tool')} tools={[RUN_JAVASCRIPT]} />
        <ToggleRow checked={s.codeRunButtons} onChange={(v) => saveSettings({ codeRunButtons: v })} label={t('settings.runButtons')} hint={t('settings.runButtonsDesc')} />
        <ToggleRow checked={s.htmlFilePreview} onChange={(v) => saveSettings({ htmlFilePreview: v })} label={t('settings.htmlPreview')} hint={t('settings.htmlPreviewDesc')} />
      </Group>
    </div>
  );
}
