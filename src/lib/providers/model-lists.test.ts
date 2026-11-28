// What each provider's model list tells, as the app reads it. The model objects follow the providers' real responses
// (fetched 2026-11-28, or their API references where a key is needed)
import { describe, expect, it } from 'vitest';
import { venicePreset } from './presets/venice';
import { openrouterPreset } from './presets/openrouter';
import { cerebrasPreset, nanogptPreset } from './presets/hosts';
import { anthropicPreset, deepseekPreset, openaiPreset } from './presets/more';

describe('model lists', () => {
  it('Venice: the price of cached input', () => {
    const m = venicePreset.mapModel!({ id: 'v', model_spec: { name: 'V', pricing: { input: { usd: 2.5 }, cache_input: { usd: 0.125 }, output: { usd: 12.5 } } } }, 'venice')!;
    expect(m.pricing).toMatchObject({ inputPerMTok: 2.5, cachedInputPerMTok: 0.125, outputPerMTok: 12.5 });
  });

  it("OpenRouter: the model's own effort levels, the cache price and the end date", () => {
    const m = openrouterPreset.mapModel!(
      {
        id: 'a/b',
        supported_parameters: ['tools', 'reasoning'],
        reasoning: { supported_efforts: ['max', 'xhigh', 'high', 'low', 'none'], default_effort: 'high' },
        pricing: { prompt: '0.000008', completion: '0.000008', input_cache_read: '0.000002' },
        expiration_date: '2027-02-10'
      },
      'openrouter'
    )!;
    expect(m.capabilities.reasoningEffort).toEqual(['max', 'xhigh', 'high', 'low', 'none']);
    expect(m.pricing).toMatchObject({ inputPerMTok: 8, cachedInputPerMTok: 2 });
    expect(m.deprecated).toEqual({ date: '2027-02-10' });
    // A reasoning model without listed levels gets the usual three
    expect(openrouterPreset.mapModel!({ id: 'c/d', supported_parameters: ['reasoning'] }, 'openrouter')!.capabilities.reasoningEffort).toEqual(['low', 'medium', 'high']);
  });

  it('NanoGPT: private only when every route keeps no data; the cache price per million; effort levels', () => {
    const base = { id: 'n', pricing: { prompt: 0.25, completion: 1, cacheReadInputPer1kTokens: 0.00003 }, reasoning_efforts: ['low', 'high'] };
    const all = nanogptPreset.mapModel!({ ...base, privacy: { zero_data_retention: 'unknown', providers: [{ zdr_policy_eligible: true }, { zdr_policy_eligible: true }] } }, 'nanogpt')!;
    expect(all.privacy).toBe('private');
    expect(all.pricing?.cachedInputPerMTok).toBeCloseTo(0.03);
    expect(all.capabilities.reasoningEffort).toEqual(['low', 'high']);
    expect(nanogptPreset.mapModel!({ ...base, privacy: { zero_data_retention: 'unknown', providers: [{ zdr_policy_eligible: true }, { zdr_policy_eligible: false }] } }, 'nanogpt')!.privacy).toBe('unknown');
    expect(nanogptPreset.mapModel!({ ...base, privacy: { zero_data_retention: 'unknown', providers: [] } }, 'nanogpt')!.privacy).toBe('unknown');
  });

  it('Cerebras: a model being retired is marked as one', () => {
    expect(cerebrasPreset.mapModel!({ id: 'old', deprecated: true }, 'cerebras')!.deprecated).toEqual({});
    expect(cerebrasPreset.mapModel!({ id: 'new', deprecated: false }, 'cerebras')!.deprecated).toBeUndefined();
  });

  it("Anthropic: capabilities and retirement from the list; an older list without them keeps today's set", () => {
    const yes = { supported: true };
    const no = { supported: false };
    const m = anthropicPreset.mapModel!(
      { id: 'claude-x', display_name: 'X', capabilities: { image_input: no, structured_outputs: yes, server_tools: { web_search: yes, supported: true } }, lifecycle: 'deprecated', retires_at: '2027-01-15T00:00:00Z' },
      'anthropic'
    )!;
    expect(m.capabilities).toEqual({ tools: true, vision: false, webSearch: true, jsonSchema: true });
    expect(m.deprecated).toEqual({ date: '2027-01-15' });
    const old = anthropicPreset.mapModel!({ id: 'claude-y', display_name: 'Y' }, 'anthropic')!;
    expect(old.capabilities).toMatchObject({ tools: true, vision: true, webSearch: true });
    expect(old.deprecated).toBeUndefined();
  });

  it('DeepSeek: name, context, output, images and thinking from the list', () => {
    const m = deepseekPreset.mapModel!(
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, max_output_tokens: 393216, input_modalities: ['text', 'image'], effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
      'deepseek'
    )!;
    expect(m).toMatchObject({ name: 'DeepSeek-V4.1-Flash', contextLength: 1048576, maxOutputTokens: 393216, capabilities: { vision: true, reasoning: true } });
    expect(deepseekPreset.mapModel!({ id: 'deepseek-v4-pro', input_modalities: ['text'] }, 'deepseek')!.capabilities).toMatchObject({ vision: false, reasoning: false });
  });

  it('OpenAI: the shutdown date', () => {
    expect(openaiPreset.mapModel!({ id: 'gpt-4.1', shutdown_date: '2026-10-23' }, 'openai')!.deprecated).toEqual({ date: '2026-10-23' });
    expect(openaiPreset.mapModel!({ id: 'gpt-5', shutdown_date: null }, 'openai')!.deprecated).toBeUndefined();
  });
});
