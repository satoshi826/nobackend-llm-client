// Accounts whose API keys we hold (LLM providers + external services used by tools).
// The key vault attaches keys only for accounts listed here, and only to the hosts listed here.
// The app cannot change this (fixed at build time).
import { PRESETS } from '../providers/registry';
import { SERVICES } from '../tools/services';
import type { ProviderConfig, ProviderPreset } from '../providers/types';

export interface Account {
  id: string;
  label: string;
  /** Hosts the key may be attached to */
  host: string;
  kind: 'llm' | 'tool';
  /** Usable without a key (with limits) */
  keyOptional: boolean;
  keyGuide: string;
  /** How to verify the key (LLM providers only) */
  preset?: ProviderPreset;
  /** Header the key goes in (default: Authorization: Bearer) */
  keyHeader: { name: string; prefix: string };
}

const BEARER = { name: 'Authorization', prefix: 'Bearer ' };

function hostOf(url: string): string {
  return new URL(url).host;
}

export const ACCOUNTS: Record<string, Account> = {};
for (const [id, p] of Object.entries(PRESETS)) {
  ACCOUNTS[id] = {
    id,
    label: p.label,
    host: hostOf(p.defaults.baseUrl),
    kind: 'llm',
    keyOptional: !!p.keyOptional,
    // Read through so it follows the current language
    get keyGuide() {
      return p.keyGuide ?? '';
    },
    preset: p,
    keyHeader: p.keyHeader ? { name: p.keyHeader.name, prefix: p.keyHeader.prefix ?? '' } : BEARER
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
    get keyGuide() {
      return s.keyGuide;
    },
    keyHeader: BEARER
  };
}

export const ACCOUNT_IDS = Object.keys(ACCOUNTS);

export function accountById(id: string): Account | undefined {
  // Own keys only: an id such as '__proto__' must not find anything
  return Object.hasOwn(ACCOUNTS, id) ? ACCOUNTS[id] : undefined;
}

export function providerConfigOf(id: string): ProviderConfig | undefined {
  const p = PRESETS[id];
  return p ? { id, ...p.defaults } : undefined;
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
