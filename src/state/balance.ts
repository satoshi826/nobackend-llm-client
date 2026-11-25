// Provider balance (only providers that return it in response headers): warn when it drops more than this app spent
import { computed, signal } from '@preact/signals';
import { initialBalanceState, observeBalance, recordSpend, type BalanceState } from '../lib/chat/balance';

// ---- Balance (only providers that return it in response headers): warn if it drops more than this app spent ----
export const balances = signal<Record<string, BalanceState>>({});
export const BALANCE_ALERT_USD = 0.5;
/** Providers whose balance dropped by an unexplained amount */
export const balanceAlerts = computed(() => Object.entries(balances.value).filter(([, b]) => b.unexplainedUsd >= BALANCE_ALERT_USD));

export function updateBalance(providerId: string, fn: (b: BalanceState) => BalanceState) {
  balances.value = { ...balances.value, [providerId]: fn(balances.value[providerId] ?? initialBalanceState()) };
}

/** Record spend / observed balance from work outside the chat loop (image jobs), so balance alerts stay accurate */
export function recordProviderSpend(providerId: string, usd: number) {
  if (balances.value[providerId]) updateBalance(providerId, (b) => recordSpend(b, usd));
}
/** Start the balance comparison afresh (after spend whose exact price is unknown, e.g. image jobs) */
export function resetProviderBalanceBaseline(providerId: string) {
  const b = balances.value[providerId];
  if (b) balances.value = { ...balances.value, [providerId]: { ...b, last: null, spentSinceLast: 0 } };
}
export function observeProviderBalance(providerId: string, usd: number) {
  updateBalance(providerId, (b) => observeBalance(b, usd));
}
