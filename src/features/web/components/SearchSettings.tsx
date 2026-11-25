// Settings → Web 検索: search method, tool permissions, service keys
import { useState } from 'preact/hooks';
import { saveSettings, settings } from '../../../state/settings';
import { accountById } from '../../../lib/keys/accounts';
import { SERVICE_ORDER } from '../../../lib/tools/services';
import { PRESETS } from '../../../lib/providers/registry';
import type { Permission } from '../../../lib/tools/types';
import { KeyPanel } from '../../../components/KeyPanel';
import { AccountRow } from '../../../components/settings/AccountRow';
import { PERM_LABEL, Section, selectCls } from '../../../components/settings-ui';
import { webSettings } from '../state';
import { t } from '../messages';
import { formatList } from '../../../lib/i18n';

export function SearchSettings() {
  const s = settings.value;
  const builtin = Object.values(PRESETS).filter((p) => p.features?.builtInWebSearch);
  const [open, setOpen] = useState('');
  return (
    <div class="space-y-6">
      <Section>
        <p class="text-xs text-muted">{t('settings.desc')}</p>
        {builtin.length > 0 && (
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              {t('settings.engine')}
              <span class="block text-xs text-muted">{formatList(builtin.map((p) => p.label))}</span>
            </span>
            <select class={selectCls} value={webSettings.value.value.searchEngine} onChange={(e) => void webSettings.save({ searchEngine: (e.target as HTMLSelectElement).value as 'builtin' | 'tools' })}>
              <option value="builtin">{t('settings.builtin')}</option>
              <option value="tools">{t('settings.tools')}</option>
            </select>
          </label>
        )}
      </Section>
      <Section title={t('settings.runTitle')}>
        {(['web_search', 'fetch_url'] as const).map((name) => (
          <label key={name} class="flex items-center justify-between gap-3 text-sm">
            <span>
              {name === 'web_search' ? t('webSearch') : t('fetchPage')}
              <span class="block text-xs text-muted">{name === 'web_search' ? t('settings.searchSends') : t('settings.fetchSends')}</span>
            </span>
            <select class={selectCls} value={s.toolPermissions[name] ?? 'ask'} onChange={(e) => saveSettings({ toolPermissions: { ...s.toolPermissions, [name]: (e.target as HTMLSelectElement).value as Permission } })}>
              {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
                <option key={v} value={v}>
                  {PERM_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </Section>
      <Section title={t('settings.keysTitle')}>
        <div class="space-y-2">
          {SERVICE_ORDER.map((id) => {
            const a = accountById(id)!;
            return (
              <AccountRow key={id} id={id} title={a.label} host={a.host} open={open === id} onToggle={() => setOpen(open === id ? '' : id)}>
                <KeyPanel accountId={id} compact />
              </AccountRow>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

