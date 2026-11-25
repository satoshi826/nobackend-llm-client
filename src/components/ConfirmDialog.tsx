// In-app confirmation dialog used instead of the browser's native confirm()/alert().
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Icon } from './ui';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Can only be executed when the typed input matches (guards against mistakes on irreversible actions) */
  requireText?: string;
}

const state = signal<(ConfirmOptions & { resolve(ok: boolean): void }) | null>(null);

export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  // Treat any dialog that is already open as cancelled
  state.value?.resolve(false);
  return new Promise((resolve) => {
    state.value = { ...opts, resolve };
  });
}

export function ConfirmDialog() {
  const s = state.value;
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!s) return;
    setTyped('');
    // For irreversible actions, put the default focus on "Cancel"
    (s.requireText ? inputRef.current : cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [s]);

  if (!s) return null;
  const close = (ok: boolean) => {
    const cur = state.value;
    state.value = null;
    cur?.resolve(ok);
  };
  const canConfirm = !s.requireText || typed.trim() === s.requireText;

  return (
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg" class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <div class="flex items-start gap-3">
          {s.danger && (
            <div class="grid size-9 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950">
              <Icon name="trash" />
            </div>
          )}
          <div class="min-w-0">
            <h2 id="confirm-title" class="font-semibold">
              {s.title}
            </h2>
            <p id="confirm-msg" class="mt-1 text-sm break-words whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
              {s.message}
            </p>
          </div>
        </div>
        {s.requireText && (
          <label class="mt-4 block text-sm">
            確認のため「{s.requireText}」と入力してください
            <input
              ref={inputRef}
              value={typed}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && canConfirm && close(true)}
              class="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}
        <div class="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef as any} variant="outline" onClick={() => close(false)}>
            キャンセル
          </Button>
          <Button variant={s.danger ? 'danger' : 'primary'} disabled={!canConfirm} onClick={() => close(true)}>
            {s.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </div>
    </div>
  );
}
