import type { ComponentChildren, ButtonHTMLAttributes, InputHTMLAttributes, RefObject, SelectHTMLAttributes, TextareaHTMLAttributes } from 'preact';
import { createContext } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDialog } from './dialog';
import { t } from './messages';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

export type IconName =
  | 'menu' | 'plus' | 'settings' | 'send' | 'stop' | 'copy' | 'refresh' | 'edit' | 'trash' | 'pin' | 'chevron-left'
  | 'chevron-right' | 'chevron-down' | 'x' | 'globe' | 'lock' | 'eye' | 'brain' | 'wrench' | 'ghost' | 'shield' | 'check' | 'search' | 'sparkle' | 'compress' | 'swap' | 'sliders' | 'key' | 'download' | 'upload' | 'book' | 'star' | 'image' | 'expand' | 'wand' | 'scissors' | 'paperclip' | 'file' | 'files' | 'chat' | 'printer' | 'history' | 'grid' | 'list' | 'clock' | 'filter' | 'sort' | 'more' | 'link' | 'eye-off' | 'palette' | 'chart' | 'info' | 'code' | 'video' | 'play' | 'folder' | 'folder-plus';

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
  sparkle: 'M12 5l1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8L12 5Z',
  compress: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  palette: 'M12 22a10 10 0 1 1 10-9.5c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.6.8.2 2.7-2.5 2.7ZM13.5 6.5h.01M17.5 10.5h.01M8.5 7.5h.01M6.5 12.5h.01',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M8 17v-3M13 17V9M18 17V5',
  video: 'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  play: 'M6 3.5v17a.5.5 0 0 0 .8.4l13-8.5a.5.5 0 0 0 0-.8l-13-8.5a.5.5 0 0 0-.8.4z',
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
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  'folder-plus': 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10v6M9 13h6',
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

/** title on the shared controls (Button, Chip, Select) becomes the app's tooltip (components/tooltip.ts), not the browser's */
export function Button({ variant = 'ghost', class: className, children, title, ...rest }: ButtonProps) {
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
    <button type="button" class={cx(base, v, className as string)} data-tip={title} {...rest}>
      {children}
    </button>
  );
}

/**
 * A button that shows only an icon. `label` is its accessible name and its tooltip, so neither can be forgotten;
 * pass `title` only when the tooltip should say more than the name.
 */
