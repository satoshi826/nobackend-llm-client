// Accounts whose API keys we hold (LLM providers + external services used by tools).
// The key vault attaches keys only for accounts listed here, and only to the hosts listed here.
// The app cannot change this (fixed at build time). Built from data alone (no provider code), so the vault page stays small.
import { ENDPOINTS } from '../providers/endpoints';
import { SERVICES } from '../tools/services';
import type { ProviderConfig } from '../providers/types';

export interface Account {
  id: string;
  label: string;
  /** Hosts the key may be attached to */
  host: string;
  kind: 'llm' | 'tool';
  /** Usable without a key (with limits) */
  keyOptional: boolean;
  /** Header the key goes in (default: Authorization: Bearer) */
  keyHeader: { name: string; prefix: string };
  /** A request that fails without a valid key: the vault tries a new key with it before saving it (LLM providers only) */
  keyCheck?: { url: string; headers: Record<string, string> };
}

const BEARER = { name: 'Authorization', prefix: 'Bearer ' };

function hostOf(url: string): string {
  return new URL(url).host;
}

export const ACCOUNTS: Record<string, Account> = {};
for (const e of Object.values(ENDPOINTS)) {
  ACCOUNTS[e.id] = {
    id: e.id,
    label: e.label,
    host: hostOf(e.baseUrl),
    kind: 'llm',
    keyOptional: e.keyOptional,
    keyHeader: e.keyHeader ? { name: e.keyHeader.name, prefix: e.keyHeader.prefix ?? '' } : BEARER,
    ...(e.keyCheck ? { keyCheck: { url: new URL(e.keyCheck, `${e.baseUrl}/`).toString(), headers: e.headers ?? {} } } : {})
  };
}
for (const [id, s] of Object.entries(SERVICES)) {
  ACCOUNTS[id] = {
    id,
    get label() {
      return s.label;
    },
    host: hostOf(s.baseUrl),
    kind: 'tool',
    keyOptional: s.keyOptional,
    keyHeader: BEARER
  };
}

export const ACCOUNT_IDS = Object.keys(ACCOUNTS);

export function accountById(id: string): Account | undefined {
  // Own keys only: an id such as '__proto__' must not find anything
  return Object.hasOwn(ACCOUNTS, id) ? ACCOUNTS[id] : undefined;
}

/** A provider's connection (nothing for tool services) */
export function providerConfigOf(id: string): ProviderConfig | undefined {
  const e = Object.hasOwn(ENDPOINTS, id) ? ENDPOINTS[id] : undefined;
  return e && { id, name: e.name, kind: e.kind, baseUrl: e.baseUrl, headers: e.headers };
}

/** Key status (what the vault tells the app; never the key itself) */
export interface KeyStatus {
  present: boolean;
  /** Stored encrypted with the passphrase */
  encrypted: boolean;
  locked: boolean;
}

export const EMPTY_KEY_STATUS: KeyStatus = { present: false, encrypted: false, locked: false };

/** State of the whole vault (the vault has a single passphrase) */
export interface VaultState {
  hasPassphrase: boolean;
  locked: boolean;
  /** ID that changes every time the passphrase is set or changed (tells the app to rewrap its data key). Not a secret */
  passphraseId: string | null;
}

export const EMPTY_VAULT_STATE: VaultState = { hasPassphrase: false, locked: false, passphraseId: null };
