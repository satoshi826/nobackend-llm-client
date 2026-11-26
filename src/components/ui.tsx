import type { ComponentChildren, ButtonHTMLAttributes, InputHTMLAttributes, RefObject, SelectHTMLAttributes, TextareaHTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from './dialog';
import { t } from './messages';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

export type IconName =
  | 'menu' | 'plus' | 'settings' | 'send' | 'stop' | 'copy' | 'refresh' | 'edit' | 'trash' | 'pin' | 'chevron-left'
  | 'chevron-right' | 'chevron-down' | 'x' | 'globe' | 'lock' | 'eye' | 'brain' | 'wrench' | 'ghost' | 'shield' | 'check' | 'search' | 'sparkle' | 'compress' | 'swap' | 'sliders' | 'key' | 'download' | 'upload' | 'book' | 'star' | 'image' | 'expand' | 'wand' | 'scissors' | 'paperclip' | 'file' | 'files' | 'chat' | 'printer' | 'history' | 'grid' | 'list' | 'clock' | 'filter' | 'sort' | 'more' | 'link' | 'eye-off' | 'palette' | 'chart' | 'info' | 'code';

const PATHS: Record<IconName, string> = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  send: 'M5 12h14M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6 6 18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 1 1 8 0v3',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3ZM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h0a3 3 0 0 1-3-3',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z',
  ghost: 'M6 20V10a6 6 0 1 1 12 0v10l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 20ZM10 10h.01M14 10h.01',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z',
  check: 'M5 12l4 4 10-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  compress: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  palette: 'M12 22a10 10 0 1 1 10-9.5c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.6.8.2 2.7-2.5 2.7ZM13.5 6.5h.01M17.5 10.5h.01M8.5 7.5h.01M6.5 12.5h.01',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M8 17v-3M13 17V9M18 17V5',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 16v-4M12 8h.01',
  key: 'M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0ZM11.4 11.6 21 2M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  book: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5ZM4 20a2 2 0 0 0 2 2h13v-4M8 7h7',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  wand: 'M4 20 15 9M14 4v2M19 9h2M17.5 6.5 19 5M12.5 7.5 16.5 11.5',
  scissors: 'M6 7a2.5 2.5 0 1 0 0-.01M6 17a2.5 2.5 0 1 0 0-.01M8 8.5 20 18M8 15.5 20 6',
  paperclip: 'M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-7.5 7.5a1.7 1.7 0 0 1-2.4-2.4L15 7.2',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  files: 'M8 3h7l4 4v11H8zM15 3v4h4M5 7v14h11',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  filter: 'M4 5h16l-6 7.5V19l-4 2v-8.5L4 5Z',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  // "private": the provider does not keep or look at prompts (the lock means locking with the passphrase)
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6'
};

export function Icon({ name, class: className = 'size-4', filled }: { name: IconName; class?: string; filled?: boolean }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'remove' };

