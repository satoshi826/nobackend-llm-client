// Building blocks of the settings screen, shared with the settings tabs that features register
import type { ComponentChildren } from 'preact';
import type { Permission } from '../lib/tools/types';
import { keyStatus } from '../state/keys';
import { modelKey, providerById, visibleModels } from '../state/models';
import { saveSettings, settings } from '../state/settings';
import { Select, cx } from './ui';
import { t } from './messages';
import { formatUsd } from '../lib/i18n';

/** Label of a permission choice (call it at render time: the language can change) */
const permLabel = (p: Permission): string => t(`perm.${p}`);

export function Section({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="space-y-3">
      {title && <h3 class="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

/** An on/off switch on its own; label names it where no visible text does (a switch at the end of a row) */
export function Switch({ checked, onChange, label, disabled, class: className }: { checked: boolean; onChange(v: boolean): void; label?: string; disabled?: boolean; class?: string }) {
  return <input type="checkbox" role="switch" class={cx('switch shrink-0', className)} checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />;
}

export function Toggle({ checked, onChange, title, desc, disabled }: { checked: boolean; onChange(v: boolean): void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <label class={cx('flex cursor-pointer items-start justify-between gap-4 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        {title}
        {desc && <span class="mt-0.5 block text-xs text-muted">{desc}</span>}
      </span>
      <Switch class="mt-0.5" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

/** A "confirm before running" select; saved for every tool in tools, read from the first */
export function PermissionSelect({ label, tools, fallback = 'ask' }: { label: string; tools: string[]; fallback?: Permission }) {
  const perms = settings.value.toolPermissions;
  const save = (v: Permission) => void saveSettings({ toolPermissions: { ...perms, ...Object.fromEntries(tools.map((n) => [n, v])) } });
  return (
    <label class="flex items-center justify-between gap-3 text-sm">
      {label}
      <Select value={perms[tools[0]] ?? fallback} onChange={(e) => save((e.target as HTMLSelectElement).value as Permission)}>
        {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
          <option key={v} value={v}>
            {permLabel(v)}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** A model for a side job (value "providerId|modelId"; '' is the conversation's model), from the models with a key */
export function ModelSelect({ label, value, onChange, disabled }: { label: string; value: string; onChange(v: string): void; disabled?: boolean }) {
  return (
    <label class={cx('block text-sm', disabled && 'opacity-50')}>
      {label}
      <Select disabled={disabled} class="mt-1 block w-full" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">{t('model.same')}</option>
        {visibleModels.value
          .filter((m) => keyStatus(m.providerId).present)
          .map((m) => {
            const provider = providerById(m.providerId)?.name ?? m.providerId;
            const price = m.pricing?.inputPerMTok;
            return (
              <option key={modelKey(m.providerId, m.id)} value={modelKey(m.providerId, m.id)}>
                {price != null ? t('model.optionPriced', { provider, model: m.name, price: formatUsd(price) }) : `${provider} / ${m.name}`}
              </option>
            );
          })}
      </Select>
    </label>
  );
}
