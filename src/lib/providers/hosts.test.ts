import { describe, expect, it } from 'vitest';
import { cerebrasPreset, chutesPreset, deepinfraPreset, nanogptPreset, novitaPreset, togetherPreset } from './presets/hosts';
import { appDirectOrigins, keyedProviderOrigins } from './endpoints';
import { joinUrl } from './openai-compatible';

// Trimmed entries in the shapes the providers' model lists had on 2026-11-26
describe('open-model hosts', () => {
  it('read NanoGPT models, skipping image-only and unavailable ones, with zero-data-retention as private', () => {
    const m = nanogptPreset.mapModel!(
      { id: 'a/b', name: 'B', context_length: 1048576, max_output_tokens: 131072, architecture: { output_modalities: ['text'] }, capabilities: { vision: true, reasoning: true, tool_calling: true }, pricing: { prompt: 0.25, completion: 1 }, privacy: { zero_data_retention: true } },
      'nanogpt'
    )!;
    expect(m).toMatchObject({ id: 'a/b', name: 'B', contextLength: 1048576, privacy: 'private', capabilities: { tools: true, vision: true, reasoning: true }, pricing: { inputPerMTok: 0.25, outputPerMTok: 1 } });
    expect(nanogptPreset.mapModel!({ id: 'img', architecture: { output_modalities: ['image'] } }, 'nanogpt')).toBeNull();
    expect(nanogptPreset.mapModel!({ id: 'gone', available: false }, 'nanogpt')).toBeNull();
  });
  it('read DeepInfra chat models only, with their prices', () => {
    expect(deepinfraPreset.mapModel!({ id: 'zai-org/GLM-5.3', metadata: { context_length: 1048576, pricing: { input_tokens: 0.9, output_tokens: 4, cache_read_tokens: 0.2 }, tags: ['chat', 'reasoning'] } }, 'deepinfra')).toMatchObject({
      capabilities: { reasoning: true },
      pricing: { inputPerMTok: 0.9, outputPerMTok: 4, cachedInputPerMTok: 0.2 }
    });
    expect(deepinfraPreset.mapModel!({ id: 'Bria/fibo', metadata: { tags: ['image-gen'] } }, 'deepinfra')).toBeNull();
  });
  it('read Cerebras per-token prices as per-million, from the list beside /v1', () => {
    expect(cerebrasPreset.mapModel!({ id: 'gpt-oss-120b', name: 'GPT OSS', pricing: { prompt: '0.00000035', completion: '0.00000075' }, capabilities: { tools: true, reasoning: true }, limits: { max_context_length: 131072 } }, 'cerebras')!.pricing).toEqual({
      inputPerMTok: 0.35,
      outputPerMTok: 0.75,
      currency: 'USD'
    });
    expect(joinUrl('https://api.cerebras.ai/v1', cerebrasPreset.modelsPath!)).toBe('https://api.cerebras.ai/public/v1/models');
  });
  it('read Novita chat models with decimal prices', () => {
    const m = novitaPreset.mapModel!({ id: 't/hy4', model_type: 'chat', status: 1, display_name: 'Hy4', context_size: 1000000, features: ['function-calling', 'reasoning'], input_modalities: ['text', 'image'], pricing: { prompt: { price_per_m_decimal: '0.035' }, completion: { price_per_m_decimal: '0.1405' } } }, 'novita')!;
    expect(m).toMatchObject({ name: 'Hy4', capabilities: { tools: true, vision: true, reasoning: true }, pricing: { inputPerMTok: 0.035, outputPerMTok: 0.1405 } });
    expect(novitaPreset.mapModel!({ id: 'e', model_type: 'embedding' }, 'novita')).toBeNull();
  });
  it('mark Chutes confidential-computing models as private', () => {
    expect(chutesPreset.mapModel!({ id: 'Q/Q-TEE', pricing: { prompt: 0.039, completion: 1.25 }, supported_features: ['tools'], confidential_compute: true, output_modalities: ['text'] }, 'chutes')!.privacy).toBe('private');
  });
  it('read Together chat models (its list needs a key)', () => {
    expect(togetherPreset.modelsNeedKey).toBe(true);
    expect(togetherPreset.mapModel!({ id: 'm', type: 'chat', pricing: { input: 0.2, output: 0.6 } }, 'together')!.pricing).toMatchObject({ inputPerMTok: 0.2 });
    expect(togetherPreset.mapModel!({ id: 'img', type: 'image' }, 'together')).toBeNull();
  });
  it('let the app fetch keyless model lists directly, and the vault send keys to every host', () => {
    const direct = appDirectOrigins({});
    for (const o of ['https://api.nano-gpt.com', 'https://api.deepinfra.com', 'https://api.cerebras.ai', 'https://api.novita.ai', 'https://llm.chutes.ai']) expect(direct).toContain(o);
    expect(direct).not.toContain('https://api.together.ai');
    expect(keyedProviderOrigins({})).toContain('https://api.together.ai');
  });
});
