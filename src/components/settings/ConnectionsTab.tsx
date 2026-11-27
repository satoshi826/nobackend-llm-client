// Settings → 接続とキー: key vault placement, passphrase, LLM providers
import { useState } from 'preact/hooks';
import { currentConv } from '../../state/conversations';
import { vaultState } from '../../state/keys';
import { enabledProviders, hostOfProvider, providerById, providers, setProviderEnabled } from '../../state/models';
import { providerSettingsOf, saveSettings, setProviderSetting, settings } from '../../state/settings';
import { vaultIsolated, VAULT_ORIGIN } from '../../lib/vault/client';
import { getPreset } from '../../lib/providers/registry';
import { KeyPanel, VaultSecurityPanel } from '../KeyPanel';
import { Icon, Select, cx, Checkbox } from '../ui';
import { Section, Toggle } from '../settings-ui';
import { AccountRow } from './AccountRow';
import { t } from './messages';
import { sentences } from '../messages';

/** A provider's key and its provider-specific settings */
function ProviderDetails({ id }: { id: string }) {
  const preset = getPreset(providerById(id)!.preset);
  const values = providerSettingsOf(id, preset.settings);
  return (
    <div class="space-y-3">
      <KeyPanel accountId={id} compact />
      {preset.settings?.map((d) => (
        <Toggle key={d.key} checked={values[d.key]} onChange={(v) => setProviderSetting(id, d.key, v)} title={d.label} desc={d.desc} />
      ))}
    </div>
  );
}

export function ConnectionsTab() {
  const [open, setOpen] = useState<string>(currentConv.value.providerId || (enabledProviders.value[0]?.id ?? ''));
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
          {providers.value.map((p) => {
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
                  <Checkbox class="shrink-0 text-xs" checked={on} onChange={(v) => setProviderEnabled(p.id, v)}>
                    {t('conn.use')}
                  </Checkbox>
                }
              >
                {on ? <ProviderDetails id={p.id} /> : <p class="text-xs text-muted">{sentences(getPreset(p.preset).tagline, t('conn.enableHint'))}</p>}
              </AccountRow>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

