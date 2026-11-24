import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings } from './settings';
import { PRESETS } from '../lib/providers/registry';
import { PASSTHROUGH_HEADERS } from '../lib/vault/protocol';

describe('settings migration', () => {
  it('starts with no provider for a fresh install', () => {
    expect(migrateSettings({}).enabledProviders).toEqual([]);
    expect(migrateSettings({}).searchEngine).toBe('builtin');
  });
  it('keeps Venice for people who used the Venice-first version', () => {
    const s = migrateSettings({ lastModelId: 'x', includeVeniceSystemPrompt: true, searchEngine: 'venice', showAnonymized: true });
    expect(s.enabledProviders).toEqual(['venice']);
    expect(s.providerSettings).toEqual({ venice: { includeSystemPrompt: true } });
    expect(s.searchEngine).toBe('builtin');
    expect('includeVeniceSystemPrompt' in s).toBe(false);
    expect('showAnonymized' in s).toBe(false);
  });
  it('leaves an explicit provider list alone', () => {
    expect(migrateSettings({ enabledProviders: ['openrouter'] }).enabledProviders).toEqual(['openrouter']);
    expect(migrateSettings({ toolPermissions: { web_search: 'allow' } }).toolPermissions).toEqual({ ...DEFAULT_SETTINGS.toolPermissions, web_search: 'allow' });
  });
});

describe('provider-specific behaviour lives in presets', () => {
  it('Venice builds its own request options', () => {
    const v = PRESETS.venice;
    expect(v.features?.builtInWebSearch).toBe(true);
    expect(v.requestOptions?.({ purpose: 'chat', webSearch: 'auto', settings: { includeSystemPrompt: false } })).toEqual({ include_venice_system_prompt: false, enable_web_search: 'auto' });
    expect(v.requestOptions?.({ purpose: 'chat', webSearch: 'off', settings: { includeSystemPrompt: true } })).toEqual({ include_venice_system_prompt: true });
    expect(v.requestOptions?.({ purpose: 'summary', webSearch: 'off', settings: {} })).toMatchObject({ strip_thinking_response: true });
  });
  it('OpenRouter has no built-in search or Venice options', () => {
    const o = PRESETS.openrouter;
    expect(o.features?.builtInWebSearch).toBeFalsy();
    expect(o.requestOptions).toBeUndefined();
  });
  it('the vault passes through headers declared by presets', () => {
    expect(PASSTHROUGH_HEADERS).toContain('x-venice-balance-usd');
    expect(PASSTHROUGH_HEADERS).toContain('content-type');
    expect(PASSTHROUGH_HEADERS).not.toContain('set-cookie');
  });
});
