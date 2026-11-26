import { describe, expect, it } from 'vitest';
import { mapDeepInfraImageModel, mapNanoImageModel, mapTogetherImageModel, sizeFor, sniffMime } from './providers/hosts';
import { generationCost } from './providers/common';
import type { ImageParams } from '../../lib/db/schema';

const params = (o: Partial<ImageParams> = {}): ImageParams => ({ op: 'generate', providerId: 'nanogpt', model: 'm', prompt: 'a cat', variants: 2, safeMode: false, format: 'png', ...o });

// Trimmed entries in the shapes the model lists had on 2026-11-26
describe('open-model hosts: images', () => {
  it('read NanoGPT image models with their own size names and a price per size', () => {
    const m = mapNanoImageModel({
      id: 'speridlabs/iris-z',
      name: 'Iris-Z',
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
      capabilities: { image_generation: true },
      pricing: { per_image: { square: 0.1, landscape_16_9: 0.12 } },
      supported_parameters: { resolutions: ['square', 'landscape_16_9'], max_images: 4 }
    })!;
    expect(m.constraints.sizes).toEqual([
      { id: 'square', price: 0.1 },
      { id: 'landscape_16_9', price: 0.12 }
    ]);
    expect(generationCost(params({ size: 'landscape_16_9' }), m)).toBeCloseTo(0.24);
    // Background removal and other image-in tools are not text-to-image
    expect(mapNanoImageModel({ id: 'bria/rmbg-3', architecture: { input_modalities: ['image'] } })).toBeNull();
    // One image per request
    const single = mapNanoImageModel({ id: 'k', architecture: { input_modalities: ['text'] }, pricing: { per_image: { '2048x2048': 0.063 } }, supported_parameters: { resolutions: ['2048x2048'], max_images: 1 } })!;
    expect(generationCost(params({ variants: 4 }), single)).toBeCloseTo(0.063);
  });
  it('mark NanoGPT models that edit an image, and those that only edit', () => {
    const m = (id: string, image_to_image: boolean) => mapNanoImageModel({ id, architecture: { input_modalities: ['text', 'image'] }, capabilities: { image_generation: true, image_to_image } })!;
    expect(m('nano-banana-2', true).edits).toBe('also');
    expect(m('nano-banana-edit', true).edits).toBe('only');
    expect(m('qwen-image-2.1/edit', true).edits).toBe('only');
    expect(m('flux-dev', false).edits).toBeUndefined();
  });
  it('read DeepInfra text-to-image models and their price per image', () => {
    const m = mapDeepInfraImageModel({ id: 'PrunaAI/p-image', metadata: { tags: ['image-gen'], pricing: { per_image_unit: 0.005 } } })!;
    expect(generationCost(params({ variants: 3 }), m)).toBeCloseTo(0.015);
    expect(mapDeepInfraImageModel({ id: 'Bria/fibo_edit', metadata: { tags: ['image-gen'] } })).toBeNull();
    expect(mapDeepInfraImageModel({ id: 'chat', metadata: { tags: ['chat'] } })).toBeNull();
  });
  it('read Together image models', () => {
    expect(mapTogetherImageModel({ id: 'black-forest-labs/FLUX.1-schnell', type: 'image', display_name: 'FLUX.1 Schnell' })?.name).toBe('FLUX.1 Schnell');
    expect(mapTogetherImageModel({ id: 'x', type: 'chat' })).toBeNull();
  });
  it('size the shared aspect ratios in multiples of 64, and read the image type from its bytes', () => {
    for (const a of ['1:1', '4:3', '3:4', '16:9', '9:16']) for (const n of sizeFor(a)) expect(n % 64).toBe(0);
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  });
});