export function IconButton({ label, ...rest }: Omit<ButtonProps, 'aria-label'> & { label: string }) {
  return <Button aria-label={label} {...rest} />;
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
            round ? 'rounded-full border-white/70 bg-black/45' : 'rounded-[5px] border-line-strong bg-sunken hover:border-ink/50'
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
 * A tab of a tab list: the list is one stop for Tab (on the selected tab), and the arrow keys along it choose the
 * previous or next tab and keep focus on it
 */
function tabKeys<T extends string>(list: RefObject<HTMLElement | null>, tabs: { id: T }[], id: T, value: T, onChange: (id: T) => void, prev: string, next: string) {
  return {
    tabIndex: id === value ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== prev && e.key !== next) return;
      e.preventDefault();
      const i = tabs.findIndex((x) => x.id === value);
      onChange(tabs[(i + (e.key === next ? 1 : tabs.length - 1)) % tabs.length].id);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
    }
  };
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
    <div ref={ref} role="tablist" aria-label={label} class={cx('relative rounded-xl border border-line bg-sunken p-0.5', stretch ? 'flex' : 'inline-flex', className)}>
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
          aria-label={x.iconOnly ? x.label : undefined}
          onClick={() => onChange(x.id)}
          {...tabKeys(ref, items, x.id, value, onChange, 'ArrowLeft', 'ArrowRight')}
          class={cx(
            'relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px]',
            size === 'sm' ? 'min-w-6 px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm',
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

/**
 * Stepping through a set (images) with a finger. What is shown (the area's first child) follows a sideways drag; let
 * go past a quarter of the width, or flicked, it slides out that way and the next one slides in from the other side,
 * else it slides back. A tap near the left or right edge steps too. Spread the result on the area that shows the item.
 * Only touch counts (a mouse has buttons and keys), and not on a video (its controls take swipes and taps). The area
 * lets the browser keep vertical scrolling and zoom: a drag that starts vertical is left to it
 */
export function useSwipeStep(step: ((d: 1 | -1) => void) | undefined) {
  const drag = useRef<{ x: number; y: number; at: number; area: HTMLElement; sideways: boolean | null } | null>(null);
  const handled = useRef(false);
  if (!step) return {};
  const slideMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
  const shown = (area: HTMLElement) => area.firstElementChild as HTMLElement | null;
  const place = (item: HTMLElement | null, x: number, ms = 0) => {
    if (!item) return;
    item.style.transition = ms ? `translate ${ms}ms ease-out` : '';
    item.style.translate = x ? `${x}px 0` : '';
  };
  return {
    class: 'touch-pan-y touch-pinch-zoom overflow-hidden',
    onPointerDown: (e: PointerEvent) => {
      handled.current = false;
      const touch = e.pointerType === 'touch' && !(e.target as Element).closest('video');
      drag.current = touch ? { x: e.clientX, y: e.clientY, at: e.timeStamp, area: e.currentTarget as HTMLElement, sideways: null } : null;
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // Which way the drag goes is decided once it has gone 10 px
      if (d.sideways === null && Math.hypot(dx, dy) > 10) d.sideways = Math.abs(dx) > Math.abs(dy);
      if (d.sideways) place(shown(d.area), dx);
    },
    onPointerCancel: () => {
      const d = drag.current;
      drag.current = null;
      if (d) place(shown(d.area), 0, slideMs);
    },
    onPointerUp: (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const ms = Math.max(1, e.timeStamp - d.at);
      const width = d.area.clientWidth;
      if (d.sideways) {
        handled.current = true;
        if (Math.abs(dx) < width / 4 && !(Math.abs(dx) > 30 && Math.abs(dx) / ms > 0.5)) {
          place(shown(d.area), 0, slideMs);
          return;
        }
        const dir = dx < 0 ? 1 : -1;
        // Out the way it was pushed; then the next one, from the other side
        place(shown(d.area), -dir * width, slideMs);
        setTimeout(() => {
          step(dir);
          requestAnimationFrame(() => {
            const next = shown(d.area);
            place(next, dir * width);
            requestAnimationFrame(() => place(next, 0, slideMs));
          });
        }, slideMs);
        return;
      }
      // A tap: the outer fifth on either side steps (the middle is left to what is shown)
      if (Math.hypot(dx, dy) < 10 && ms < 400) {
        const box = d.area.getBoundingClientRect();
        const at = (e.clientX - box.left) / box.width;
        if (at < 0.2 || at > 0.8) {
          handled.current = true;
          step(at < 0.2 ? -1 : 1);
        }
      }
    },
    // The click that follows a handled swipe or tap does nothing else (a click on the backdrop closes the viewer)
    onClickCapture: (e: MouseEvent) => {
      if (!handled.current) return;
      handled.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
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

/**
 * A long list drawn in batches as it scrolls: the first `batch` items at once, then `batch` more each time `mark`
 * (an element put after the list, see MoreMark) comes within 1200px of the bottom of `root`. Starts again from the
 * first batch when anything in `restart` changes
 */
export function useBatches(total: number, batch: number, root: RefObject<HTMLElement | null>, restart: readonly unknown[]) {
  const mark = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(batch);
  // oxlint-disable-next-line react/exhaustive-deps -- `restart` is the caller's list of what starts it again
  useEffect(() => setLimit(batch), restart);
  useEffect(() => {
    const el = mark.current;
    if (!root.current || !el) return;
    const io = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setLimit((n) => n + batch), { root: root.current, rootMargin: '0px 0px 1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total, batch, root]);
  return { limit, mark, more: total > limit };
}

/** Put after a list drawn with useBatches: the next batch is drawn when this comes near the bottom of the view */
export function MoreMark({ batches }: { batches: { mark: RefObject<HTMLDivElement | null>; more: boolean } }) {
  return batches.more ? <div ref={batches.mark} class="h-px" /> : null;
}

/**
 * The scrolling area around (a list, the conversation): what is drawn inside measures "near the screen" against it,
 * since a margin around the window does not reach past the edges of a scrolling area
 */
export const ScrollArea = createContext<RefObject<HTMLElement | null> | null>(null);

type Box = { x: number; y: number; w: number; h: number };

/** The box of the item matching `selector` inside `list`, kept as prev when unchanged (so it renders no more) */
function boxIn(list: HTMLElement | null, selector: string, prev: Box | null): Box | null {
  const el = list?.querySelector<HTMLElement>(selector);
  const next = el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
  return prev === next || (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) ? prev : next;
}

/**
 * Where the item matching `selector` sits inside `ref` (a positioned element), measured after every render and
 * when `ref` changes size (the window or the sidebar resized, with no render): for a highlight that slides to the
 * selected item. null while nothing matches
 */
export function useSelectedBox(ref: RefObject<HTMLElement | null>, selector: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  // oxlint-disable-next-line react/exhaustive-deps -- measured after every render on purpose; an unchanged box keeps the state, so it renders no more
  useLayoutEffect(() => setBox((prev) => boxIn(ref.current, selector, prev)));
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const observer = new ResizeObserver(() => setBox((prev) => boxIn(list, selector, prev)));
    observer.observe(list);
    return () => observer.disconnect();
  }, [ref, selector]);
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
          {...tabKeys(ref, tabs, x.id, value, onChange, 'ArrowUp', 'ArrowDown')}
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
          {...tabKeys(ref, tabs, x.id, value, onChange, 'ArrowLeft', 'ArrowRight')}
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

/**
 * A ref whose element takes focus when it is drawn with `on`, or when `on` turns true: autoFocus for what is drawn
 * after the page loaded (the browser's own autofocus works once per page, so a second rename in place would get none)
 */
export function useFocusWhen<T extends HTMLElement>(on: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (on) ref.current?.focus();
  }, [on]);
  return ref;
}

/** Text input. `compact` for dense rows (toolbars, cards) */
export function TextField({ compact, class: className, autoFocus, ...rest }: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }) {
  return <input ref={useFocusWhen(autoFocus)} class={cx(FIELD, fieldSize(compact), className as string)} {...rest} />;
}

/**
 * A field shown in place of a control while it is open (a name renamed in place, a text edited in place of its view).
 * close(true), for Enter, Esc and the field's own buttons, puts focus back on the control (`control`): the field took
 * it away with it
 */
export function useInPlace<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const control = useRef<T>(null);
  const back = useRef(false);
  useEffect(() => {
    if (open || !back.current) return;
    back.current = false;
    control.current?.focus();
  }, [open]);
  const close = useCallback((focusBack?: boolean) => {
    // A later close without it (the field's blur as it goes) keeps the request
    if (focusBack) back.current = true;
    setOpen(false);
  }, []);
  return { open, control, show: () => setOpen(true), close };
}

export function TextArea({ compact, class: className, autoFocus, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { compact?: boolean }) {
  return <textarea ref={useFocusWhen(autoFocus)} class={cx(FIELD, fieldSize(compact), className as string)} {...rest} />;
}

export function Select({ compact, class: className, children, title, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select class={cx(SELECT, compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm', className as string)} data-tip={title} {...rest}>
      {children}
    </select>
  );
}

/**
 * Search box: a field with the search icon; `label` is its accessible name. autoFocus: only where opening the field is
 * the user's own step toward typing (a search opened from its icon)
 */
export function SearchField({ value, onInput, placeholder, label, autoFocus, class: className }: { value: string; onInput(v: string): void; placeholder: string; label: string; autoFocus?: boolean; class?: string }) {
  return (
    <label class={cx(FIELD, 'flex items-center gap-2 px-2.5 py-1.5 text-sm focus-within:border-line-strong', className)}>
      <Icon name="search" class="size-3.5 shrink-0 text-faint" />
      <input ref={useFocusWhen(autoFocus)} class="w-full min-w-0 bg-transparent outline-none placeholder:text-faint" placeholder={placeholder} value={value} onInput={(e) => onInput((e.target as HTMLInputElement).value)} aria-label={label} />
    </label>
  );
}

/** One of the choices of a SearchChoice: `sub` is a quieter second part (a provider, a price); `badge` marks a kind, with what it means */
export interface Choice {
  value: string;
  label: string;
  sub?: string;
  badge?: { label: string; title: string };
}

/** A choice's name, with its badge after it */
function ChoiceName({ c }: { c: Choice }) {
  return (
    <span class="flex flex-wrap items-center gap-1.5">
      <span class="[overflow-wrap:anywhere]">{c.label}</span>
      {c.badge && <Badge title={c.badge.title}>{c.badge.label}</Badge>}
    </span>
  );
}

/**
 * A choice among many (hundreds of models): the chosen one shows as a field; opening it shows, in place, a search and
 * the list to pick from. A drop-down of hundreds of entries cannot be searched and is hard to scroll on a phone
 */
export function SearchChoice({ label, value, choices, onChange, disabled }: { label: string; value: string; choices: Choice[]; onChange(value: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = choices.find((c) => c.value === value);
  const words = q.trim().toLowerCase();
  const shown = words ? choices.filter((c) => `${c.label} ${c.sub ?? ''} ${c.badge?.label ?? ''}`.toLowerCase().includes(words)) : choices;
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };
  return (
    <div class={cx('text-sm', disabled && 'opacity-50')}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        class={cx(SELECT, 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left')}
      >
        {/* Its name is what it shows, after what it chooses */}
        <span class="sr-only">{label}: </span>
        <span class="min-w-0 flex-1">
          {current ? <ChoiceName c={current} /> : <span class="block [overflow-wrap:anywhere]">{value}</span>}
          {current?.sub && <span class="block text-xs text-muted">{current.sub}</span>}
        </span>
        <Chevron open={open} />
      </button>
      <Collapse open={open}>
        <div class="mt-1.5 space-y-1.5 rounded-xl border border-line bg-sunken p-1.5">
          <SearchField value={q} onInput={setQ} placeholder={t('ui.filter')} label={t('ui.filter')} />
          <ul role="listbox" aria-label={label} class="scroll-thin max-h-72 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.value} role="option" aria-selected={c.value === value}>
                <button type="button" onClick={() => pick(c.value)} class={cx('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left', c.value === value ? 'bg-glass-strong' : 'hover:bg-glass')}>
                  <span class="min-w-0 flex-1">
                    <ChoiceName c={c} />
                    {c.sub && <span class="block text-xs text-muted">{c.sub}</span>}
                  </span>
                  {c.value === value && <Icon name="check" class="mt-0.5 size-4 shrink-0 text-ink-strong" />}
                </button>
              </li>
            ))}
            {!shown.length && <li class="px-2 py-3 text-xs text-muted">{t('ui.noMatch')}</li>}
          </ul>
        </div>
      </Collapse>
    </div>
  );
}

/** Toggle chip / menu chip (pill). `on` marks a selected or active state */
export function Chip({ on, class: className, children, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      data-tip={title}
      class={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition duration-200 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
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
  const body = useRef<HTMLDivElement>(null);
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
          wide ? 'sm:max-w-3xl lg:max-w-4xl' : 'sm:max-w-lg',
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
        {bare ? (
          <div class="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          // What is drawn inside measures "near the screen" against the dialog's own scrolling (long lists, thumbnails)
          <ScrollArea.Provider value={body}>
            <div ref={body} class="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
              {children}
            </div>
          </ScrollArea.Provider>
        )}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'zinc', title }: { children: ComponentChildren; tone?: 'zinc' | 'green' | 'amber' | 'sky' | 'rose'; title?: string }) {
  // Only ok (green), warn (amber) and danger (rose) carry meaning; everything else is neutral, in body ink: muted text
  // at 11 px on glass-strong stays under 4.5:1
  const toneCls = {
    zinc: 'bg-glass-strong text-ink',
    green: 'bg-ok-soft text-ok',
    amber: 'bg-warn-soft text-warn',
    sky: 'bg-glass-strong text-ink',
    rose: 'bg-danger-soft text-danger'
  }[tone];
  return (
    <span data-tip={title} class={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', toneCls)}>
      {children}
    </span>
  );
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
