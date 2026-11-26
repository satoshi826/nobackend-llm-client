// Image providers other than Venice: model mapping, request bodies, costs
import { describe, expect, it } from 'vitest';
import { mapOpenRouterImageModel, openrouterImageProvider, priceFromEndpoints } from './providers/openrouter';
import { buildGeminiImageBody, geminiImageProvider, mapGeminiImageModel } from './providers/gemini';
import { buildOpenAIImageBody, estimateOpenAICost, mapOpenAIImageModel, openaiImageProvider, sizeOf } from './providers/openai';
import { hasOption } from './providers/common';
import type { ImageParams } from '../../lib/db/schema';
import type { ProviderConfig, Transport } from '../../lib/providers/types';

const params = (extra: Partial<ImageParams> = {}): ImageParams => ({ op: 'generate', providerId: 'x', model: 'm', prompt: '猫', variants: 1, safeMode: false, format: 'png', ...extra });
const png = 'iVBORw0KGgo=';
const cfg = (baseUrl: string): ProviderConfig => ({ id: 'p', name: 'p', kind: 'openai-compatible', preset: 'p', baseUrl, modelListMode: 'fetch', enabled: true });
function recorder(reply: (url: string, body: any) => unknown) {
  const calls: { url: string; body: any; auth: unknown }[] = [];
  const t: Transport = {
    async fetch(url, init, auth) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body, auth });
      return new Response(JSON.stringify(reply(url, body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  };
  return { t, calls };
}

describe('OpenRouter image provider', () => {
  it('maps models with their supported parameters', () => {
    const m = mapOpenRouterImageModel({ id: 'a/b', name: 'B', supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] }, seed: { type: 'boolean' }, aspect_ratio: { type: 'enum', values: ['1:1', '16:9', 'auto'] } } })!;
    expect(m.constraints).toMatchObject({ aspectRatios: ['1:1', '16:9'], resolutions: ['1K', '2K'], defaultResolution: '1K' });
    expect(hasOption(m, 'seed')).toBe(true);
    expect(hasOption(m, 'negativePrompt')).toBe(false);
  });
  it('reads the per-image price from the endpoints list', () => {
    expect(priceFromEndpoints({ endpoints: [{ pricing: [{ billable: 'input_text', unit: 'token', cost_usd: 0.000001 }, { billable: 'output_image', unit: 'image', cost_usd: 0.05 }] }] })).toBe(0.05);
    expect(priceFromEndpoints({ endpoints: [{ pricing: [{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.02 }] }] })).toBeUndefined();
  });
  it('makes one request per image and adds up the reported cost', async () => {
    const { t, calls } = recorder(() => ({ data: [{ b64_json: png, media_type: 'image/png' }], usage: { cost: 0.04 } }));
    const r = await openrouterImageProvider.generate(params({ providerId: 'openrouter', model: 'a/b', variants: 2, aspectRatio: '16:9', seed: 7 }), undefined, { config: cfg('https://or/api/v1'), auth: { keyId: 'openrouter' }, transport: t });
    expect(calls.map((c) => c.url)).toEqual(['https://or/api/v1/images', 'https://or/api/v1/images']);
    expect(calls[0].body).toMatchObject({ model: 'a/b', prompt: '猫', response_format: 'b64_json', aspect_ratio: '16:9', seed: 7 });
    expect(calls[1].body.seed).toBe(8);
    expect(r.images).toHaveLength(2);
    expect(r.costUsd).toBeCloseTo(0.08);
  });
});

describe('Gemini image provider', () => {
  it('lists only image models, with sizes on Gemini 3', () => {
    expect(mapGeminiImageModel({ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] })).toBeNull();
    const flash = mapGeminiImageModel({ name: 'models/gemini-2.5-flash-image', displayName: 'Flash Image', supportedGenerationMethods: ['generateContent'] })!;
    expect(flash.constraints.resolutions).toBeUndefined();
    expect(flash.pricing.generation).toBe(0.039);
    const pro = mapGeminiImageModel({ name: 'models/gemini-3-pro-image-preview', supportedGenerationMethods: ['generateContent'] })!;
    expect(pro.constraints.resolutions).toEqual(['1K', '2K', '4K']);
    expect(geminiImageProvider.estimateCost(params({ model: pro.id, resolution: '4K', variants: 2 }), pro)).toBeCloseTo(0.48);
  });
  it('asks for images only, with aspect ratio, size and seed', () => {
    expect(buildGeminiImageBody(params({ model: 'gemini-3-pro-image', aspectRatio: '16:9', resolution: '2K' }), 5)).toEqual({
      contents: [{ role: 'user', parts: [{ text: '猫' }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' }, seed: 5 }
    });
    expect((buildGeminiImageBody(params({ model: 'gemini-2.5-flash-image', resolution: '2K' })) as any).generationConfig.imageConfig).toBeUndefined();
  });
  it('skips thought images', async () => {
    const { t } = recorder(() => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png }, thought: true }, { inlineData: { mimeType: 'image/png', data: png } }] } }] }));
    const r = await geminiImageProvider.generate(params({ model: 'gemini-2.5-flash-image' }), undefined, { config: cfg('https://g/v1beta'), auth: { keyId: 'gemini' }, transport: t });
    expect(r.images).toHaveLength(1);
  });
});

describe('OpenAI image provider', () => {
  it('maps GPT Image and DALL·E 3 and ignores other models', () => {
    expect(mapOpenAIImageModel({ id: 'gpt-4o' })).toBeNull();
    expect(mapOpenAIImageModel({ id: 'gpt-image-1' })?.constraints).toMatchObject({ aspectRatios: ['1:1', '3:2', '2:3'], resolutions: ['low', 'medium', 'high'], resolutionLabel: 'quality' });
    expect(mapOpenAIImageModel({ id: 'dall-e-3' })?.constraints.resolutions).toEqual(['standard', 'hd']);
  });
  it('maps aspect ratios to sizes and estimates from the price table', () => {
    expect(sizeOf(params({ model: 'gpt-image-1', aspectRatio: '3:2' }))).toBe('1536x1024');
    expect(sizeOf(params({ model: 'dall-e-3', aspectRatio: '9:16' }))).toBe('1024x1792');
    expect(estimateOpenAICost(params({ model: 'gpt-image-1', resolution: 'high', variants: 2 }), undefined)).toBeCloseTo(0.334);
    expect(estimateOpenAICost(params({ model: 'gpt-image-9' }), undefined)).toBeUndefined();
  });
  it('builds the body (n for GPT Image, b64_json for DALL·E 3)', async () => {
    expect(buildOpenAIImageBody(params({ model: 'gpt-image-1', resolution: 'low', format: 'webp' }), 2)).toEqual({ model: 'gpt-image-1', prompt: '猫', n: 2, size: '1024x1024', quality: 'low', output_format: 'webp' });
    expect(buildOpenAIImageBody(params({ model: 'dall-e-3' }), 1)).toMatchObject({ response_format: 'b64_json', n: 1 });
    const { t, calls } = recorder(() => ({ data: [{ b64_json: png }, { b64_json: png }] }));
    const r = await openaiImageProvider.generate(params({ model: 'gpt-image-1', variants: 2 }), undefined, { config: cfg('https://oa/v1'), auth: { keyId: 'openai' }, transport: t });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oa/v1/images/generations');
    expect(r.images).toHaveLength(2);
  });
});
