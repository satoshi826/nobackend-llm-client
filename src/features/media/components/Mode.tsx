// The parts image mode and video mode share in the input box: the mode chips, the options button with its popover,
// the model button with its list, and the notice when no model can be used
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { Badge, Button, Chip, Icon, Spinner, cx, type IconName } from '../../../components/ui';
import { Switch } from '../../../components/settings-ui';
import { openSettings } from '../../../state/ui';
import { t } from '../messages';

/** A mode's chip below the input box. Its text stays the same; on is shown by the chip's look (and aria-pressed) */
export function ModeChip({ icon, label, on, title, onClick }: { icon: IconName; label: string; on: boolean; title: string; onClick(): void }) {
  return (
    <Chip aria-pressed={on} on={on} aria-label={label} title={title} onClick={onClick}>
      <Icon name={icon} class="size-3.5" />
      <span class="@max-[22rem]:hidden">{label}</span>
    </Chip>
  );
}

/** The options of a mode: a chip that sums them up (and the cost), opening them in a popover over the input box */
export function OptionsChip({ summary, cost, costTitle, label, children }: { summary: string; cost: string; costTitle: string; label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} class="flex min-w-0">
      <Chip on={open} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${[summary, cost].filter(Boolean).join(' ')}`} title={label} class="min-w-0" onClick={() => setOpen(!open)}>
        <Icon name="sliders" class="size-3.5 shrink-0" />
        {summary && <span class="truncate @max-[26rem]:hidden">{summary}</span>}
        <span class="shrink-0 tabular-nums" data-tip={costTitle}>
          {cost}
        </span>
        <Icon name="chevron-down" class={cx('size-3 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
      </Chip>
      {open && (
        // Above the input box, so it covers neither the text nor the chips
        <Popover anchor={document.querySelector<HTMLElement>('[data-composer-box]')} opener={ref.current} onClose={() => setOpen(false)} role="dialog" label={label} class="w-80 px-3! py-1!">
          <div class="divide-y divide-line">{children}</div>
        </Popover>
      )}
    </span>
  );
}

/** One option in the popover: its name on the left, its control on the right (or below, for a wide one) */
export function OptionRow({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ComponentChildren }) {
  return (
    <div class={cx('py-2.5 text-sm', wide ? 'space-y-1.5' : 'flex items-center justify-between gap-3')}>
      <span class="min-w-0">
        <span class="block text-ink">{label}</span>
        {hint && <span class="mt-0.5 block text-xs leading-5 break-words text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

/** An on/off option: the whole row toggles it */
export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label class="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-sm">
      <span class="min-w-0">
        <span class="block text-ink">{label}</span>
        {hint && <span class="mt-0.5 block text-xs leading-5 break-words text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

export interface ModelEntry {
  ref: string;
  name: string;
  /** Provider and price, under the name */
  sub: string;
  relayed?: boolean;
  isDefault?: boolean;
  /** A badge of the model's own (what kind of prompt it takes), with what it means */
  badge?: { label: string; title: string };
}

/**
 * Where a mode's prompts go, bottom right of the input box (where the chat model is): the model's name, opening the
 * list of the models that can be used, by provider
 */
export function ModelButton({
  icon,
  label,
  current,
  note,
  groups,
  loading,
  error,
  retry,
  pick
}: {
  icon: IconName;
  /** What the button chooses ("Image model") */
  label: string;
  current: { ref: string; name: string } | undefined;
  /** Who sees the prompt, in the tooltip */
  note: string;
  groups: { provider: string; models: ModelEntry[] }[];
  loading: boolean;
  error: string;
  retry(): void;
  pick(ref: string): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const name = current?.name ?? (loading ? t('model.loading') : label);
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="group flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted transition duration-200 hover:bg-glass-strong hover:text-ink active:scale-[.97]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${name}`}
        data-tip={note ? `${label}\n${note}` : label}
        onClick={() => setOpen(!open)}
      >
        {loading && !current ? <Spinner class="size-3.5 shrink-0" /> : <Icon name={icon} class="size-3.5 shrink-0" />}
        <span class="max-w-[14rem] truncate">{name}</span>
        <Icon name="chevron-down" class="size-3 shrink-0 text-faint transition-transform duration-200 group-hover:translate-y-px" />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="top-end" label={label} class="w-80">
          {error && (
            <>
              <p class="px-2.5 py-1.5 text-xs text-danger">{t('model.failed', { error })}</p>
              <MenuItem icon={<Icon name="refresh" class="mt-0.5 size-4 shrink-0" />} onSelect={retry}>
                {t('model.retry')}
              </MenuItem>
              {groups.length > 0 && <MenuSeparator />}
            </>
          )}
          {!groups.length && !error && <p class="px-2.5 py-1.5 text-xs text-muted">{t('model.loading')}</p>}
          {groups.map((g, i) => (
            <div key={g.provider} role="group" aria-label={g.provider}>
              {i > 0 && <MenuSeparator />}
              <p class="px-2.5 pt-1.5 pb-1 text-xs text-faint">{g.provider}</p>
              {g.models.map((m) => (
                <MenuItem
                  key={m.ref}
                  checked={m.ref === current?.ref}
                  icon={<Icon name="check" class={cx('mt-0.5 size-4 shrink-0', m.ref !== current?.ref && 'invisible')} />}
                  onSelect={() => {
                    setOpen(false);
                    pick(m.ref);
                  }}
                >
                  <span class="flex flex-wrap items-center gap-1.5">
                    <span class="break-words">{m.name}</span>
                    {m.badge && <Badge title={m.badge.title}>{m.badge.label}</Badge>}
                    {m.isDefault && <Badge>{t('model.default')}</Badge>}
                    {m.relayed && <Badge tone="amber">{t('model.relayed')}</Badge>}
                  </span>
                  <span class="block text-xs text-muted">{m.sub}</span>
                </MenuItem>
              ))}
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Above the text while the mode cannot send: no provider has a key, or no model list could be loaded */
export function ModeNotice({ text, tone = 'warn', action }: { text: string; tone?: 'warn' | 'danger'; action?: 'key' | (() => void) }) {
  return (
    <div class={cx('flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs', tone === 'warn' ? 'text-warn' : 'text-danger')} role="status">
      <span class="min-w-0 flex-1">{text}</span>
      {action === 'key' ? (
        <Button class="text-xs" variant="outline" onClick={() => openSettings('connections')}>
          <Icon name="key" class="size-3.5" />
          {t('setKey')}
        </Button>
      ) : (
        action && (
          <Button class="text-xs" variant="outline" onClick={action}>
            <Icon name="refresh" class="size-3.5" />
            {t('model.retry')}
          </Button>
        )
      )}
    </div>
  );
}
