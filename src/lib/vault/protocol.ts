// Message format between the key vault (a separate-origin iframe) and the app.
// The app never holds API keys; it only asks "attach this provider's key and send to this URL".

import type { KeyStatus, VaultState } from '../keys/accounts';
import { PRESETS } from '../providers/registry';

export const VAULT_PROTOCOL = 'nbl-vault/1';


/** App → vault (via MessagePort) */
export type ToVault =
  | { type: 'fetch'; id: string; providerId: string; url: string; method: 'GET' | 'POST'; headers: [string, string][]; body?: string }
  | { type: 'abort'; id: string }
  | { type: 'status' }
  /** Delete all keys / lock (ack when done) */
  | { type: 'clear-all'; id: string }
  | { type: 'lock'; id: string }
  /** Wrap / unwrap the app's data key with the passphrase (only while unlocked; answered with result) */
  | { type: 'wrap-data-key'; id: string; raw: string }
  | { type: 'unwrap-data-key'; id: string; blob: unknown };

/** Vault → app (via MessagePort) */
export type FromVault =
  | { type: 'status'; providers: Record<string, KeyStatus>; vault: VaultState }
  | { type: 'ack'; id: string }
  | { type: 'result'; id: string; ok: boolean; value?: unknown; message?: string }
  | { type: 'head'; id: string; status: number; statusText: string; headers: [string, string][] }
  | { type: 'chunk'; id: string; chunk: Uint8Array }
  | { type: 'end'; id: string }
  | { type: 'error'; id: string; kind: string; message: string };

/** Response headers the vault may relay (nothing related to keys or cookies) */
export const PASSTHROUGH_HEADERS = [
  ...new Set(['content-type', 'retry-after', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens', ...Object.values(PRESETS).flatMap((p) => p.responseHeaders ?? [])].map((h) => h.toLowerCase()))
];
