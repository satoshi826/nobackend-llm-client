// In-app confirmation dialog used instead of the browser's native confirm()/alert().
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Icon, TextField } from './ui';
import { useDialog } from './dialog';
import { t } from './messages';

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

function close(ok: boolean) {
  const cur = state.value;
  state.value = null;
  cur?.resolve(ok);
}

export function ConfirmDialog() {
  const s = state.value;
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (s) setTyped('');
  }, [s]);
  // Focus starts on "Cancel" (or the confirmation input); Esc cancels
  useDialog(dialogRef, { onClose: () => close(false), active: !!s });

  if (!s) return null;
  const canConfirm = !s.requireText || typed.trim() === s.requireText;

  return (
    <div class="backdrop fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg" class="frosted rise-glass w-full max-w-sm rounded-[22px] p-5">
        <div class="flex items-start gap-3">
          {s.danger && (
            <div class="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <Icon name="trash" />
            </div>
          )}
          <div class="min-w-0">
            <h2 id="confirm-title" class="font-semibold">
              {s.title}
            </h2>
            <p id="confirm-msg" class="mt-1 text-sm break-words whitespace-pre-wrap text-muted">
              {s.message}
            </p>
          </div>
        </div>
        {s.requireText && (
          <label class="mt-4 block text-sm">
            {t('confirm.typeToConfirm', { text: s.requireText })}
            <TextField
              data-autofocus
              value={typed}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && canConfirm && close(true)}
              class="mt-1 block w-full"
            />
          </label>
        )}
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)} {...(s.requireText ? {} : { 'data-autofocus': true })}>
            {t('confirm.cancel')}
          </Button>
          <Button variant={s.danger ? 'danger' : 'primary'} disabled={!canConfirm} onClick={() => close(true)}>
            <Icon name={s.danger ? 'trash' : 'check'} />
            {s.confirmLabel ?? t('confirm.ok')}
          </Button>
        </div>
      </div>
    </div>
  );
}