export function Button({ variant = 'ghost', class: className, children, ...rest }: ButtonProps) {
  // primary: the one main action of a view; outline = secondary (glass); ghost: toolbar / icon buttons;
  // danger: a destructive action with a label (with the trash icon); remove: an icon-only delete, red only under the pointer
  const base =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-sm font-medium transition duration-200 active:scale-[.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100';
  const v = {
    primary: 'bg-accent text-accent-ink hover:opacity-90 px-3.5 py-2',
    ghost: 'text-ink hover:bg-glass-strong px-2 py-1.5',
    outline: 'border border-line bg-glass hover:border-line-strong hover:bg-glass-strong px-3.5 py-2',
    danger: 'bg-danger-soft text-danger border border-danger/40 hover:bg-danger/20 px-3.5 py-2',
    remove: 'text-ink hover:bg-danger-soft hover:text-danger px-2 py-1.5'
  }[variant];
  return (
    <button type="button" class={cx(base, v, className as string)} {...rest}>
      {children}
    </button>
  );
}

/**
 * A button that shows only an icon. `label` is its accessible name and its tooltip, so neither can be forgotten;
 * pass `title` only when the tooltip should say more than the name.
 */
export function IconButton({ label, ...rest }: Omit<ButtonProps, 'aria-label'> & { label: string }) {
  return <Button aria-label={label} title={label} {...rest} />;
}

/**
 * A checkbox in the app's look (the browser's own box does not fit the glass). Controlled: `checked` is the truth
 * and is put back into the DOM after every render, since the browser flips the box on click before onChange
 * decides (a Shift-click may select a range and keep it checked). onChange gets the click, for Shift / Ctrl.
 * With children it is a labelled row; without, `label` names it. round: the selection mark on cards.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  round,
  disabled,
  class: className,
  children
}: {
  checked: boolean;
  onChange(next: boolean, e: MouseEvent): void;
  label?: string;
  round?: boolean;
  disabled?: boolean;
  class?: string;
  children?: ComponentChildren;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current && ref.current.checked !== checked) ref.current.checked = checked;
  });
  return (
    <label class={cx('inline-flex items-start gap-2', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)} onClick={(e) => e.stopPropagation()}>
      <span class={cx('relative grid shrink-0 place-items-center', round ? 'size-5' : 'mt-0.5 size-4')}>
        <input
          ref={ref}
          type="checkbox"
          class={cx(
            'peer absolute inset-0 m-0 cursor-[inherit] appearance-none border transition duration-200 checked:border-accent checked:bg-accent',
            round ? 'rounded-full border-white/70 bg-black/35 backdrop-blur-sm' : 'rounded-[5px] border-line-strong bg-sunken hover:border-ink/50'
          )}
          checked={checked}
          disabled={disabled}
          aria-label={children ? undefined : label}
          onClick={(e) => onChange(!checked, e)}
        />
        <Icon name="check" class={cx('pointer-events-none relative text-accent-ink opacity-0 transition-opacity peer-checked:opacity-100', round ? 'size-3.5' : 'size-3')} />
      </span>
      {children}
    </label>
  );
}

/** The arrow of anything that opens and closes: at the right end, pointing down, turned up while open */
export function Chevron({ open, class: className }: { open: boolean; class?: string }) {
  return <Icon name="chevron-down" class={cx('size-3.5 shrink-0 text-faint transition-transform duration-300', open && 'rotate-180', className)} />;
}

/** A summary line that opens and closes the content under it (results, request details) */
export function Disclosure({ summary, defaultOpen = false, class: className, children }: { summary: ComponentChildren; defaultOpen?: boolean; class?: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class={className}>
      <button type="button" class="flex w-full items-center gap-2 text-left text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="min-w-0 flex-1">{summary}</span>
        <Chevron open={open} />
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}

/**
 * Accordion body: opens and closes by animating its height (grid rows 0fr <-> 1fr).
 * Content mounts on first open and unmounts after the close animation.
 */
export function Collapse({ open, class: className, children }: { open: boolean; class?: string; children: ComponentChildren }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  const show = open || mounted;
  return (
    <div
      class={cx('collapse-grid', open && 'is-open')}
      aria-hidden={!open}
      {...(!open ? { inert: true } : {})}
      onTransitionEnd={(e) => e.target === e.currentTarget && !open && setMounted(false)}
    >
      <div class="min-h-0 overflow-hidden">{show && <div class={className}>{children}</div>}</div>
    </div>
  );
}

/**
 * Segmented control (a few mutually exclusive choices: sidebar tabs, layouts, ranges): a sunken track whose
 * selected segment slides to the chosen item. Arrow keys move the choice. `stretch` makes the items share the width.
 * An item with `iconOnly` shows just its icon; its label is the accessible name and the tooltip.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
  stretch,
  class: className
}: {
  items: { id: NoInfer<T>; label: string; icon?: IconName; iconOnly?: boolean }[];
  value: T;
  onChange(id: NoInfer<T>): void;
  label: string;
  size?: 'sm' | 'md';
  stretch?: boolean;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useSelectedBox(ref, '[aria-selected="true"]');
  return (
    <div ref={ref} role="tablist" aria-label={label} class={cx('relative rounded-xl bg-sunken p-0.5', stretch ? 'flex' : 'inline-flex', className)}>
      {box && (
        <span
          aria-hidden="true"
          class="absolute top-0 left-0 rounded-[9px] border border-line bg-glass-strong shadow-sm transition-[translate,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ width: `${box.w}px`, height: `${box.h}px`, translate: `${box.x}px ${box.y}px` }}
        />
      )}
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={value === x.id}
          tabIndex={value === x.id ? 0 : -1}
          aria-label={x.iconOnly ? x.label : undefined}
          title={x.iconOnly ? x.label : undefined}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const i = items.findIndex((y) => y.id === value);
            const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
            onChange(next.id);
            requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
          }}
          class={cx(
            'relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px]',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1.5 text-sm',
            stretch && 'flex-1',
            value === x.id ? 'text-ink-strong' : 'text-muted hover:text-ink'
          )}
        >
          {x.icon && <Icon name={x.icon} class={size === 'sm' ? 'size-3.5' : 'size-4'} />}
          {!x.iconOnly && x.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Slider: a label with the current value on one line, the track below. The filled part of the track follows
 * the value (`--fill`); the knob grows on hover and while dragged. onChange fires while dragging.
 * format: how the value is shown (default: the number itself).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  desc,
  disabled,
  class: className
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(v: number): void;
  format?(v: number): string;
  desc?: string;
  disabled?: boolean;
  class?: string;
}) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const shown = format ? format(value) : String(value);
  return (
    <label class={cx('block text-sm', disabled && 'cursor-not-allowed opacity-50', className)}>
      <span class="flex items-baseline justify-between gap-3">
        {label}
        <span class="text-xs tabular-nums text-muted">{shown}</span>
      </span>
      <input
        type="range"
        class="slider mt-2"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        style={{ '--fill': `${fill}%` } as Record<string, string>}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      />
      {desc && <span class="mt-1 block text-xs text-muted">{desc}</span>}
    </label>
  );
}

/** The value as it was once it stopped changing for `ms` (for work that should not run on every keystroke) */
export function useDebounced<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where the item matching `selector` sits inside `ref` (a positioned element), measured after every render:
 * for a highlight that slides to the selected item. null while nothing matches
 */
export function useSelectedBox(ref: RefObject<HTMLElement | null>, selector: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(selector);
    const next = el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
    setBox((prev) => (prev === next || (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) ? prev : next));
  });
  return box;
}

