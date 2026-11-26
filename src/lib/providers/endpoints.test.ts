import { describe, expect, it } from 'vitest';
import { appDirectOrigins, BUILTIN_BASE_URLS, builtinBaseUrl, keyedProviderOrigins, parseCustomProviders } from './endpoints';

const one = (def: object) => JSON.stringify([def]);

describe('built-in base URLs', () => {
  it('take an override from the environment, else the default', () => {
    expect(builtinBaseUrl('venice', {})).toBe(BUILTIN_BASE_URLS.venice.url);
    expect(builtinBaseUrl('venice', { VITE_VENICE_BASE_URL: 'http://localhost:8787/api/v1' })).toBe('http://localhost:8787/api/v1');
    expect(builtinBaseUrl('nope', {})).toBe('');
  });
});

describe('parseCustomProviders', () => {
  it('reads nothing from an unset or blank value', () => {
    expect(parseCustomProviders(undefined)).toEqual([]);
    expect(parseCustomProviders('  ')).toEqual([]);
  });

  it('normalizes the label and the base URL', () => {
    const [p] = parseCustomProviders(one({ id: 'my-llm', label: `  ${'L'.repeat(60)}  `, baseUrl: 'https://llm.example.com/v1///' }));
    expect(p).toEqual({ id: 'my-llm', label: 'L'.repeat(40), baseUrl: 'https://llm.example.com/v1', keyOptional: false, publicModels: false });
    expect(parseCustomProviders(one({ id: 'x', label: '   ', baseUrl: 'https://x.example.com' }))[0].label).toBe('x');
  });

  it('lets a key-optional provider fetch its model list without a key', () => {
    expect(parseCustomProviders(one({ id: 'x', baseUrl: 'https://x.example.com', keyOptional: true }))[0]).toMatchObject({ keyOptional: true, publicModels: true });
  });

  it('allows plain http only for this machine', () => {
    for (const host of ['localhost:11434', '127.0.0.1:8080', '[::1]:1234']) expect(parseCustomProviders(one({ id: 'local', baseUrl: `http://${host}/v1` }))).toHaveLength(1);
    expect(() => parseCustomProviders(one({ id: 'x', baseUrl: 'http://192.168.0.2/v1' }))).toThrow();
    expect(() => parseCustomProviders(one({ id: 'x', baseUrl: 'ftp://x.example.com' }))).toThrow();
  });

  it('rejects bad ids, ids already taken, and URLs with a query, a fragment or credentials', () => {
    for (const id of ['', 'Upper', '-lead', 'a'.repeat(33), 'tavily', 'openai', 7]) expect(() => parseCustomProviders(one({ id, baseUrl: 'https://x.example.com' }))).toThrow();
    expect(() => parseCustomProviders(JSON.stringify([{ id: 'a', baseUrl: 'https://a.example.com' }, { id: 'a', baseUrl: 'https://b.example.com' }]))).toThrow();
    for (const baseUrl of ['https://x.example.com/v1?key=1', 'https://x.example.com/#a', 'https://user@x.example.com', 'not a url']) expect(() => parseCustomProviders(one({ id: 'x', baseUrl }))).toThrow();
    expect(() => parseCustomProviders('{"id":"x"}')).toThrow();
  });
});

describe('origins', () => {
  it('lets the app call only providers with public model lists directly, while the vault may reach every provider', () => {
    const env = { VITE_CUSTOM_PROVIDERS: JSON.stringify([{ id: 'open', baseUrl: 'https://open.example.com/v1', publicModels: true }, { id: 'closed', baseUrl: 'https://closed.example.com/v1' }]) };
    const direct = appDirectOrigins(env);
    const keyed = keyedProviderOrigins(env);
    expect(direct).toContain('https://open.example.com');
    expect(direct).not.toContain('https://closed.example.com');
    expect(direct).not.toContain('https://api.anthropic.com');
    expect(keyed).toEqual(expect.arrayContaining(['https://open.example.com', 'https://closed.example.com', 'https://api.anthropic.com']));
    expect(new Set(keyed).size).toBe(keyed.length);
  });
});
