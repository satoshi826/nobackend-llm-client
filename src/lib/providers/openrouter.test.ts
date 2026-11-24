import { describe, expect, it } from 'vitest';
import { openrouterPreset } from './presets/openrouter';
import { buildChatBody } from './openai-compatible';
import type { ProviderConfig } from './types';

const cfg: ProviderConfig = { id: 'openrouter', ...openrouterPreset.defaults };

describe('OpenRouter プリセット', () => {
  it('モデル情報を写像する（価格は 100 万トークンあたりに換算）', () => {
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
  it('テキストを出力しないモデルは除外', () => {
    expect(openrouterPreset.mapModel!({ id: 'x/img', architecture: { output_modalities: ['image'] } }, 'openrouter')).toBeNull();
  });
  it('既定でデータ収集を拒否し、reasoning_effort を reasoning.effort に変換する', () => {
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
});
