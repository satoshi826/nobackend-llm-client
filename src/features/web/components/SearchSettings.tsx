// Settings → Web: searching (on/off, the model's built-in search or Tavily, the route each connection ends up with, the Tavily
// key) and fetching pages (fetch_url on/off, the model that reads pages, the ways the fetch page tries)
import { useState } from 'preact/hooks';
import { saveSettings, settings } from '../../../state/settings';
import { enabledProviders } from '../../../state/models';
import { accountById } from '../../../lib/keys/accounts';
import { SERVICE_ORDER } from '../../../lib/tools/services';
import { getPreset } from '../../../lib/providers/registry';
import { FETCH_ROUTES } from '../../../lib/fetcher/config';
import { fetchSettingsOpen } from '../../../state/fetch-page';
import { KeyPanel } from '../../../components/KeyPanel';
import { AccountRow } from '../../../components/settings/AccountRow';
import { Button, Icon, Select, cx } from '../../../components/ui';
import { ModelSelect, PermissionSelect, Section, Toggle } from '../../../components/settings-ui';
import { providerSearchRoute, webSettings } from '../state';
import { t } from '../messages';

const listClass = 'divide-y divide-line rounded-xl border border-line bg-glass';

export function SearchSettings() {
  const s = settings.value;
  const w = webSettings.value.value;
  const [open, setOpen] = useState('');
  const provs = enabledProviders.value;
  const anyNative = provs.some((p) => getPreset(p.preset).nativeWebSearch);
  const reads = s.toolPermissions.fetch_url !== 'deny';
  const relay = FETCH_ROUTES.relay && new URL(FETCH_ROUTES.relay).host;
  const ways = [
    [t('settings.viaDirect'), t('settings.viaDirectDesc')],
    ...(relay ? [[t('settings.viaRelay'), t('settings.viaRelayDesc', { host: relay })]] : []),
    [t('settings.viaJina'), t('settings.viaJinaDesc', { host: new URL(FETCH_ROUTES.jina).host })]
  ];
  return (
    <div class="space-y-8">
      <Section title={t('settings.searchTitle')}>
        <Toggle checked={w.enabled} onChange={(v) => void webSettings.save({ enabled: v })} title={t('settings.enabled')} desc={t('settings.enabledDesc')} />
        <div class={cx('space-y-3', !w.enabled && 'pointer-events-none opacity-50')} aria-disabled={!w.enabled}>
          {anyNative && (
            <label class="flex items-center justify-between gap-3 text-sm">
              {t('settings.engine')}
              <Select value={w.searchEngine} onChange={(e) => void webSettings.save({ searchEngine: (e.target as HTMLSelectElement).value as 'builtin' | 'tools' })}>
                <option value="builtin">{t('settings.engineNative')}</option>
                <option value="tools">Tavily</option>
              </Select>
            </label>
          )}
          {provs.length > 0 && (
            <ul class={listClass}>
              {provs.map((p) => {
                const route = providerSearchRoute(p.id);
                const note = route === 'native' ? getPreset(p.preset).nativeWebSearch?.note : undefined;
                return (
                  <li key={p.id} class="flex items-start gap-3 px-3 py-2.5 text-sm">
                    <Icon name={route === 'native' ? 'globe' : 'search'} class={cx('mt-0.5 size-4 shrink-0', route ? 'text-ink' : 'text-faint')} />
                    <span class="min-w-0 flex-1">
                      <span class="font-medium text-ink-strong">{p.name}</span>
                      <span class="block text-xs text-muted">
                        {[route === 'native' ? t('settings.routeNative') : route === 'tools' ? 'Tavily' : t('settings.routeNone'), note].filter(Boolean).join(' — ')}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p class="text-xs text-muted">{t('settings.routesNote')}</p>
          <PermissionSelect label={t('settings.tavilyPermission')} tools={['web_search']} />
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
      <Section title={t('settings.fetchTitle')}>
        <Toggle
          checked={reads}
          onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, fetch_url: v ? 'ask' : 'deny' } })}
          title={t('settings.readToggle')}
          desc={t('settings.readDesc')}
        />
        <ModelSelect label={t('settings.readerModel')} disabled={!reads} value={w.readerModel} onChange={(v) => void webSettings.save({ readerModel: v })} />
        <div class="space-y-2">
          <p class="text-sm">{t('settings.ways')}</p>
          <p class="text-xs text-muted">{t('settings.waysDesc')}</p>
          <ol class={listClass}>
            {ways.map(([name, desc], i) => (
              <li key={name} class="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span class="mt-0.5 w-4 shrink-0 text-center text-xs text-muted">{i + 1}</span>
                <span class="min-w-0 flex-1">
                  <span class="font-medium text-ink-strong">{name}</span>
                  <span class="block text-xs text-muted">{desc}</span>
                </span>
              </li>
            ))}
          </ol>
          {!relay && <p class="text-xs text-muted">{t('settings.noRelay')}</p>}
        </div>
        <div class="flex items-center justify-between gap-4 text-sm">
          <span>
            {t('settings.pageSettings')}
            <span class="mt-0.5 block text-xs text-muted">{t('settings.pageSettingsDesc')}</span>
          </span>
          <Button variant="outline" onClick={() => (fetchSettingsOpen.value = true)}>
            {t('settings.open')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