/**
 * The background that slides to the selected row of a list (conversations, file views). Put it first inside the
 * list, which must be `relative isolate`; `box` comes from useSelectedBox on that list.
 */
export function RowHighlight({ box, class: className }: { box: Box | null; class?: string }) {
  if (!box) return null;
  return (
    <span
      aria-hidden="true"
      class={cx('absolute top-0 -z-10 rounded-lg bg-glass-strong transition-[translate,height] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]', className)}
      style={{ height: `${box.h}px`, translate: `0 ${box.y}px` }}
    />
  );
}

/** Tabs in a column (settings on wide screens): the selected tab's background slides to it */
export function SideTabs<T extends string>({ tabs, value, onChange, label, class: className }: { tabs: { id: T; label: string; icon?: IconName }[]; value: T; onChange(id: T): void; label?: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const bar = useSelectedBox(ref, '[aria-selected="true"]');
  return (
    <div ref={ref} role="tablist" aria-orientation="vertical" aria-label={label} class={cx('relative flex flex-col gap-0.5', className)}>
      {bar && (
        <span
          aria-hidden="true"
          class="absolute inset-x-0 top-0 rounded-[10px] border border-line bg-glass-strong transition-[translate,height] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ height: `${bar.h}px`, translate: `0 ${bar.y}px` }}
        />
      )}
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={value === x.id}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const i = tabs.findIndex((t) => t.id === value);
            const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.id);
            requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
          }}
          class={cx('relative z-10 flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm', value === x.id ? 'text-ink-strong' : 'text-muted hover:text-ink')}
        >
          {x.icon && <Icon name={x.icon} class="size-4 shrink-0" />}
          {x.label}
        </button>
      ))}
    </div>
  );
}

/** A row of tabs with an underline that slides to the selected tab */
export function TabStrip<T extends string>({ tabs, value, onChange, label, class: className }: { tabs: { id: T; label: string }[]; value: T; onChange(id: T): void; label?: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const bar = useSelectedBox(ref, '[aria-selected="true"]');
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [value]);
  return (
    <div ref={ref} role="tablist" aria-label={label} class={cx('relative flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}>
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={value === x.id}
          onClick={() => onChange(x.id)}
          class={cx('shrink-0 rounded-t-lg px-3 py-2 text-sm', value === x.id ? 'text-ink-strong' : 'text-muted hover:bg-glass hover:text-ink')}
        >
          {x.label}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden="true"
          class="absolute bottom-0 left-0 h-0.5 rounded-full bg-accent transition-[translate,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ width: `${bar.w}px`, translate: `${bar.x}px 0` }}
        />
      )}
    </div>
  );
}

/** What a list or screen shows when it has nothing: centered and muted, an icon above, an optional action below */
export function EmptyState({ icon, compact, class: className, children }: { icon?: IconName; compact?: boolean; class?: string; children: ComponentChildren }) {
  return (
    <div class={cx('text-center text-muted', compact ? 'px-2 py-3 text-xs' : 'py-8 text-sm', className)}>
      {icon && <Icon name={icon} class={cx('mx-auto text-faint', compact ? 'mb-1.5 size-5' : 'mb-3 size-8')} />}
      {children}
    </div>
  );
}

