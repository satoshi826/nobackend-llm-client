// What each provider's model list tells, as the app reads it. The model objects follow the providers' real responses
// (fetched 2026-11-28, or their API references where a key is needed)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { venicePreset } from './presets/venice';
import { openrouterPreset } from './presets/openrouter';
import { cerebrasPreset, chutesPreset, deepinfraPreset, nanogptPreset, novitaPreset } from './presets/hosts';
import { anthropicPreset, deepseekPreset, groqPreset, openaiPreset } from './presets/more';

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

  it('release dates from unix seconds or a timestamp; none from 0 or a list without them', () => {
    const at = (m: { releasedAt?: number } | null) => (m?.releasedAt === undefined ? undefined : new Date(m.releasedAt).toISOString());
    expect(at(venicePreset.mapModel!({ context_length: 1000000, created: 1794268800, id: 'gemini-4-carbon', model_spec: { name: 'Gemini 4 Carbon' }, type: 'text' }, 'venice'))).toBe('2026-11-10T00:00:00.000Z');
    expect(at(nanogptPreset.mapModel!({ id: 'particle-ai/particle-1', created: 1793232000, name: 'Particle-1', architecture: { output_modalities: ['text'] } }, 'nanogpt'))).toBe('2026-10-29T00:00:00.000Z');
    expect(at(novitaPreset.mapModel!({ created: 1792375957, id: 'deepseek/deepseek-v4.1-flash-1017', model_type: 'chat', status: 1, description: '' }, 'novita'))).toBe('2026-10-19T02:12:37.000Z');
    expect(at(cerebrasPreset.mapModel!({ id: 'gpt-oss-120b', created: 1754438400 }, 'cerebras'))).toBe('2025-08-06T00:00:00.000Z');
    expect(at(chutesPreset.mapModel!({ id: 'Qwen/Qwen4-Max', created: 1795278068, output_modalities: ['text'] }, 'chutes'))).toBe('2026-11-21T16:21:08.000Z');
    expect(at(groqPreset.mapModel!({ id: 'openai/gpt-oss-120b', created: 1754408224, active: true }, 'groq'))).toBe('2025-08-05T15:37:04.000Z');
    expect(at(openaiPreset.mapModel!({ id: 'gpt-5', created: 1754425777 }, 'openai'))).toBe('2025-08-05T20:29:37.000Z');
    expect(at(anthropicPreset.mapModel!({ id: 'claude-x', display_name: 'X', created_at: '2026-02-17T00:00:00Z' }, 'anthropic'))).toBe('2026-02-17T00:00:00.000Z');
    // Cerebras lists some models with 0, DeepInfra every one
    expect(at(cerebrasPreset.mapModel!({ id: 'zai-glm', created: 0 }, 'cerebras'))).toBeUndefined();
    expect(at(deepinfraPreset.mapModel!({ id: 'Sao10K/L3.1-70B-Euryale-v2.2', created: 0, metadata: { tags: ['chat'] } }, 'deepinfra'))).toBeUndefined();
    expect(at(anthropicPreset.mapModel!({ id: 'claude-y', created_at: 'soon' }, 'anthropic'))).toBeUndefined();
  });

  it('OpenRouter: the release date, the knowledge cutoff and the description', () => {
    const m = openrouterPreset.mapModel!(
      {
        id: 'reflection/beam-1.0-501b-a23b',
        name: 'Reflection: Beam 1.0 501B A23B',
        created: 1792160499,
        description: "Beam 1.0 is Reflection's open-weight reasoning model for coding and long-horizon agentic workflows.",
        knowledge_cutoff: '2026-06-30',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] }
      },
      'openrouter'
    )!;
    expect(new Date(m.releasedAt!).toISOString()).toBe('2026-10-16T14:21:39.000Z');
    expect(new Date(m.knowledgeCutoff!).toISOString()).toBe('2026-06-30T00:00:00.000Z');
    expect(m.description).toMatch(/^Beam 1.0/);
    expect(openrouterPreset.mapModel!({ id: 'a/b', created: 1792160499, knowledge_cutoff: null }, 'openrouter')!.knowledgeCutoff).toBeUndefined();
  });

  it('descriptions of the open-model hosts; an empty one is none', () => {
    expect(nanogptPreset.mapModel!({ id: 'n', description: 'Particle-1 is a coding model.' }, 'nanogpt')!.description).toBe('Particle-1 is a coding model.');
    expect(cerebrasPreset.mapModel!({ id: 'gpt-oss-120b', description: 'This model excels at efficient reasoning.' }, 'cerebras')!.description).toBe('This model excels at efficient reasoning.');
    expect(deepinfraPreset.mapModel!({ id: 'd', metadata: { description: 'Euryale 3.1', tags: ['chat'] } }, 'deepinfra')!.description).toBe('Euryale 3.1');
    expect(novitaPreset.mapModel!({ id: 'v', model_type: 'chat', description: '' }, 'novita')!.description).toBeUndefined();
  });

  describe('Chutes: a time-limited price', () => {
    const glm = {
      id: 'zai-org/GLM-5.3',
      created: 1793020700,
      pricing: { prompt: 0.8, completion: 2.5, input_cache_read: 0.16 },
      regular_price: { input: { usd: 1.225, tao: 0.0065 }, output: { usd: 3.85, tao: 0.0205 }, input_cache_read: { usd: 0.245, tao: 0.0013 } },
      regular_price_from: '2026-11-30T16:00:00Z',
      output_modalities: ['text']
    };
    afterEach(() => vi.useRealTimers());

    it('is shown with when it ends while it applies', () => {
      vi.useFakeTimers({ now: Date.parse('2026-11-28T00:00:00Z') });
      expect(chutesPreset.mapModel!(glm, 'chutes')!.pricing).toEqual({ inputPerMTok: 0.8, outputPerMTok: 2.5, cachedInputPerMTok: 0.16, currency: 'USD', saleEndsAt: Date.parse('2026-11-30T16:00:00Z') });
    });
    it('gives way to the regular price once that applies', () => {
      vi.useFakeTimers({ now: Date.parse('2026-11-30T16:00:00Z') });
      expect(chutesPreset.mapModel!(glm, 'chutes')!.pricing).toEqual({ inputPerMTok: 1.225, outputPerMTok: 3.85, cachedInputPerMTok: 0.245, currency: 'USD' });
    });
    it('is an ordinary price without a regular one', () => {
      expect(chutesPreset.mapModel!({ id: 'Qwen/Qwen4-Max', pricing: { prompt: 1.5, completion: 4.5 }, output_modalities: ['text'] }, 'chutes')!.pricing).toEqual({ inputPerMTok: 1.5, outputPerMTok: 4.5, currency: 'USD' });
    });
  });
});
