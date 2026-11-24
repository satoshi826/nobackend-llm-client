import type { ComponentChildren, ButtonHTMLAttributes } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

type IconName =
  | 'menu' | 'plus' | 'settings' | 'send' | 'stop' | 'copy' | 'refresh' | 'edit' | 'trash' | 'pin' | 'chevron-left'
  | 'chevron-right' | 'chevron-down' | 'x' | 'globe' | 'lock' | 'eye' | 'brain' | 'wrench' | 'ghost' | 'shield' | 'check' | 'search' | 'sparkle' | 'compress' | 'swap' | 'sliders' | 'key' | 'download' | 'upload';

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
  key: 'M14 10a4 4 0 1 0-3.5 4L13 16.5V19h2.5v-2.5H18l1-1-3.6-3.6A4 4 0 0 0 14 10ZM8 10h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14'
};

export function Icon({ name, class: className = 'size-4' }: { name: IconName; class?: string }) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Button({
  variant = 'ghost',
  class: className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-sky-500';
  const v = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-700 px-3 py-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300',
    ghost: 'hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 py-1.5',
    outline: 'border border-zinc-300 hover:bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:hover:bg-zinc-900',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 px-3 py-2'
  }[variant];
  return (
    <button type="button" class={cx(base, v, className as string)} {...rest}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        class={cx('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-zinc-900', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div class="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 class="font-semibold">{title}</h2>
          <Button onClick={onClose} aria-label="閉じる">
            <Icon name="x" />
          </Button>
        </div>
        <div class="scroll-thin overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'zinc', title }: { children: ComponentChildren; tone?: 'zinc' | 'green' | 'amber' | 'sky' | 'rose'; title?: string }) {
  const t = {
    zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
  }[tone];
  return (
    <span title={title} class={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', t)}>
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
