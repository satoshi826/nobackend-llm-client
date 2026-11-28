// Settings → Web: searching (on/off, the model's built-in search or Tavily, the route each connection ends up with, the Tavily
// key) and fetching pages (fetch_url on/off, the model that reads pages, the ways the fetch page tries)
import type { ComponentChildren } from 'preact';
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
import { Group, ModelChoice, PermissionRow, Row, ToggleRow } from '../../../components/settings-ui';
import { providerSearchRoute, webSettings } from '../state';
import { t } from '../messages';

/** A row that only tells something (a search route, a fetch route): its mark, a name and what it means */
function InfoRow({ mark, name, desc }: { mark: ComponentChildren; name: string; desc: string }) {
  return (
    <div class="flex items-start gap-3 px-4 py-3">
      <span class="mt-0.5 flex w-4 shrink-0 justify-center text-xs text-muted">{mark}</span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm text-ink">{name}</span>
        <span class="mt-0.5 block text-xs leading-5 text-muted">{desc}</span>
      </span>
    </div>
  );
}

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
      <Group title={t('settings.searchTitle')} footer={t('settings.routesNote')}>
        <ToggleRow checked={w.enabled} onChange={(v) => void webSettings.save({ enabled: v })} label={t('settings.enabled')} hint={t('settings.enabledDesc')}>
          {anyNative && (
            <Row
              label={t('settings.engine')}
              control={
                <Select aria-label={t('settings.engine')} value={w.searchEngine} onChange={(e) => void webSettings.save({ searchEngine: (e.target as HTMLSelectElement).value as 'builtin' | 'tools' })}>
                  <option value="builtin">{t('settings.engineNative')}</option>
                  <option value="tools">Tavily</option>
                </Select>
              }
            />
          )}
          {provs.map((p) => {
            const route = providerSearchRoute(p.id);
            const note = route === 'native' ? getPreset(p.preset).nativeWebSearch?.note : undefined;
            return (
              <InfoRow
                key={p.id}
                mark={<Icon name={route === 'native' ? 'globe' : 'search'} class={cx('size-4', route ? 'text-ink' : 'text-faint')} />}
                name={p.name}
                desc={[route === 'native' ? t('settings.routeNative') : route === 'tools' ? 'Tavily' : t('settings.routeNone'), note].filter(Boolean).join(' — ')}
              />
            );
          })}
          <PermissionRow label={t('settings.tavilyPermission')} tools={['web_search']} />
        </ToggleRow>
        {SERVICE_ORDER.map((id) => {
          const a = accountById(id)!;
          return (
            <AccountRow key={id} id={id} title={a.label} host={a.host} open={open === id} onToggle={() => setOpen(open === id ? '' : id)}>
              <KeyPanel accountId={id} compact />
            </AccountRow>
          );
        })}
      </Group>

      <Group title={t('settings.fetchTitle')} footer={t('settings.readNote')}>
        <ToggleRow
          checked={reads}
          onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, fetch_url: v ? 'ask' : 'deny' } })}
          label={t('settings.readToggle')}
          hint={t('settings.readDesc')}
        >
          <Row label={t('settings.readerModel')} below={<ModelChoice label={t('settings.readerModel')} value={w.readerModel} onChange={(v) => void webSettings.save({ readerModel: v })} />} />
        </ToggleRow>
      </Group>

      <Group title={t('settings.ways')} note={t('settings.waysDesc')} footer={relay ? undefined : t('settings.noRelay')}>
        {ways.map(([name, desc], i) => (
          <InfoRow key={name} mark={i + 1} name={name} desc={desc} />
        ))}
        <Row
          label={t('settings.pageSettings')}
          hint={t('settings.pageSettingsDesc')}
          control={
            <Button variant="outline" onClick={() => (fetchSettingsOpen.value = true)}>
              {t('settings.open')}
            </Button>
          }
        />
      </Group>
    </div>
  );
}
