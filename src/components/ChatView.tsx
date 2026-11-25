// Main conversation screen: header / (onboarding, empty screen, or message list) / input box
import { currentConv, isDraft } from '../state/conversations';
import { keyStatus, vaultState } from '../state/keys';
import { enabledProviders, providerById } from '../state/models';
import { settings } from '../state/settings';
import { PRESETS } from '../lib/providers/registry';
import { Header } from './chat/Header';
import { Composer } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import { EmptyState, KeySetup, PassphrasePrompt, ProviderChooser } from './chat/Onboarding';

export function ChatView() {
  const provs = enabledProviders.value;
  const conv = currentConv.value;
  // The conversation's provider (for a draft whose model list has not arrived yet, the first enabled provider)
  const providerId = provs.some((p) => p.id === conv.providerId) || !isDraft.value ? conv.providerId : (provs[0]?.id ?? '');
  const st = keyStatus(providerId);
  const keyOptional = !!PRESETS[providerById(providerId)?.preset ?? '']?.keyOptional;
  const vs = vaultState.value;
  const body =
    provs.length === 0
      ? 'choose'
      : (!st.present && !keyOptional) || st.locked
        ? 'key'
        : st.present && !vs.hasPassphrase && !settings.value.passphrasePrompted
          ? 'passphrase'
          : 'chat';
  return (
    <main class="flex h-full min-w-0 flex-1 flex-col">
      {body !== 'choose' && body !== 'passphrase' && <Header />}
      {body === 'choose' ? (
        <ProviderChooser />
      ) : body === 'key' ? (
        <KeySetup providerId={providerId} />
      ) : body === 'passphrase' ? (
        <PassphrasePrompt />
      ) : isDraft.value ? (
        <EmptyState />
      ) : (
        <MessageList />
      )}
      {body === 'chat' && <Composer />}
    </main>
  );
}
