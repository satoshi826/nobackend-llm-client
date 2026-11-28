import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGenerateBody, mapImageModel, sizeFor, veniceEditCost, veniceImageProvider } from './providers/venice';
import { getImage, imageUsage, listImages, putImage, resealImages, exportImages, importImages } from '../../lib/db/images';
import { setDataKey } from '../../lib/db/sealed';
import { resetCatalog } from '../../lib/db/catalog';
import { generateDataKey } from '../../lib/crypto/data';
import { db, type ImageParams, type MessageRecord } from '../../lib/db/schema';
import * as repo from '../../lib/db/repo';
import { getFile, newFile, createFile } from '../../lib/db/files';
import { onStoreChange } from '../../lib/db/changes';
import { buildRequestMessages, registerMessageTransform } from '../../lib/chat/request';
import { imageNote } from './transform';

registerMessageTransform(imageNote);
import { validate } from '../../lib/db/export';
import { generationCost, ImageApiError } from './providers/common';
import { makeImageTool } from './tool';
import type { Transport } from '../../lib/providers/types';

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
    expect(aspectModel.constraints.sizes).toEqual([
      { id: '1:1 1K', aspect: '1:1', tier: '1K', price: 0.04 },
      { id: '1:1 2K', aspect: '1:1', tier: '2K', price: 0.08 },
      { id: '16:9 1K', aspect: '16:9', tier: '1K', price: 0.04 },
      { id: '16:9 2K', aspect: '16:9', tier: '2K', price: 0.08 }
    ]);
    expect(aspectModel.constraints.defaultSize).toBe('1:1 1K');
    // Models sized by width x height get the shared aspect ratios
    expect(widthModel.constraints.sizes.map((s) => s.id)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16']);
  });

  it('sends width/height or aspect ratio depending on the model', () => {
    const w = buildGenerateBody(params({ aspectRatio: '16:9', seed: 5, negativePrompt: ' blur ', style: 'Anime' }), widthModel);
    expect(w).toMatchObject({ model: 'flux', prompt: 'a cat', variants: 2, format: 'webp', safe_mode: true, seed: 5, negative_prompt: 'blur', style_preset: 'Anime', width: 1024, height: 576, hide_watermark: true });
    expect(w).not.toHaveProperty('aspect_ratio');
    const a = buildGenerateBody(params({ model: 'qwen', aspectRatio: '16:9', resolution: '2K' }), aspectModel);
    expect(a).toMatchObject({ aspect_ratio: '16:9', resolution: '2K' });
    expect(a).not.toHaveProperty('width');
    expect(sizeFor('3:4', 8)).toEqual({ width: 768, height: 1024 });
  });

  it('estimates cost per image, per resolution, and for upscale/edit', () => {
    expect(generationCost(params(), widthModel)).toBeCloseTo(0.02);
    expect(generationCost(params({ model: 'qwen', variants: 1, size: '16:9 2K' }), aspectModel)).toBeCloseTo(0.08);
    // Requests saved before size ids are priced from their aspect ratio and resolution
    expect(generationCost(params({ model: 'qwen', variants: 1, aspectRatio: '1:1', resolution: '2K' }), aspectModel)).toBeCloseTo(0.08);
    expect(veniceEditCost(params({ op: 'upscale', scale: 4 }))).toBe(0.08);
    expect(veniceEditCost(params({ op: 'remove-bg' }))).toBeUndefined();
  });

  it('parses images and headers, and turns 422 into a suggestion', async () => {
    const ok: Transport = {
      async fetch(_u, _i, auth) {
        expect(auth).toEqual({ keyId: 'venice' });
        return new Response(JSON.stringify({ images: [btoa('png-bytes')] }), { headers: { 'content-type': 'application/json', 'x-venice-is-blurred': 'true', 'x-venice-content-violation-count': '1' } });
      }
    };
    const cfg = { id: 'venice', name: 'Venice', kind: 'openai-compatible' as const, preset: 'venice', baseUrl: 'https://api.venice.ai/api/v1', modelListMode: 'fetch' as const, enabled: true };
    const r = await veniceImageProvider.generate(params(), widthModel, { config: cfg, auth: { keyId: 'venice' }, transport: ok });
    expect(r.images).toHaveLength(1);
    expect(r.images[0].type).toBe('image/webp');
    expect(r).toMatchObject({ blurred: true, violations: 1 });
    const bad: Transport = { fetch: async () => new Response(JSON.stringify({ error: 'policy', suggested_prompt: 'a dog', recommended_model: 'chroma' }), { status: 422 }) };
    const err = await veniceImageProvider.generate(params(), widthModel, { config: cfg, auth: { keyId: 'venice' }, transport: bad }).catch((e) => e);
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
    expect(await importImages(ex)).toBe(1);
    expect(await importImages(ex)).toBe(0);
    expect((await db().blobs.get('i1'))?.enc).toBeDefined();
    // Temporary chats stay in memory
    await putImage({ ...meta('t1'), conversationId: 'tmp' }, new Blob(['x']), true);
    expect(await db().blobs.get('t1')).toBeUndefined();
    expect(await (await getImage('t1'))!.text()).toBe('x');
    await resealImages(key, null);
    setDataKey(null);
    expect((await db().blobs.get('i1'))?.blob).toBeDefined();
  });
  it('names an image that comes with no name by the second it is saved, in the folder given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 27, 16, 8, 16));
    try {
      const made = (id: string) => putImage({ id, mime: 'image/webp', folder: 'site/' }, new Blob([id], { type: 'image/webp' }), false);
      // Two in the same second: the second is numbered
      expect([await made('g1'), await made('g2')]).toEqual(['site/20261127-160816.webp', 'site/20261127-160816 (2).webp']);
      expect((await listImages()).find((i) => i.id === 'g1')?.path).toBe('site/20261127-160816.webp');
    } finally {
      vi.useRealTimers();
    }
  });
  it('gives an image stored without a path (made before images had one) its time name as the data loads', async () => {
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    await db().blobs.put({ id: 'old', mime: 'image/png', createdAt: at, size: 1, blob: new Blob(['x'], { type: 'image/png' }) });
    resetCatalog();
    expect((await listImages()).find((i) => i.id === 'old')?.path).toBe('20260102-030405.png');
    // Written back, so it keeps that name
    expect((await db().blobs.get('old'))?.info?.path).toBe('20260102-030405.png');
  });
  it('keeps a brought-in image\'s name and origin, encrypted with a passphrase', async () => {
    const key = await generateDataKey();
    setDataKey(key);
    const info = { path: 'cat.png', origin: { kind: 'web' as const, url: 'https://upload.example/cat.png' } };
    await putImage({ id: 'w1', mime: 'image/png', origin: info.origin, name: info.path }, new Blob(['png'], { type: 'image/png' }), false);
    const raw = await db().blobs.get('w1');
    expect(raw?.info).toBeUndefined();
    expect(raw?.infoEnc).toBeDefined();
    expect(raw?.conversationId).toBeUndefined();
    const listed = () => listImages().then((l) => l.find((i) => i.id === 'w1'));
    expect([(await listed())?.path, (await listed())?.origin]).toEqual([info.path, info.origin]);
    const ex = await exportImages();
    await db().blobs.clear();
    expect(await importImages(ex)).toBe(1);
    expect([(await listed())?.path, (await listed())?.origin]).toEqual([info.path, info.origin]);
  });
  it('keeps saved images when their conversation is deleted', async () => {
    await putImage(meta('k1'), new Blob(['kept']), false);
    await repo.deleteConversation('c1');
    expect(await (await getImage('k1'))!.text()).toBe('kept');
  });
  it('deletes a conversation’s images and files with it when asked, and counts them first', async () => {
    await repo.putConversation({ id: 'c2', title: 'c2', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'p', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] });
    await putImage({ ...meta('d1'), conversationId: 'c2' }, new Blob(['x']), false);
    await createFile(newFile({ id: 'f1', name: 'a.md', origin: { kind: 'made' }, text: 'hi', by: 'model', conversationId: 'c2' }), 'hi');
    await createFile(newFile({ id: 'f2', name: 'b.md', origin: { kind: 'made' }, text: 'other', by: 'user' }), 'other');
    expect(await repo.countMadeIn('c2')).toBe(2);
    // Lists of images and files hear about it, whichever code deleted them
    const heard: string[] = [];
    const stop = onStoreChange((store) => heard.push(store));
    await repo.deleteConversation('c2', true);
    stop();
    expect(heard.sort()).toEqual(['files', 'images']);
    expect(await getImage('d1')).toBeNull();
    expect(await getFile('f1')).toBeUndefined();
    expect(await getFile('f2')).toBeDefined();
  });
});

describe('images in conversations', () => {
  it('chat models get a note instead of the image, in English whatever the UI language', () => {
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
    expect((out[0].parts[0] as { text: string }).text).toBe('[Generated an image: a cat]');
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
    const tool = makeImageTool(async (input) => ({ blobIds: ['b1'], names: ['20261127-160816.webp'], inWorkDir: true, model: 'Flux', blurred: false, ...(input as object) }) as never);
    expect(() => tool.prepare({})).toThrow();
    expect(tool.prepare({ prompt: ' a cat ', aspect_ratio: '5:7' })).toEqual({ prompt: 'a cat' });
    const r = await tool.execute({ prompt: 'a cat' }, { signal: new AbortController().signal } as never);
    expect(r.details).toMatchObject({ blobIds: ['b1'] });
    // The model learns where it went, to use it from a page in the working folder
    expect(r.content).toContain('Saved in the working folder as "20261127-160816.webp"');
  });
});
