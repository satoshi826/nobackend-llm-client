// Settings → Chat → Files
import { useEffect, useState } from 'preact/hooks';
import { fileUsage } from '../../../lib/db/files';
import { saveSettings, settings } from '../../../state/settings';
import { PermissionSelect, Section, Toggle } from '../../../components/settings-ui';
import { FILE_TOOL_NAMES } from '../tools';
import { fileSettings } from '../state';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

export function FilesSettings() {
  const s = settings.value;
  const [usage, setUsage] = useState<{ count: number; chars: number } | null>(null);
  useEffect(() => {
    void fileUsage().then(setUsage);
  }, []);
  // The write tools share one setting; read_file follows it
  const perm = s.toolPermissions.create_file ?? 'allow';
  return (
    <Section title={t('files')}>
      <p class="text-xs text-muted">
        {t('settings.desc')}
        {usage ? ` ${t('settings.count', { n: formatNumber(usage.count) })}` : ''}
      </p>
      <Toggle
        checked={fileSettings.value.value.fileTools}
        onChange={(v) => void fileSettings.save({ fileTools: v })}
        title={t('settings.toggle')}
        desc={t('settings.toggleDesc', { tokens: formatNumber(600) })}
      />
      {fileSettings.value.value.fileTools && (
        <PermissionSelect
          label={t('settings.permission')}
          value={perm}
          onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, ...Object.fromEntries(FILE_TOOL_NAMES.map((n) => [n, v])) } })}
        />
      )}
    </Section>
  );
}
