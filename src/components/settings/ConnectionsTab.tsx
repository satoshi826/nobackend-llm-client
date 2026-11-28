// Settings → 接続とキー: key vault placement, passphrase, and the connections the user added (on or off)
import { useState } from 'preact/hooks';
import { currentConv } from '../../state/conversations';
import { vaultState } from '../../state/keys';
import { connections, enabledProviders, hostOfProvider, providerById, providers, setProviderEnabled } from '../../state/models';
import { providerSettingsOf, saveSettings, setProviderSetting, settings } from '../../state/settings';
import { vaultIsolated, VAULT_ORIGIN } from '../../lib/vault/client';
import { getPreset } from '../../lib/providers/registry';
import { accountById } from '../../lib/keys/accounts';
import { KeyPanel, VaultSecurityPanel } from '../KeyPanel';
import { Badge, Button, Icon, Select, cx } from '../ui';
import { Group, Row, Switch, ToggleRow } from '../settings-ui';
import { AccountRow } from './AccountRow';
import { AddConnection } from '../AddConnection';
import { connectionFeatures, textOf } from '../extensions';
import { t } from './messages';

/** A connection's key, what it offers, and its own settings */
function ConnectionDetails({ id }: { id: string }) {
  const preset = getPreset(providerById(id)!.preset);
  const values = providerSettingsOf(id, preset.settings);
  const offers = [t('conn.chat'), ...connectionFeatures.filter((f) => f.offeredBy(id)).map((f) => textOf(f.label))];
  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span>{t('conn.offers')}</span>
        {offers.map((o) => (
          <Badge key={o}>{o}</Badge>
        ))}
      </div>
      <KeyPanel accountId={id} compact />
      {!!preset.settings?.length && (
        <div class="divide-y divide-line rounded-xl bg-sunken [&>div]:px-3">
          {preset.settings.map((d) => (
            <ToggleRow key={d.key} checked={values[d.key]} onChange={(v) => setProviderSetting(id, d.key, v)} label={d.label} hint={d.desc} />
          ))}
        </div>
      )}
      <p class="text-xs text-muted">{accountById(id)?.keyOptional ? t('conn.removeKeyless') : t('conn.removeHint')}</p>
    </div>
  );
}

export function ConnectionsTab() {
  const list = connections.value;
  const [open, setOpen] = useState<string>(() => (list.some((p) => p.id === currentConv.value.providerId) ? currentConv.value.providerId : (list[0]?.id ?? '')));
  const [adding, setAdding] = useState(false);
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return (
    <div class="space-y-8">
      <div class={cx('rounded-2xl p-4 text-xs leading-5', vaultIsolated ? 'bg-ok-soft text-ok' : 'bg-glass-strong text-ink')}>
        <div class="mb-0.5 flex items-center gap-1 font-semibold">
          <Icon name={vaultIsolated ? 'shield' : 'key'} class="size-3.5" />
          {vaultIsolated ? t('conn.vaultIsolated', { host: new URL(VAULT_ORIGIN).host }) : t('conn.vaultSameOrigin')}
        </div>
        {vaultIsolated ? t('conn.vaultIsolatedText') : t('conn.vaultSameOriginText')}
      </div>
      <Group title={t('conn.passphrase')}>
        <Row below={<VaultSecurityPanel />} />
        {vaultState.value.hasPassphrase && (
          <Row
            label={t('conn.autoLock')}
            hint={t('conn.autoLockHint')}
            control={
              <Select aria-label={t('conn.autoLock')} value={String(settings.value.autoLockMinutes)} onChange={(e) => saveSettings({ autoLockMinutes: Number((e.target as HTMLSelectElement).value) })}>
                {[0, 5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m ? t('conn.autoLockMinutes', { n: m }) : t('conn.autoLockNever')}
                  </option>
                ))}
              </Select>
            }
          />
        )}
      </Group>
      <Group title={t('conn.providers')}>
        {list.map((p) => {
          const on = enabled.has(p.id);
          return (
            <AccountRow
              key={p.id}
              id={p.id}
              title={p.name}
              host={hostOfProvider(p.id)}
              open={open === p.id}
              onToggle={() => setOpen(open === p.id ? '' : p.id)}
              right={
                <Switch checked={on} label={t('conn.onLabel', { name: p.name })} onChange={(v) => void setProviderEnabled(p.id, v)} />
              }
            >
              <ConnectionDetails id={p.id} />
            </AccountRow>
          );
        })}
        {list.length === 0 && !adding && <Row hint={t('conn.none')} />}
        {adding ? (
          <Row
            below={
              <div class="space-y-3">
                <AddConnection
                  onAdded={(id) => {
                    setAdding(false);
                    setOpen(id);
                  }}
                />
                <Button variant="outline" class="text-xs" onClick={() => setAdding(false)}>
                  {t('conn.cancelAdd')}
                </Button>
              </div>
            }
          />
        ) : (
          list.length < providers.value.length && (
            <Row
              below={
                <Button variant="outline" class="w-full justify-start" onClick={() => setAdding(true)}>
                  <Icon name="plus" />
                  {t('conn.add')}
                </Button>
              }
            />
          )
        )}
      </Group>
    </div>
  );
}

