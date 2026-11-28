// What the chat needs before a message can be sent: a provider, its key (or the vault unlocked), then the one-time
// offer of a passphrase. A new chat shows these first; a saved conversation opens to its messages and shows them only
// once the user sends (a backup imported into a fresh browser is readable before any key is entered)
import { computed, effect, signal } from '@preact/signals';
import { currentConv, currentId, isDraft } from './conversations';
import { keyStatus, vaultState } from './keys';
import { enabledProviders } from './models';
import { settings } from './settings';
import { accountById } from '../lib/keys/accounts';

export type ChatSetup = 'choose' | 'key' | 'passphrase';

/** The provider the chat sends to (for a draft whose model list has not arrived yet, the first enabled provider) */
export const chatProviderId = computed(() => {
  const provs = enabledProviders.value;
  const conv = currentConv.value;
  return provs.some((p) => p.id === conv.providerId) || !isDraft.value ? conv.providerId : (provs[0]?.id ?? '');
});

/** What is still missing before the current conversation can send; null when nothing is */
export const chatSetup = computed<ChatSetup | null>(() => {
  const id = chatProviderId.value;
  const st = keyStatus(id);
  if (enabledProviders.value.length === 0) return 'choose';
  if ((!st.present && !accountById(id)?.keyOptional) || st.locked) return 'key';
  if (st.present && !vaultState.value.hasPassphrase && !settings.value.passphrasePrompted) return 'passphrase';
  return null;
});

/** The saved conversation whose send asked for the setup */
const askedIn = signal<string | null>(null);
effect(() => {
  // Opening another conversation goes back to reading
  if (askedIn.peek() !== currentId.value) askedIn.value = null;
});

/** The setup screen to show in place of the conversation, if any */
export const shownSetup = computed(() => {
  const s = chatSetup.value;
  return s && (isDraft.value || askedIn.value === currentId.value) ? s : null;
});

/**
 * Before a message is sent: when the chat cannot send yet (no provider or key), show what is missing and return true
 * (the message is not sent). The passphrase offer never holds a message back
 */
export function needsSetup(): boolean {
  const s = chatSetup.value;
  if (s !== 'choose' && s !== 'key') return false;
  askedIn.value = currentId.value;
  return true;
}
