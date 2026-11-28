import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGenerateBody, mapImageModel, sizeFor, veniceEditCost, veniceImageProvider } from './providers/venice';
import { exportImages, fileUsage, filesTable, forgetTemporaryFiles, getFile, importImages, listFiles, newFile, createFile, readBytes, readThumb, storeBytes, type NewBytes } from '../../../lib/db/files';
import { setDataKey, unseal } from '../../../lib/db/sealed';
import { resetCatalog } from '../../../lib/db/catalog';
import { convertImage } from '../../../lib/db/convert';
import { generateDataKey, sealBytes, sealJSON } from '../../../lib/crypto/data';
import { db, type ImageParams, type MessageRecord } from '../../../lib/db/schema';
import * as repo from '../../../lib/db/repo';
import { onFilesChange } from '../../../lib/db/changes';
import { buildRequestMessages, registerMessageTransform } from '../../../lib/chat/request';
import { imageNote } from './transform';

registerMessageTransform(imageNote);
import { validate } from '../../../lib/db/export';
import { generationCost, ImageApiError } from './providers/common';
import { imageStems, makeImageTool } from './tool';
import { TranslatedError } from '../../../lib/i18n';
import { savedPathOf, storeImages } from '../../../state/media';
import type { Transport } from '../../../lib/providers/types';

