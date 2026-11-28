import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_IDS, ACCOUNTS, accountById, providerConfigOf } from './accounts';
import { PRESETS } from '../providers/registry';
import { ENDPOINTS, keyedProviderOrigins } from '../providers/endpoints';
import { setLang } from '../i18n';

afterEach(() => setLang('ja'));

describe('accounts', () => {
  it('has one LLM account per preset, bound to the host of its base URL, and one for each tool service', () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      expect(ACCOUNTS[id]).toMatchObject({ id, kind: 'llm', label: p.label, host: new URL(ENDPOINTS[id].baseUrl).host, keyOptional: ENDPOINTS[id].keyOptional });
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

  it('shows labels in the current language', () => {
    setLang('ja');
    const ja = accountById('tavily')!.label;
    setLang('en');
    expect(accountById('tavily')!.label).not.toBe(ja);
  });

  it('checks a new key with a request on the provider’s own host, with the headers it needs', () => {
    expect(accountById('anthropic')!.keyCheck).toEqual({ url: 'https://api.anthropic.com/v1/models?limit=1', headers: ENDPOINTS.anthropic.headers });
    expect(accountById('venice')!.keyCheck?.url).toBe('https://api.venice.ai/api/v1/api_keys/rate_limits');
    expect(accountById('nanogpt')!.keyCheck).toBeUndefined();
    expect(accountById('tavily')!.keyCheck).toBeUndefined();
  });
});

describe('providerConfigOf', () => {
  it('builds a provider from its connection, and nothing for tool services', () => {
    expect(providerConfigOf('anthropic')).toEqual({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', preset: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', headers: ENDPOINTS.anthropic.headers });
    expect(providerConfigOf('tavily')).toBeUndefined();
  });
});

describe('looking accounts up', () => {
  it('finds only accounts the app defines, not names every object has', () => {
    expect(accountById('openrouter')?.host).toBe('openrouter.ai');
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(accountById(id)).toBeUndefined();
  });
});
