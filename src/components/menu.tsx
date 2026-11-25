// Menus and popovers: one component for every floating list (attach menu, skill menu, "/" suggestions, ...).
// - Rendered in a portal on <body>, positioned from its anchor with fixed coordinates. Inside the composer
//   (which is glass) a backdrop-filter only blurs the composer itself, so menus must not live inside it.
// - Opaque panel + strong blur (styles.css .panel), opens with the "pop" animation from its anchor.
// - Closes on Escape (focus goes back to the anchor) and on a press outside the menu and its anchor.
// - Arrow keys move between items (role menuitem / menuitemcheckbox / option).
import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cx } from './ui';

export type Placement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

const GAP = 8;
const MARGIN = 8;
const ITEM = '[role="menuitem"],[role="menuitemcheckbox"],[role="option"]';

interface Position {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  origin: string;
}

function place(anchor: DOMRect, size: { w: number; h: number }, placement: Placement): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const above = anchor.top - GAP - MARGIN;
  const below = vh - anchor.bottom - GAP - MARGIN;
  // Flip when the preferred side is too small and the other side has more room
  let side = placement.startsWith('top') ? 'top' : 'bottom';
  if (side === 'top' && above < Math.min(size.h, 160) && below > above) side = 'bottom';
  if (side === 'bottom' && below < Math.min(size.h, 160) && above > below) side = 'top';
  const alignEnd = placement.endsWith('end');
  const left = Math.min(Math.max(MARGIN, alignEnd ? anchor.right - size.w : anchor.left), Math.max(MARGIN, vw - size.w - MARGIN));
  const origin = `${side === 'top' ? 'bottom' : 'top'} ${alignEnd ? 'right' : 'left'}`;
  return side === 'top'
    ? { left, bottom: vh - anchor.top + GAP, maxHeight: Math.max(120, above), origin }
    : { left, top: anchor.bottom + GAP, maxHeight: Math.max(120, below), origin };
}

export function Popover({
  anchor,
  onClose,
  placement = 'top-start',
  role = 'menu',
  label,
  autoFocus = role === 'menu',
  class: className,
  children
}: {
  /** The element the popover is attached to (also counts as "inside" for outside presses) */
  anchor: HTMLElement | null;
  onClose(): void;
  placement?: Placement;
  role?: 'menu' | 'listbox' | 'dialog';
  label?: string;
  /** Focus the first item when opened (menus; not suggestion lists, where typing goes on) */
  autoFocus?: boolean;
  class?: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!anchor || !el) return;
      setPos(place(anchor.getBoundingClientRect(), { w: el.offsetWidth, h: el.scrollHeight }, placement));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, placement]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      // A menu hands focus back to the control that opened it (a suggestion list leaves focus in the input)
      if (role === 'menu') {
        e.stopPropagation();
        (anchor?.matches('button') ? anchor : anchor?.querySelector<HTMLElement>('button'))?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  // Focus the first item once the menu is placed (it is hidden, and cannot take focus, until then)
  const placed = !!pos;
  useEffect(() => {
    if (placed && autoFocus) ref.current?.querySelector<HTMLElement>(ITEM)?.focus();
  }, [placed]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      class={cx('panel pop scroll-thin fixed z-50 overflow-y-auto rounded-2xl p-1.5 text-sm', !pos && 'invisible', className)}
      style={pos ? { left: `${pos.left}px`, top: pos.top !== undefined ? `${pos.top}px` : undefined, bottom: pos.bottom !== undefined ? `${pos.bottom}px` : undefined, maxHeight: `${pos.maxHeight}px`, transformOrigin: pos.origin } : undefined}
    >
      {children}
    </div>,
    document.body
  );
}

/** One row of a menu (or an option of a suggestion list) */
export function MenuItem({
  icon,
  checked,
  selected,
  role = checked === undefined ? 'menuitem' : 'menuitemcheckbox',
  onSelect,
  onMouseDown,
  class: className,
  children
}: {
  icon?: ComponentChildren;
  /** For checkable items (menuitemcheckbox) */
  checked?: boolean;
  /** Highlighted option of a suggestion list */
  selected?: boolean;
  role?: 'menuitem' | 'menuitemcheckbox' | 'option';
  onSelect(): void;
  onMouseDown?(e: MouseEvent): void;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemcheckbox' ? !!checked : undefined}
      aria-selected={role === 'option' ? !!selected : undefined}
      class={cx(
        'flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink outline-none hover:bg-glass-strong focus-visible:bg-glass-strong',
        selected && 'bg-glass-strong',
        className
      )}
      onMouseDown={onMouseDown}
      onClick={onSelect}
    >
      {icon}
      <span class="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** A thin line between groups of items */
export const MenuSeparator = () => <div role="separator" class="my-1 border-t border-line" />;
