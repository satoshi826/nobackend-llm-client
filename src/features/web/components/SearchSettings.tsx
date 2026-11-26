// Settings → Web 検索: on/off, the route per connection, Tavily instead of native search, tool permissions, service keys
import { useState } from 'preact/hooks';
import { saveSettings, settings } from '../../../state/settings';
import { enabledProviders } from '../../../state/models';
import { accountById } from '../../../lib/keys/accounts';
import { SERVICE_ORDER } from '../../../lib/tools/services';
import { getPreset } from '../../../lib/providers/registry';
import type { Permission } from '../../../lib/tools/types';
import { KeyPanel } from '../../../components/KeyPanel';
import { AccountRow } from '../../../components/settings/AccountRow';
import { Icon, Select, cx } from '../../../components/ui';
import { PERM_LABEL, Section, Toggle, } from '../../../components/settings-ui';
import { webSettings } from '../state';
import { t } from '../messages';

export function SearchSettings() {
  const s = settings.value;
  const w = webSettings.value.value;
  const [open, setOpen] = useState('');
  const provs = enabledProviders.value;
  return (
    <div class="space-y-6">
      <Section>
        <Toggle checked={w.enabled} onChange={(v) => void webSettings.save({ enabled: v })} title={t('settings.enabled')} desc={t('settings.enabledDesc')} />
      </Section>
      <div class={cx('space-y-6', !w.enabled && 'pointer-events-none opacity-50')} aria-disabled={!w.enabled}>
        {provs.length > 0 && (
          <Section title={t('settings.routesTitle')}>
            <ul class="divide-y divide-line rounded-xl border border-line bg-glass">
              {provs.map((p) => {
                const native = getPreset(p.preset).nativeWebSearch;
                return (
                  <li key={p.id} class="flex items-start gap-3 px-3 py-2.5 text-sm">
                    <Icon name={native ? 'globe' : 'search'} class={cx('mt-0.5 size-4 shrink-0', native ? 'text-ink' : 'text-faint')} />
                    <span class="min-w-0 flex-1">
                      <span class="font-medium text-ink-strong">{p.name}</span>
                      <span class="block text-xs text-muted">{native ? [t('settings.routeNative'), native.note].filter(Boolean).join(' — ') : t('settings.routeNone')}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <Toggle
              checked={w.searchEngine === 'tools'}
              onChange={(v) => void webSettings.save({ searchEngine: v ? 'tools' : 'builtin' })}
              title={t('settings.preferTools')}
              desc={t('settings.preferToolsDesc')}
            />
          </Section>
        )}
        <Section title={t('settings.fallbackTitle')}>
          <p class="text-xs text-muted">{t('settings.fallbackDesc')}</p>
          {(['web_search', 'fetch_url'] as const).map((name) => (
            <label key={name} class="flex items-center justify-between gap-3 text-sm">
              <span>
                {name === 'web_search' ? t('webSearch') : t('fetchPage')}
                <span class="block text-xs text-muted">{name === 'web_search' ? t('settings.searchSends') : t('settings.fetchSends')}</span>
              </span>
              {/* Fetching a page always asks (the address may carry the conversation); it can only be turned off */}
              <Select value={name === 'fetch_url' && s.toolPermissions[name] !== 'deny' ? 'ask' : (s.toolPermissions[name] ?? 'ask')} onChange={(e) => saveSettings({ toolPermissions: { ...s.toolPermissions, [name]: (e.target as HTMLSelectElement).value as Permission } })}>
                {((name === 'fetch_url' ? ['ask', 'deny'] : ['ask', 'allow', 'deny']) as Permission[]).map((v) => (
                  <option key={v} value={v}>
                    {PERM_LABEL[v]}
                  </option>
                ))}
              </Select>
            </label>
          ))}
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
    </div>
  );
}
