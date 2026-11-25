// Screens shown instead of the conversation: empty new chat, first provider, key setup / unlock, passphrase prompt
import { currentConv, updateConversation } from '../../state/conversations';
import { vaultState } from '../../state/keys';
import { hostOfProvider as hostOf, providerById, providers, setProviderEnabled } from '../../state/models';
import { saveSettings } from '../../state/settings';
import { openSettings } from '../../state/ui';
import { getPreset } from '../../lib/providers/registry';
import { KeyPanel, VaultSecurityPanel } from '../KeyPanel';
import { Button, Icon } from '../ui';
import { t } from './messages';
import { around } from '../messages';

export function EmptyState() {
  const temp = !!currentConv.value.temporary;
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div class="mb-3 grid size-12 place-items-center rounded-2xl bg-glass-strong">
        <Icon name={temp ? 'ghost' : 'shield'} class="size-6 text-muted" />
      </div>
      <h1 class="text-xl font-semibold">{temp ? t('onb.tempHeading') : t('onb.emptyHeading')}</h1>
      <p class="mt-2 max-w-md text-sm text-muted">
        {temp ? t('onb.tempText') : t('onb.emptyText')}
      </p>
    </div>
  );
}

/** Screen for choosing the first provider to use (when no provider is enabled) */
export function ProviderChooser() {
  const choose = async (id: string) => {
    await setProviderEnabled(id, true);
    await updateConversation({ providerId: id, modelId: '' });
  };
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-glass-strong">
          <Icon name="key" class="size-6 text-muted" />
        </div>
        <h1 class="text-2xl font-semibold">{t('onb.welcome')}</h1>
        <p class="mt-2 text-sm leading-6 text-muted">
          {t('onb.introAny')}
        </p>
        <h2 class="mt-6 mb-2 text-sm font-semibold">{t('onb.chooseProvider')}</h2>
        <ul class="space-y-2">
          {providers.value.map((p) => {
            const preset = getPreset(p.preset);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  class="w-full rounded-xl border border-line p-3 text-left hover:border-line-strong hover:bg-glass"
                  onClick={() => void choose(p.id)}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{preset.label}</span>
                    <span class="truncate text-xs text-muted">{hostOf(p.id)}</span>
                    <Icon name="chevron-right" class="ml-auto size-4 shrink-0 text-faint" />
                  </div>
                  {preset.tagline && <p class="mt-1 text-xs leading-5 text-muted">{preset.tagline}</p>}
                </button>
              </li>
            );
          })}
        </ul>
        <p class="mt-4 text-xs text-muted">{t('onb.addLater')}</p>
      </div>
    </div>
  );
}

/** Prompt to set a passphrase after the first key is saved (skippable) */
export function PassphrasePrompt() {
  const skip = () => void saveSettings({ passphrasePrompted: true });
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-ok-soft">
          <Icon name="lock" class="size-6 text-ok" />
        </div>
        <h1 class="text-2xl font-semibold">{t('onb.passHeading')}</h1>
        <p class="mt-2 text-sm leading-6 text-muted">{t('onb.passText')}</p>
        <ul class="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
          <li>{t('onb.passPoint1')}</li>
          <li>{t('onb.passPoint2')}</li>
          <li>{t('onb.passPoint3')}</li>
        </ul>
        <div class="mt-6">
          <VaultSecurityPanel setup />
        </div>
        <div class="mt-4 flex items-center gap-3">
          <Button variant="outline" onClick={skip}>
            {t('onb.later')}
          </Button>
          <span class="text-xs text-muted">{t('onb.passLaterNote')}</span>
        </div>
      </div>
    </div>
  );
}

/** Screen shown when the selected provider's key is unset or locked */
export function KeySetup({ providerId }: { providerId: string }) {
  const p = providerById(providerId);
  const locked = vaultState.value.locked;
  const [otherBefore, otherAfter] = around(t('onb.otherProvider'), 'link');
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-glass-strong">
          <Icon name={locked ? 'lock' : 'key'} class="size-6 text-muted" />
        </div>
        {locked ? (
          <>
            <h1 class="text-2xl font-semibold">{t('onb.lockedHeading')}</h1>
            <p class="mt-2 text-sm text-muted">{t('onb.lockedText')}</p>
          </>
        ) : (
          <>
            <h1 class="text-2xl font-semibold">{t('onb.welcome')}</h1>
            <p class="mt-2 text-sm leading-6 text-muted">
              {t('onb.introProvider', { name: p?.name ?? '' })}
            </p>
          </>
        )}
        <div class="mt-6">
          <KeyPanel accountId={providerId} showGuide={!locked} />
        </div>
        {!locked && (
          <p class="mt-4 text-xs text-muted">
            {otherBefore}
            <button type="button" class="underline underline-offset-2" onClick={() => openSettings('connections')}>
              {t('onb.settingsLink')}
            </button>
            {otherAfter}
          </p>
        )}
      </div>
    </div>
  );
}

