// Provider balance: the latest one each provider reported (with an answer, or asked of its balance API), for the
// usage tab
import { signal } from '@preact/signals';
import { PRESETS } from '../lib/providers/registry';
import { joinUrl } from '../lib/providers/openai-compatible';
import { vaultTransport as transport } from '../lib/vault/client';
import { authFor, keyReady } from './keys';
import { providerById, providers } from './models';

/** A provider's balance in USD and when it was read */
export interface BalanceReading {
  usd: number;
  at: number;
}

export const balances = signal<Record<string, BalanceReading>>({});

export function observeProviderBalance(providerId: string, usd: number) {
  balances.value = { ...balances.value, [providerId]: { usd, at: Date.now() } };
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
