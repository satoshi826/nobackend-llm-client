// Settings → ファイル
import { useEffect, useState } from 'preact/hooks';
import { Group, PermissionRow, ToggleRow } from '../../../components/settings-ui';
import { FILE_TOOLS, FILE_TOOLS_DEFAULT, PREVIEW_PAGE } from '../tools';
import { fileSettings, fileUsage } from '../state';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

export function FilesSettings() {
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    void fileUsage().then(setUsage);
  }, []);
  return (
    <div class="space-y-8">
      <Group note={`${t('settings.desc')}${usage ? ` ${t('settings.count', { n: formatNumber(usage.count) })}` : ''}`} footer={t('settings.attachNote')}>
        <ToggleRow
          checked={fileSettings.value.value.fileTools}
          onChange={(v) => void fileSettings.save({ fileTools: v })}
          label={t('settings.toggle')}
          hint={t('settings.toggleDesc', { before: formatNumber(700), after: formatNumber(2000) })}
        >
          <PermissionRow label={t('settings.permission')} tools={FILE_TOOLS} fallback={FILE_TOOLS_DEFAULT} />
          {/* Trying a page runs the model's scripts (in the sandbox): asked like running code, until the user chooses */}
          <PermissionRow label={t('settings.previewPermission')} tools={[PREVIEW_PAGE]} />
        </ToggleRow>
      </Group>
    </div>
  );
}
