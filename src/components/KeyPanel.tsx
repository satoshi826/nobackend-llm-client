// Screens for registering, unlocking, and deleting keys. The content is the key vault page (iframe), so typed keys never reach the main app.
// - KeyPanel: the key for one provider (unlocks it if the vault is locked)
// - VaultSecurityPanel: the vault-wide passphrase, and deleting all keys
import { useEffect, useRef, useState } from 'preact/hooks';
import { VAULT_ORIGIN, vaultViewUrl } from '../lib/vault/client';
import { PRESETS } from '../lib/providers/registry';
import { SERVICES } from '../lib/tools/services';
import { connectKeys } from '../state/keys';
import { modal } from '../state/ui';
import { Icon } from './ui';
import { t } from './messages';

function VaultFrame({ params, title }: { params: Record<string, string>; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(280);
  const dark = document.documentElement.classList.contains('dark');

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== VAULT_ORIGIN || e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === 'vault-resize' && typeof e.data.height === 'number') setHeight(Math.min(1200, Math.max(100, e.data.height)));
      // When Esc is pressed inside the frame, close the open settings screen
      if (e.data?.type === 'vault-escape') modal.value = null;
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      void connectKeys();
    };
  }, []);

  // The vault page keeps 4 px around its content for focus rings. That margin spills over (and collapses with the
  // spacing around the frame), so the page's cards line up with the app's
  return (
    <div>
      <iframe
        ref={ref}
        src={vaultViewUrl({ ...params, theme: dark ? 'dark' : 'light' })}
        title={title}
        referrerpolicy="no-referrer"
        allow="publickey-credentials-get; publickey-credentials-create"
        class="-m-1 block w-[calc(100%+0.5rem)] max-w-none border-0"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}

/**
 * Key setup form + guidance for using it safely.
 * compact: for places such as inside settings, where the storage location is explained elsewhere
 */
export function KeyPanel({ accountId, showGuide = true, compact }: { accountId: string; showGuide?: boolean; compact?: boolean }) {
  const guide = (PRESETS[accountId] ?? SERVICES[accountId])?.keyGuide;
  return (
    <div class="space-y-3">
      <VaultFrame params={{ view: 'keys', provider: accountId, ...(compact ? { compact: '1' } : {}) }} title={t('keys.frameKeys')} />
      {showGuide && guide && (
        <div class="rounded-lg bg-warn-soft p-3 text-xs leading-5 text-warn">
          <div class="mb-1 flex items-center gap-1 font-semibold">
            <Icon name="shield" class="size-3.5" />
            {t('keys.guideTitle')}
          </div>
          {guide}
        </div>
      )}
    </div>
  );
}

/** Passphrase (set, unlock, lock, change, remove) and deleting all keys */
export function VaultSecurityPanel({ setup }: { setup?: boolean } = {}) {
  return <VaultFrame params={{ view: 'security', ...(setup ? { setup: '1' } : {}) }} title={t('keys.frameSecurity')} />;
}

/** Frame with only the unlock form, used on the main app's lock screen */
export function VaultUnlockPanel() {
  return <VaultFrame params={{ view: 'unlock' }} title={t('keys.frameUnlock')} />;
}
