// Building blocks of the settings screen, shared with settings sections that features register
import type { ComponentChildren } from 'preact';
import type { Permission } from '../lib/tools/types';
import { cx } from './ui';

export const selectCls = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';

export const PERM_LABEL: Record<Permission, string> = { ask: '毎回確認する', allow: '確認せずに実行', deny: '使わない' };

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
    <label class={cx('flex items-start gap-2 text-sm', disabled && 'opacity-50')}>
      <input type="checkbox" class="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>
        {title}
        {desc && <span class="block text-xs text-zinc-500">{desc}</span>}
      </span>
    </label>
  );
}

/** A "confirm before running" select for one tool */
export function PermissionSelect({ label, value, onChange }: { label: string; value: Permission; onChange(v: Permission): void }) {
  return (
    <label class="flex items-center justify-between gap-3 text-sm">
      {label}
      <select class={selectCls} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as Permission)}>
        {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
          <option key={v} value={v}>
            {PERM_LABEL[v]}
          </option>
        ))}
      </select>
    </label>
  );
}
