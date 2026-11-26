import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsFrom } from './settings';
import { PRESETS } from '../lib/providers/registry';
import { PASSTHROUGH_HEADERS } from '../lib/vault/protocol';

describe('stored settings', () => {
  it('start with no provider for a fresh install', () => {
    expect(settingsFrom({}).enabledProviders).toEqual([]);
  });
  it('keep what was stored and fill the rest from the defaults', () => {
    expect(settingsFrom({ enabledProviders: ['openrouter'] }).enabledProviders).toEqual(['openrouter']);
    expect(settingsFrom({ toolPermissions: { web_search: 'allow' } }).toolPermissions).toEqual({ ...DEFAULT_SETTINGS.toolPermissions, web_search: 'allow' });
  });
});

describe('provider-specific behaviour lives in presets', () => {
  it('Venice builds its own request options', () => {
    const v = PRESETS.venice;
    expect(v.nativeWebSearch?.supports('m')).toBe(true);
    expect(v.requestOptions?.({ purpose: 'chat', webSearch: 'auto', settings: { includeSystemPrompt: false } })).toEqual({ include_venice_system_prompt: false, enable_web_search: 'auto' });
    expect(v.requestOptions?.({ purpose: 'chat', webSearch: 'off', settings: { includeSystemPrompt: true } })).toEqual({ include_venice_system_prompt: true });
    expect(v.requestOptions?.({ purpose: 'summary', webSearch: 'off', settings: {} })).toMatchObject({ strip_thinking_response: true });
  });
  it('OpenRouter has no Venice options', () => {
    const o = PRESETS.openrouter;
    expect(o.requestOptions).toBeUndefined();
  });
  it('the vault passes through headers declared by presets', () => {
    expect(PASSTHROUGH_HEADERS).toContain('x-venice-balance-usd');
    expect(PASSTHROUGH_HEADERS).toContain('content-type');
    expect(PASSTHROUGH_HEADERS).not.toContain('set-cookie');
  });
});
