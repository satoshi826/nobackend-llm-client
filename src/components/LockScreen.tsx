// Screen shown until unlocked while conversations are encrypted (hides the sidebar, search, and all conversations)
import { wipeEverything } from '../state/data';
import { dataLock } from '../state/lock';
import { VaultUnlockPanel } from './KeyPanel';
import { askConfirm } from './ConfirmDialog';
import { Button, Icon } from './ui';
import { t } from './messages';

export function LockScreen() {
  const lost = dataLock.value === 'lost';
  const forget = () =>
    void askConfirm({
      title: lost ? t('lock.deleteEncryptedTitle') : t('lock.forgotTitle'),
      message: t('lock.wipeMessage'),
      confirmLabel: t('lock.wipeConfirm'),
      danger: true,
      requireText: t('confirm.deleteWord')
    }).then((ok) => {
      if (ok) void wipeEverything();
    });
  return (
    <div class="grid h-full place-items-center overflow-y-auto px-5 py-10">
      <div class="glass-float rise w-full max-w-sm rounded-[22px] p-6">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-glass-strong">
          <Icon name="lock" class="size-6 text-muted" />
        </div>
        <h1 class="text-2xl font-semibold text-ink-strong">{lost ? t('lock.lostHeading') : t('lock.lockedHeading')}</h1>
        <p class="mt-2 text-sm leading-6 text-muted">
          {lost ? t('lock.lostText') : t('lock.lockedText')}
        </p>
        {!lost && (
          <div class="mt-5">
            <VaultUnlockPanel />
          </div>
        )}
        <Button variant="outline" class="mt-6 text-xs" onClick={forget}>
          <Icon name={lost ? 'trash' : 'key'} class="size-3.5" />
          {lost ? t('lock.deleteEncrypted') : t('lock.forgot')}
        </Button>
      </div>
    </div>
  );
}
