import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGenerateBody, estimateImageCost, generateImages, ImageApiError, mapImageModel, sizeFor } from './venice';
import { getImage, imageUsage, listImages, putImage, resealImages, exportImages, importImages } from '../db/images';
import { setDataKey } from '../db/sealed';
import { generateDataKey } from '../crypto/data';
import { db, type ImageParams, type MessageRecord } from '../db/schema';
import { buildRequestMessages } from '../chat/request';
import { validate } from '../db/export';
import { makeImageTool } from '../tools/image';
import type { Transport } from '../providers/types';

const widthModel = mapImageModel({ id: 'flux', model_spec: { name: 'Flux', privacy: 'private', traits: ['default'], constraints: { widthHeightDivisor: 16 }, pricing: { generation: { usd: 0.01 } } } })!;
const aspectModel = mapImageModel({
  id: 'qwen',
  model_spec: { name: 'Qwen', privacy: 'anonymized', constraints: { aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1', resolutions: ['1K', '2K'], defaultResolution: '1K' }, pricing: { resolutions: { '1K': { usd: 0.04 }, '2K': { usd: 0.08 } } } }
})!;
const params = (o: Partial<ImageParams> = {}): ImageParams => ({ op: 'generate', providerId: 'venice', model: 'flux', prompt: 'a cat', variants: 2, safeMode: true, format: 'webp', ...o });

afterEach(async () => {
  setDataKey(null);
  await db().blobs.clear();
});

describe('Venice image API', () => {
  it('maps image models', () => {
    expect(widthModel).toMatchObject({ id: 'flux', name: 'Flux', privacy: 'private', traits: ['default'], pricing: { generation: 0.01 } });
    expect(aspectModel.constraints.resolutions).toEqual(['1K', '2K']);
    expect(aspectModel.pricing.resolutions).toEqual({ '1K': 0.04, '2K': 0.08 });
  });

  it('sends width/height or aspect ratio depending on the model', () => {
    const w = buildGenerateBody(params({ aspectRatio: '16:9', seed: 5, negativePrompt: ' blur ', style: 'Anime' }), widthModel);
    expect(w).toMatchObject({ model: 'flux', prompt: 'a cat', variants: 2, format: 'webp', safe_mode: true, seed: 5, negative_prompt: 'blur', style_preset: 'Anime', width: 1024, height: 576 });
    expect(w).not.toHaveProperty('aspect_ratio');
    const a = buildGenerateBody(params({ model: 'qwen', aspectRatio: '16:9', resolution: '2K' }), aspectModel);
    expect(a).toMatchObject({ aspect_ratio: '16:9', resolution: '2K' });
    expect(a).not.toHaveProperty('width');
    expect(sizeFor('3:4', 8)).toEqual({ width: 768, height: 1024 });
  });

  it('estimates cost per image, per resolution, and for upscale/edit', () => {
    expect(estimateImageCost(params(), widthModel)).toBeCloseTo(0.02);
    expect(estimateImageCost(params({ model: 'qwen', variants: 1, resolution: '2K' }), aspectModel)).toBeCloseTo(0.08);
    expect(estimateImageCost(params({ op: 'upscale', scale: 4 }), undefined)).toBe(0.08);
    expect(estimateImageCost(params({ op: 'remove-bg' }), undefined)).toBeUndefined();
  });

  it('parses images and headers, and turns 422 into a suggestion', async () => {
    const ok: Transport = {
      async fetch(_u, _i, auth) {
        expect(auth).toEqual({ keyId: 'venice' });
        return new Response(JSON.stringify({ images: [btoa('png-bytes')] }), { headers: { 'content-type': 'application/json', 'x-venice-is-blurred': 'true', 'x-venice-content-violation-count': '1' } });
      }
    };
    const cfg = { id: 'venice', name: 'Venice', kind: 'openai-compatible' as const, preset: 'venice', baseUrl: 'https://api.venice.ai/api/v1', modelListMode: 'fetch' as const, enabled: true };
    const r = await generateImages(cfg, { keyId: 'venice' }, ok, params(), widthModel);
    expect(r.images).toHaveLength(1);
    expect(r.images[0].type).toBe('image/webp');
    expect(r).toMatchObject({ blurred: true, violations: 1 });
    const bad: Transport = { fetch: async () => new Response(JSON.stringify({ error: 'policy', suggested_prompt: 'a dog', recommended_model: 'chroma' }), { status: 422 }) };
    const err = await generateImages(cfg, { keyId: 'venice' }, bad, params(), widthModel).catch((e) => e);
    expect(err).toBeInstanceOf(ImageApiError);
    expect(err.suggestion).toEqual({ prompt: 'a dog', model: 'chroma' });
  });
});

describe('image storage', () => {
  const meta = (id: string) => ({ id, conversationId: 'c1', messageId: 'm1', mime: 'image/png' });
  it('stores, encrypts at rest, decrypts on read, and exports/imports', async () => {
    await putImage(meta('i1'), new Blob(['hello'], { type: 'image/png' }), false);
    const key = await generateDataKey();
    await resealImages(null, key);
    const raw = await db().blobs.get('i1');
    expect(raw?.blob).toBeUndefined();
    expect(raw?.enc).toBeDefined();
    setDataKey(key);
    expect(await (await getImage('i1'))!.text()).toBe('hello');
    expect((await imageUsage()).count).toBe(1);
    expect((await listImages())[0]).toMatchObject({ id: 'i1', conversationId: 'c1' });
    const ex = await exportImages();
    expect(atob(ex[0].data)).toBe('hello');
    await db().blobs.clear();
    expect(await importImages(ex, new Set(['c1']))).toBe(1);
    expect(await importImages(ex, new Set(['c1']))).toBe(0);
    expect((await db().blobs.get('i1'))?.enc).toBeDefined();
    // Temporary chats stay in memory
    await putImage({ ...meta('t1'), conversationId: 'tmp' }, new Blob(['x']), true);
    expect(await db().blobs.get('t1')).toBeUndefined();
    expect(await (await getImage('t1'))!.text()).toBe('x');
    await resealImages(key, null);
    setDataKey(null);
    expect((await db().blobs.get('i1'))?.blob).toBeDefined();
  });
});

describe('images in conversations', () => {
  it('chat models get a note instead of the image', () => {
    const a: MessageRecord = {
      id: 'a',
      conversationId: 'c',
      parentId: 'u',
      role: 'assistant',
      parts: [{ type: 'file', blobId: 'b', name: 'image-1.webp', mimeType: 'image/webp' }],
      createdAt: 1,
      status: 'done',
      image: { params: params() }
    };
    const out = buildRequestMessages([a], '');
    expect((out[0].parts[0] as { text: string }).text).toContain('画像を 1 枚生成しました: a cat');
  });

  it('backups keep image parts and requests', () => {
    const v = validate({
      format: 'nobackend-llm-client/export',
      version: 5,
      conversations: [{ id: 'c', title: 't', createdAt: 1, updatedAt: 1 }],
      messages: [
        { id: 'u', conversationId: 'c', role: 'user', parts: [{ type: 'text', text: 'a cat' }], imageRequest: params({ op: 'bogus' as never }) },
        { id: 'a', conversationId: 'c', role: 'assistant', parts: [{ type: 'file', blobId: 'b', name: 'x', mimeType: 'image/png', width: 8, height: 8 }, { type: 'file', blobId: 'z', mimeType: 'text/html' }], image: { params: params(), seed: 3 } }
      ],
      prompts: [],
      images: [{ id: 'b', conversationId: 'c', messageId: 'a', createdAt: 1, mime: 'image/png', data: 'AA==' }, { id: 'bad' }]
    });
    expect(v.messages[0].imageRequest).toBeUndefined();
    expect(v.messages[1].parts).toEqual([{ type: 'file', blobId: 'b', name: 'x', mimeType: 'image/png', width: 8, height: 8 }]);
    expect(v.messages[1].image).toMatchObject({ params: { op: 'generate', prompt: 'a cat' }, seed: 3 });
    expect(v.images).toHaveLength(1);
  });

  it('generate_image tool validates input', async () => {
    const tool = makeImageTool(async (input) => ({ blobIds: ['b1'], model: 'Flux', blurred: false, ...(input as object) }) as never);
    expect(() => tool.prepare({})).toThrow();
    expect(tool.prepare({ prompt: ' a cat ', aspect_ratio: '5:7' })).toEqual({ prompt: 'a cat' });
    const r = await tool.execute({ prompt: 'a cat' }, { signal: new AbortController().signal } as never);
    expect(r.details).toMatchObject({ blobIds: ['b1'] });
  });
});
