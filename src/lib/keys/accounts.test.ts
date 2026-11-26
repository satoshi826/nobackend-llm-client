import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_IDS, ACCOUNTS, accountById, providerConfigOf } from './accounts';
import { PRESETS } from '../providers/registry';
import { keyedProviderOrigins } from '../providers/endpoints';
import { setLang } from '../i18n';

afterEach(() => setLang('ja'));

describe('accounts', () => {
  it('has one LLM account per preset, bound to the host of its base URL, and one for each tool service', () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      expect(ACCOUNTS[id]).toMatchObject({ id, kind: 'llm', host: new URL(p.defaults.baseUrl).host, keyOptional: !!p.keyOptional, preset: p });
    }
    expect(accountById('tavily')).toMatchObject({ kind: 'tool', host: 'api.tavily.com', keyOptional: false });
    expect(ACCOUNT_IDS.sort()).toEqual([...Object.keys(PRESETS), 'tavily'].sort());
    expect(accountById('nope')).toBeUndefined();
  });

  it('sends keys only to provider hosts the vault is allowed to reach', () => {
    const allowed = new Set(keyedProviderOrigins({}).map((o) => new URL(o).host));
    for (const a of Object.values(ACCOUNTS)) if (a.kind === 'llm') expect(allowed.has(a.host)).toBe(true);
  });

  it('puts the key in the header each provider expects, Bearer by default', () => {
    expect(accountById('venice')!.keyHeader).toEqual({ name: 'Authorization', prefix: 'Bearer ' });
    expect(accountById('anthropic')!.keyHeader).toEqual({ name: 'x-api-key', prefix: '' });
    expect(accountById('gemini')!.keyHeader).toEqual({ name: 'x-goog-api-key', prefix: '' });
    expect(accountById('tavily')!.keyHeader).toEqual({ name: 'Authorization', prefix: 'Bearer ' });
  });

  it('shows labels and key guides in the current language', () => {
    setLang('ja');
    const ja = accountById('tavily')!.keyGuide;
    setLang('en');
    expect(accountById('tavily')!.keyGuide).not.toBe(ja);
  });
});

describe('providerConfigOf', () => {
  it('builds a provider from its preset defaults, and nothing for tool services', () => {
    expect(providerConfigOf('venice')).toEqual({ id: 'venice', ...PRESETS.venice.defaults });
    expect(providerConfigOf('tavily')).toBeUndefined();
  });
});
