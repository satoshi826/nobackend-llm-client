// Building blocks of the settings screen, shared with settings sections that features register
import type { ComponentChildren } from 'preact';
import type { Permission } from '../lib/tools/types';
import { Select, cx } from './ui';
import { t } from './messages';

/** Label of a permission choice (call it at render time: the language can change) */
export const permLabel = (p: Permission): string => t(`perm.${p}`);

/** The same labels as an object; the getters translate on every read, never at module load */
export const PERM_LABEL: Record<Permission, string> = {
  get ask() {
    return permLabel('ask');
  },
  get allow() {
    return permLabel('allow');
  },
  get deny() {
    return permLabel('deny');
  }
};

export function Section({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="space-y-3">
      {title && <h3 class="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, title, desc, disabled }: { checked: boolean; onChange(v: boolean): void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <label class={cx('flex cursor-pointer items-start justify-between gap-4 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        {title}
        {desc && <span class="mt-0.5 block text-xs text-muted">{desc}</span>}
      </span>
      <input type="checkbox" role="switch" class="switch mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

/** A "confirm before running" select for one tool */
export function PermissionSelect({ label, value, onChange }: { label: string; value: Permission; onChange(v: Permission): void }) {
  return (
    <label class="flex items-center justify-between gap-3 text-sm">
      {label}
      <Select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as Permission)}>
        {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
          <option key={v} value={v}>
            {permLabel(v)}
          </option>
        ))}
      </Select>
    </label>
  );
}