const widthModel = mapImageModel({ id: 'flux', model_spec: { name: 'Flux', privacy: 'private', traits: ['default'], constraints: { widthHeightDivisor: 16 }, pricing: { generation: { usd: 0.01 } } } })!;
const aspectModel = mapImageModel({
  id: 'qwen',
  model_spec: { name: 'Qwen', privacy: 'anonymized', constraints: { aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1', resolutions: ['1K', '2K'], defaultResolution: '1K' }, pricing: { resolutions: { '1K': { usd: 0.04 }, '2K': { usd: 0.08 } } } }
})!;
const params = (o: Partial<ImageParams> = {}): ImageParams => ({ op: 'generate', providerId: 'venice', model: 'flux', prompt: 'a cat', variants: 2, safeMode: true, format: 'webp', ...o });

afterEach(async () => {
  setDataKey(null);
  await Promise.all([db().blobs.clear(), db().files.clear(), db().fileData.clear()]);
  forgetTemporaryFiles('tmp');
  resetCatalog();
});

/** Save an image (made in a chat unless said) and give its path */
const putImage = async (meta: Omit<NewBytes, 'origin'> & Partial<Pick<NewBytes, 'origin'>>, blob: Blob, temporary: boolean) => (await storeBytes({ origin: { kind: 'made' }, ...meta }, blob, temporary)).path;
const listImages = async () => (await listFiles()).filter((f) => f.kind === 'image');
const getImage = readBytes;

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
    const cfg = { id: 'venice', baseUrl: 'https://api.venice.ai/api/v1' };
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
    await filesTable.reseal!(null, key);
    const raw = await db().fileData.get('i1:current');
    expect(raw && 'data' in raw && !(raw.data instanceof Blob)).toBe(true);
    // Its type is in the encrypted record only
    expect(JSON.stringify(await db().files.get('i1'))).not.toContain('image/png');
    setDataKey(key);
    expect(await (await getImage('i1'))!.text()).toBe('hello');
    expect((await getImage('i1'))!.type).toBe('image/png');
    expect((await fileUsage(false)).count).toBe(1);
    expect((await listImages())[0]).toMatchObject({ id: 'i1', conversationId: 'c1' });
    const ex = await exportImages();
    expect(await ex[0].data.text()).toBe('hello');
    await Promise.all([db().files.clear(), db().fileData.clear()]);
    resetCatalog();
    expect(await importImages(ex)).toBe(1);
    expect(await importImages(ex)).toBe(0);
    const back = await db().fileData.get('i1:current');
    expect(back && 'data' in back && !(back.data instanceof Blob)).toBe(true);
    // Temporary chats stay in memory
    await putImage({ ...meta('t1'), conversationId: 'tmp' }, new Blob(['x']), true);
    expect(await db().files.get('t1')).toBeUndefined();
    expect(await (await getImage('t1'))!.text()).toBe('x');
    await filesTable.reseal!(key, null);
    setDataKey(null);
    const plain = await db().fileData.get('i1:current');
    expect(plain && 'data' in plain && plain.data instanceof Blob).toBe(true);
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
  it('moves images from the table before files held them all, as the data loads, giving one without a path its time name', async () => {
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    await db().blobs.put({ id: 'old', mime: 'image/png', createdAt: at, size: 1, blob: new Blob(['x'], { type: 'image/png' }) });
    resetCatalog();
    expect((await listImages()).find((i) => i.id === 'old')?.path).toBe('20260102-030405.png');
    // Written as a file, so it keeps that name; the old row is gone
    expect((await db().files.get('old'))?.path).toBe('20260102-030405.png');
    expect(await db().blobs.count()).toBe(0);
    expect(await (await getImage('old'))!.text()).toBe('x');
  });
  it('moves encrypted images as they are (bytes and thumbnail not encrypted again), and goes on after a stop halfway', async () => {
    const key = await generateDataKey();
    setDataKey(key);
    const sealed = async (text: string) => {
      const s = await sealBytes(key, new TextEncoder().encode(text).buffer);
      return { iv: s.iv, data: new Blob([s.data], { type: 'image/png' }) };
    };
    const row = async (id: string, path: string) => ({
      id,
      conversationId: 'c1',
      messageId: 'm1',
      createdAt: 5,
      mime: 'image/png',
      size: 3,
      enc: await sealed(`${id}-bytes`),
      thumb: await sealed(`${id}-thumb`),
      infoEnc: await sealJSON(key, { path, origin: { kind: 'web', url: 'https://a.example/x.png' } })
    });
    await db().blobs.bulkPut([await row('a', 'pics/a.png'), await row('b', 'pics/b.png')]);
    // One moved, then the app stopped: the next load moves the other
    const space = { ownerOf: () => undefined, holds: () => false };
    expect((await convertImage('a', space))?.path).toBe('pics/a.png');
    resetCatalog();
    expect((await listImages()).map((i) => i.path).sort()).toEqual(['pics/a.png', 'pics/b.png']);
    expect(await db().blobs.count()).toBe(0);
    const b = (await getFile('b'))!;
    expect(b).toMatchObject({ mime: 'image/png', messageId: 'm1', origin: { kind: 'web', url: 'https://a.example/x.png' }, bytes: 3, updatedAt: 5 });
    expect(await (await getImage('b'))!.text()).toBe('b-bytes');
    expect(await (await readThumb('b'))!.text()).toBe('b-thumb');
    // Its record is encrypted; the encrypted bytes carry no type
    expect(JSON.stringify(await db().files.get('b'))).not.toContain('pics');
    const moved = await db().fileData.get('b:current');
    expect(moved && 'data' in moved && !(moved.data instanceof Blob) && moved.data.data.type).toBe('');
  });
  it('keeps a brought-in image\'s name and origin, encrypted with a passphrase', async () => {
    const key = await generateDataKey();
    setDataKey(key);
    const info = { path: 'cat.png', origin: { kind: 'web' as const, url: 'https://upload.example/cat.png' } };
    await putImage({ id: 'w1', mime: 'image/png', origin: info.origin, name: info.path }, new Blob(['png'], { type: 'image/png' }), false);
    const raw = (await db().files.get('w1'))!;
    expect(JSON.stringify(raw)).not.toContain('cat.png');
    expect((await unseal(raw)).path).toBe('cat.png');
    expect(raw.conversationId).toBeUndefined();
    const listed = () => listImages().then((l) => l.find((i) => i.id === 'w1'));
    expect([(await listed())?.path, (await listed())?.origin]).toEqual([info.path, info.origin]);
    const ex = await exportImages();
    await Promise.all([db().files.clear(), db().fileData.clear()]);
    resetCatalog();
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
    await createFile(newFile({ id: 'f1', path: 'a.md', origin: { kind: 'made' }, text: 'hi', by: 'model', conversationId: 'c2' }), 'hi');
    await createFile(newFile({ id: 'f2', path: 'b.md', origin: { kind: 'made' }, text: 'other', by: 'user' }), 'other');
    expect(await repo.countMadeIn('c2')).toBe(2);
    // Lists of files hear about it, whichever code deleted them
    let heard = 0;
    const stop = onFilesChange(() => heard++);
    await repo.deleteConversation('c2', true);
    stop();
    expect(heard).toBeGreaterThan(0);
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
      parts: [{ type: 'file', fileId: 'b', name: 'image-1.webp', mimeType: 'image/webp' }],
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
        { id: 'a', conversationId: 'c', role: 'assistant', parts: [{ type: 'file', fileId: 'b', name: 'x', mimeType: 'image/png', width: 8, height: 8 }, { type: 'file', fileId: 'z', mimeType: 'text/html' }], image: { params: params(), seed: 3 } }
      ],
      prompts: [],
      images: [{ id: 'b', conversationId: 'c', messageId: 'a', createdAt: 1, mime: 'image/png', data: 'AA==' }, { id: 'bad' }]
    });
    expect(v.messages[0].imageRequest).toBeUndefined();
    expect(v.messages[1].parts).toEqual([{ type: 'file', fileId: 'b', name: 'x', mimeType: 'image/png', width: 8, height: 8 }]);
    expect(v.messages[1].image).toMatchObject({ params: { op: 'generate', prompt: 'a cat' }, seed: 3 });
    expect(v.images).toHaveLength(1);
  });

  it('generate_image tool validates input', async () => {
    const tool = makeImageTool(async (input) => ({ fileIds: ['b1'], paths: ['20261127-160816.webp'], inWorkDir: true, model: 'Flux', blurred: false, ...(input as object) }) as never);
    // The chat model reads the app's own errors in English, whatever the UI language
    expect(() => tool.prepare({})).toThrow(TranslatedError);
    expect(tool.prepare({ prompt: ' a cat ', aspect_ratio: '5:7' })).toEqual({ prompt: 'a cat' });
    const r = await tool.execute({ prompt: 'a cat' }, { signal: new AbortController().signal } as never);
    expect(r.details).toMatchObject({ fileIds: ['b1'] });
    // The model learns where it went, to use it from a page in the working folder
    expect(r.content).toContain('Saved in the working folder as "20261127-160816.webp"');
  });

  it('generate_image saves at the path the model gives, cleaned as write_file cleans names', async () => {
    const ran = (paths: string[], inWorkDir = true) => makeImageTool(async () => ({ fileIds: paths.map((_, i) => `b${i + 1}`), paths, inWorkDir, model: 'Flux', blurred: false }));
    const tool = ran([]);
    expect(tool.prepare({ prompt: 'a', path: '../assets//hero' })).toEqual({ prompt: 'a', path: 'assets/hero.png' });
    expect(tool.prepare({ prompt: 'a', path: ' ' })).toEqual({ prompt: 'a' });
    expect(imageStems('assets/hero.png', 1)).toEqual(['assets/hero']);
    expect(imageStems('assets/hero.png', 2)).toEqual(['assets/hero-1', 'assets/hero-2']);
    const exec = (paths: string[], path: string, inWorkDir = true) => ran(paths, inWorkDir).execute({ prompt: 'a', path }, { signal: new AbortController().signal } as never);
    // As asked: only the paths
    const same = await exec(['assets/hero-1.png', 'assets/hero-2.png'], 'assets/hero.png');
    expect(same.content).toContain('Saved in the working folder as "assets/hero-1.png" (id: b1), "assets/hero-2.png" (id: b2)');
    expect(same.content).not.toContain('not exactly');
    // Another type, or a path taken: told why the path differs
    expect((await exec(['assets/hero.webp'], 'assets/hero.png')).content).toContain('not exactly the path you gave');
    expect((await exec(['assets/hero (2).png'], 'assets/hero.png')).content).toContain('a path already taken gets a number');
    // No working folder yet: saved in the Files tab, with the id that move_file brings it into the folder by
    const loose = await exec(['20261127-160816.webp'], 'assets/hero.png', false);
    expect(loose.content).toContain('Saved in the Files tab as "20261127-160816.webp" (id: b1), outside any working folder (there is none yet), so the path was ignored.');
    expect(loose.content).toContain('move it into the working folder with move_file and its id (to that path)');
  });

  it('stores images at the paths given in the working folder, with a number when a path is taken', async () => {
    resetCatalog();
    const conv = { id: 'c', workDir: 'game/' } as never;
    const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const [a] = await storeImages(conv, 'm', [png()], ['assets/hero.png']);
    const [b] = await storeImages(conv, 'm', [png()], ['assets/hero.png']);
    expect(savedPathOf(a.fileId)).toBe('game/assets/hero.png');
    expect(savedPathOf(b.fileId)).toBe('game/assets/hero (2).png');
    // Without paths: named by the time, at the top of the working folder
    const [c] = await storeImages(conv, 'm', [png()]);
    expect(savedPathOf(c.fileId)).toMatch(/^game\/\d{8}-\d{6}( \(\d+\))?\.png$/);
  });
});
