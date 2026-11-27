// Settings → 接続とキー: key vault placement, passphrase, and the connections the user added (on or off)
import { useState } from 'preact/hooks';
import { currentConv } from '../../state/conversations';
import { vaultState } from '../../state/keys';
import { connections, enabledProviders, hostOfProvider, providerById, providers, setProviderEnabled } from '../../state/models';
import { providerSettingsOf, saveSettings, setProviderSetting, settings } from '../../state/settings';
import { vaultIsolated, VAULT_ORIGIN } from '../../lib/vault/client';
import { getPreset } from '../../lib/providers/registry';
import { KeyPanel, VaultSecurityPanel } from '../KeyPanel';
import { Badge, Button, Icon, Select, cx } from '../ui';
import { Section, Switch, Toggle } from '../settings-ui';
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
      {preset.settings?.map((d) => (
        <Toggle key={d.key} checked={values[d.key]} onChange={(v) => setProviderSetting(id, d.key, v)} title={d.label} desc={d.desc} />
      ))}
      <p class="text-xs text-muted">{preset.keyOptional ? t('conn.removeKeyless') : t('conn.removeHint')}</p>
    </div>
  );
}

export function ConnectionsTab() {
  const list = connections.value;
  const [open, setOpen] = useState<string>(() => (list.some((p) => p.id === currentConv.value.providerId) ? currentConv.value.providerId : (list[0]?.id ?? '')));
  const [adding, setAdding] = useState(false);
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return (
    <div class="space-y-6">
      <div class={cx('rounded-lg p-3 text-xs leading-5', vaultIsolated ? 'bg-ok-soft text-ok' : 'bg-glass-strong text-ink')}>
        <div class="mb-0.5 flex items-center gap-1 font-semibold">
          <Icon name={vaultIsolated ? 'shield' : 'key'} class="size-3.5" />
          {vaultIsolated ? t('conn.vaultIsolated', { host: new URL(VAULT_ORIGIN).host }) : t('conn.vaultSameOrigin')}
        </div>
        {vaultIsolated ? t('conn.vaultIsolatedText') : t('conn.vaultSameOriginText')}
      </div>
      <Section title={t('conn.passphrase')}>
        <VaultSecurityPanel />
        {vaultState.value.hasPassphrase && (
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              {t('conn.autoLock')}
              <span class="block text-xs text-muted">{t('conn.autoLockHint')}</span>
            </span>
            <Select value={String(settings.value.autoLockMinutes)} onChange={(e) => saveSettings({ autoLockMinutes: Number((e.target as HTMLSelectElement).value) })}>
              {[0, 5, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m ? t('conn.autoLockMinutes', { n: m }) : t('conn.autoLockNever')}
                </option>
              ))}
            </Select>
          </label>
        )}
        <p class="text-xs text-muted">{t('conn.passphraseNote')}</p>
      </Section>
      <Section title={t('conn.providers')}>
        <div class="space-y-2">
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
        </div>
        {list.length === 0 && !adding && <p class="text-xs text-muted">{t('conn.none')}</p>}
        {adding ? (
          <div class="space-y-3 rounded-lg border border-line p-3">
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
        ) : (
          list.length < providers.value.length && (
            <Button variant="outline" class="w-full justify-start" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              {t('conn.add')}
            </Button>
          )
        )}
      </Section>
    </div>
  );
}

