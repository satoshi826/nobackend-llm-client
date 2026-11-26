// Provider balance, read from response headers or a balance API: warn when it drops more than this app spent
import { computed, signal } from '@preact/signals';
import { initialBalanceState, observeBalance, recordSpend, type BalanceState } from '../lib/chat/balance';
import { PRESETS } from '../lib/providers/registry';
import { joinUrl } from '../lib/providers/openai-compatible';
import { vaultTransport as transport } from '../lib/vault/client';
import { authFor, keyReady } from './keys';
import { providerById, providers } from './models';

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

/** Ask a provider's balance API (through the key vault); failures are ignored, the balance is optional */
export async function fetchBalance(providerId: string): Promise<void> {
  const cfg = providerById(providerId);
  const api = cfg && PRESETS[cfg.preset]?.balanceApi;
  if (!cfg || !api || !keyReady(providerId)) return;
  try {
    const res = await transport.fetch(joinUrl(cfg.baseUrl, api.path), { method: api.method ?? 'GET', headers: { Accept: 'application/json' } }, authFor(providerId));
    if (!res.ok) return;
    const usd = api.read(await res.json());
    if (usd !== undefined) observeProviderBalance(providerId, usd);
  } catch {
    /* no balance this time */
  }
}

/** Balances of every provider with a key and a balance API */
export function fetchBalances(): Promise<void[]> {
  return Promise.all(providers.value.filter((p) => PRESETS[p.preset]?.balanceApi && keyReady(p.id)).map((p) => fetchBalance(p.id)));
}