// ---- Fields: one look for every text field, text area, select and search box ----
const FIELD =
  'rounded-xl border border-line bg-sunken text-ink placeholder:text-faint transition hover:border-line-strong focus:border-line-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const SELECT = 'rounded-[10px] border border-line bg-sunken text-ink transition hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50';
const fieldSize = (compact?: boolean) => (compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-2 text-sm');

/** Text input. `compact` for dense rows (toolbars, cards) */
export function TextField({ compact, class: className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }) {
  return <input class={cx(FIELD, fieldSize(compact), className as string)} {...rest} />;
}

/** Multi-line text input */
export function TextArea({ compact, class: className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { compact?: boolean }) {
  return <textarea class={cx(FIELD, fieldSize(compact), className as string)} {...rest} />;
}

/** Drop-down choice */
export function Select({ compact, class: className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select class={cx(SELECT, compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm', className as string)} {...rest}>
      {children}
    </select>
  );
}

/** Search box: a field with the search icon; `label` is its accessible name */
export function SearchField({ value, onInput, placeholder, label, class: className }: { value: string; onInput(v: string): void; placeholder: string; label: string; class?: string }) {
  return (
    <label class={cx(FIELD, 'flex items-center gap-2 px-2.5 py-1.5 text-sm focus-within:border-line-strong', className)}>
      <Icon name="search" class="size-3.5 shrink-0 text-faint" />
      <input class="w-full min-w-0 bg-transparent outline-none placeholder:text-faint" placeholder={placeholder} value={value} onInput={(e) => onInput((e.target as HTMLInputElement).value)} aria-label={label} />
    </label>
  );
}

/** Toggle chip / menu chip (pill). `on` marks a selected or active state */
export function Chip({ on, class: className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      class={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition duration-200 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        on ? 'border-transparent bg-accent-soft text-ink-strong' : 'border-line bg-glass text-muted hover:border-line-strong hover:text-ink',
        className as string
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * fixed: a fixed size (the same for every content, so switching what is inside causes no layout shift).
 * bare: the content lays itself out (no padding, no scroll area of the modal's own).
 * fullOnPhone: full screen on phones (large dialogs such as settings and the model picker); a centred window from sm up.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  fixed,
  bare,
  fullOnPhone
}: {
  title: string;
  onClose(): void;
  children: ComponentChildren;
  wide?: boolean;
  fixed?: boolean;
  bare?: boolean;
  fullOnPhone?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onClose });
  return (
    <div class="backdrop fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        class={cx(
          'frosted rise-glass flex w-full flex-col sm:max-h-[92dvh] sm:rounded-[22px]',
          fullOnPhone ? 'max-h-dvh rounded-none border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:border sm:pt-0 sm:pb-0' : 'max-h-[92dvh] rounded-t-[22px]',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          // Height (one place, so the classes never compete): fixed keeps it whatever the content; otherwise it follows the content
          fixed ? (fullOnPhone ? 'h-dvh' : 'h-[92dvh]') + ' sm:h-[min(44rem,92dvh)]' : fullOnPhone && 'h-dvh sm:h-auto'
        )}
      >
        <div class="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 class="font-semibold text-ink-strong">{title}</h2>
          <IconButton onClick={onClose} label={t('ui.close')} data-dialog-close>
            <Icon name="x" />
          </IconButton>
        </div>
        {bare ? <div class="flex min-h-0 flex-1 flex-col">{children}</div> : <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'zinc', title }: { children: ComponentChildren; tone?: 'zinc' | 'green' | 'amber' | 'sky' | 'rose'; title?: string }) {
  // Only ok (green), warn (amber) and danger (rose) carry meaning; everything else is neutral
  const toneCls = {
    zinc: 'bg-glass-strong text-muted',
    green: 'bg-ok-soft text-ok',
    amber: 'bg-warn-soft text-warn',
    sky: 'bg-glass-strong text-muted',
    rose: 'bg-danger-soft text-danger'
  }[tone];
  return (
    <span title={title} class={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', toneCls)}>
      {children}
    </span>
  );
}

export function formatPrice(n?: number): string {
  if (n === undefined) return '—';
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

export function formatCtx(n?: number): string {
  if (!n) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1000)}K`;
}

/** Small spinning ring for work in progress (static when the user prefers reduced motion) */
export function Spinner({ class: className = 'size-3.5' }: { class?: string }) {
  return (
    <svg class={cx(className, 'shrink-0 motion-safe:animate-spin')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}

/** Text with a moving highlight, for "working on it" labels */
export function Shimmer({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return <span class={cx('text-shimmer', className)}>{children}</span>;
}

/** Three bouncing dots */
export function Dots() {
  return (
    <span class="typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
