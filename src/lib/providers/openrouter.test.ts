import { describe, expect, it } from 'vitest';
import { openrouterPreset } from './presets/openrouter';
import { buildChatBody } from './openai-compatible';
import type { ProviderConfig } from './types';

const cfg: ProviderConfig = { id: 'openrouter', ...openrouterPreset.defaults };

describe('OpenRouter preset', () => {
  it('maps model info (prices converted to per million tokens)', () => {
    const m = openrouterPreset.mapModel!(
      {
        id: 'meta-llama/llama-4:free',
        name: 'Llama 4 (free)',
        context_length: 131072,
        pricing: { prompt: '0.0000002', completion: '0.0000006' },
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['tools', 'reasoning', 'temperature']
      },
      'openrouter'
    )!;
    expect(m.pricing?.inputPerMTok).toBeCloseTo(0.2);
    expect(m.pricing?.outputPerMTok).toBeCloseTo(0.6);
    expect(m.capabilities).toMatchObject({ vision: true, tools: true, reasoning: true });
    expect(m.privacy).toBe('unknown');
    expect(m.tags).toContain('free');
  });
  it('excludes models that do not output text', () => {
    expect(openrouterPreset.mapModel!({ id: 'x/img', architecture: { output_modalities: ['image'] } }, 'openrouter')).toBeNull();
  });
  it('denies data collection by default and converts reasoning_effort to reasoning.effort', () => {
    const body = buildChatBody(cfg, openrouterPreset, {
      model: 'm',
      messages: [],
      params: { reasoningEffort: 'high' },
      signal: new AbortController().signal
    });
    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.venice_parameters).toBeUndefined();
  });
  it('routes by the connection settings: 4-bit versions skipped by default, cheapest first when asked', () => {
    const request = (settings: Record<string, boolean>) =>
      buildChatBody(cfg, openrouterPreset, {
        model: 'm',
        messages: [],
        providerOptions: { openrouter: openrouterPreset.requestOptions!({ purpose: 'chat', webSearch: 'off', settings })! },
        signal: new AbortController().signal
      });
    const byDefault = request({ noLowBits: true, cheapest: false });
    expect(byDefault.provider.data_collection).toBe('deny');
    expect(byDefault.provider.quantizations).toContain('fp8');
    expect(byDefault.provider.quantizations).toContain('unknown');
    expect(byDefault.provider.quantizations).not.toContain('fp4');
    expect(byDefault.provider.quantizations).not.toContain('int4');
    expect(byDefault.provider.sort).toBeUndefined();
    expect(request({ noLowBits: false, cheapest: true }).provider).toEqual({ data_collection: 'deny', sort: 'price' });
  });
});
