// Settings → Web 検索: searching (on/off, the route per connection, Tavily instead of native search, the Tavily key)
// and reading pages (fetch_url: on/off and the model that reads them)
import { useState } from 'preact/hooks';
import { saveSettings, settings } from '../../../state/settings';
import { enabledProviders, providerById, visibleModels } from '../../../state/models';
import { keyStatus } from '../../../state/keys';
import { accountById } from '../../../lib/keys/accounts';
import { SERVICE_ORDER } from '../../../lib/tools/services';
import { getPreset } from '../../../lib/providers/registry';
import { KeyPanel } from '../../../components/KeyPanel';
import { AccountRow } from '../../../components/settings/AccountRow';
import { Icon, Select, cx } from '../../../components/ui';
import { PermissionSelect, Section, Toggle } from '../../../components/settings-ui';
import { webSettings } from '../state';
import { t } from '../messages';

export function SearchSettings() {
  const s = settings.value;
  const w = webSettings.value.value;
  const [open, setOpen] = useState('');
  const provs = enabledProviders.value;
  const reads = s.toolPermissions.fetch_url !== 'deny';
  const choices = visibleModels.value.filter((m) => keyStatus(m.providerId).present);
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
        <Section title={t('settings.tavilyTitle')}>
          <p class="text-xs text-muted">{t('settings.tavilyDesc')}</p>
          <PermissionSelect
            label={`${t('webSearch')}（${t('settings.searchSends')}）`}
            value={s.toolPermissions.web_search ?? 'ask'}
            onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, web_search: v } })}
          />
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
      <Section title={t('settings.readTitle')}>
        <p class="text-xs text-muted">{t('settings.readDesc')}</p>
        <Toggle checked={reads} onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, fetch_url: v ? 'ask' : 'deny' } })} title={t('settings.readToggle')} />
        <label class={cx('block text-sm', !reads && 'opacity-50')}>
          {t('settings.readerModel')}
          <Select disabled={!reads} class="mt-1 block w-full" value={w.readerModel} onChange={(e) => void webSettings.save({ readerModel: (e.target as HTMLSelectElement).value })}>
            <option value="">{t('settings.sameModel')}</option>
            {choices.map((m) => (
              <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
                {`${providerById(m.providerId)?.name ?? m.providerId} / ${m.name}`}
              </option>
            ))}
          </Select>
        </label>
      </Section>
    </div>
  );
}
