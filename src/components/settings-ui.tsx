// Building blocks of the settings screen, shared with the settings tabs that features register
import type { ComponentChildren } from 'preact';
import type { Permission } from '../lib/tools/types';
import { keyStatus } from '../state/keys';
import { modelKey, providerById, visibleModels } from '../state/models';
import { saveSettings, settings } from '../state/settings';
import { Collapse, SearchChoice, Select, cx, type Choice } from './ui';
import { t } from './messages';
import { formatUsd } from '../lib/i18n';

/** Label of a permission choice (call it at render time: the language can change) */
const permLabel = (p: Permission): string => t(`perm.${p}`);

// ---- Grouped lists: each group of settings is one card, its rows divided by lines ----

/**
 * A group of settings: its heading and a short note above, the rows in one card (divided by lines), and a footnote
 * below. Groups are kept well apart, so where one ends is seen before anything is read
 */
export function Group({ title, note, footer, children }: { title?: string; note?: ComponentChildren; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section>
      {title && <h3 class="px-1 text-sm font-semibold text-ink-strong">{title}</h3>}
      {note && <p class="mt-1 px-1 text-xs leading-5 text-muted">{note}</p>}
      <div class="mt-2.5 divide-y divide-line rounded-2xl border border-line bg-glass">{children}</div>
      {footer && <p class="mt-2 px-1 text-xs leading-5 text-muted">{footer}</p>}
    </section>
  );
}

/**
 * One setting in a group: its name (and a one-line hint) on the left, its control on the right, or on a line of its own
 * at the right when the row is too narrow for both (a phone, a recessed row); a control too wide for that (a model
 * choice, a text, a picker) goes `below`, the row's full width. A row of only `below` holds a control that names
 * itself (a slider with its label, a set of swatches under the group's heading)
 */
export function Row({ label, hint, control, below, disabled }: { label?: string; hint?: string; control?: ComponentChildren; below?: ComponentChildren; disabled?: boolean }) {
  return (
    <div class={cx('px-4 py-3', disabled && 'opacity-50')}>
      {(label || hint || control) && (
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div class="min-w-0 flex-[1_1_8rem]">
            {label && <div class="text-sm text-ink">{label}</div>}
            {hint && <div class="mt-0.5 text-xs leading-5 text-muted">{hint}</div>}
          </div>
          {control && <div class="ml-auto shrink-0">{control}</div>}
        </div>
      )}
      {below && <div class={label || hint || control ? 'mt-2.5' : undefined}>{below}</div>}
    </div>
  );
}

/**
 * A setting turned on or off, in a group. What only matters while it is on (children) opens under it, recessed, and
 * is not shown while it is off
 */
export function ToggleRow({ checked, onChange, label, hint, children }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string; children?: ComponentChildren }) {
  return (
    <div class="px-4 py-3">
      <label class="flex cursor-pointer items-start justify-between gap-4">
        <span class="min-w-0">
          <span class="block text-sm text-ink">{label}</span>
          {hint && <span class="mt-0.5 block text-xs leading-5 text-muted">{hint}</span>}
        </span>
        <Switch class="mt-0.5" checked={checked} onChange={onChange} />
      </label>
      {children && (
        <Collapse open={checked}>
          <div class="mt-3 divide-y divide-line rounded-xl bg-sunken [&>div]:px-3">{children}</div>
        </Collapse>
      )}
    </div>
  );
}

/** An on/off switch on its own; label names it where no visible text does (a switch at the end of a row) */
export function Switch({ checked, onChange, label, disabled, class: className }: { checked: boolean; onChange(v: boolean): void; label?: string; disabled?: boolean; class?: string }) {
  return <input type="checkbox" role="switch" class={cx('switch shrink-0', className)} checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />;
}

/** "Confirm before running" as a row of a group; saved for every tool in tools, read from the first */
export function PermissionRow({ label, hint, tools, fallback = 'ask' }: { label: string; hint?: string; tools: string[]; fallback?: Permission }) {
  const perms = settings.value.toolPermissions;
  const save = (v: Permission) => void saveSettings({ toolPermissions: { ...perms, ...Object.fromEntries(tools.map((n) => [n, v])) } });
  return (
    <Row
      label={label}
      hint={hint}
      control={
        <Select aria-label={label} value={perms[tools[0]] ?? fallback} onChange={(e) => save((e.target as HTMLSelectElement).value as Permission)}>
          {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
            <option key={v} value={v}>
              {permLabel(v)}
            </option>
          ))}
        </Select>
      }
    />
  );
}

/** The models a side job can use (value "providerId|modelId"), the conversation's model ('') first */
function modelChoices(): Choice[] {
  return [
    { value: '', label: t('model.same') },
    ...visibleModels.value
      .filter((m) => keyStatus(m.providerId).present)
      .map((m) => {
        const provider = providerById(m.providerId)?.name ?? m.providerId;
        const price = m.pricing?.inputPerMTok;
        return { value: modelKey(m.providerId, m.id), label: m.name, sub: price != null ? t('model.subPriced', { provider, price: formatUsd(price) }) : provider };
      })
  ];
}

/** The model of a side job, as a Row's second line (the row names it) */
export function ModelChoice({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return <SearchChoice label={label} value={value} choices={modelChoices()} onChange={onChange} />;
}

