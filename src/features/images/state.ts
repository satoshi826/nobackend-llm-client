// Image generation: image mode in the input box, jobs (generate / upscale / edit / background removal),
// regeneration, the image viewer's state, and the generate_image tool for chat models.
// Providers are reached only through the ImageProvider interface (Venice is the only one for now).
import { computed, signal } from '@preact/signals';
import * as repo from '../../lib/db/repo';
import type { Conversation, ImageParams, ImageResult, MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';
import { deleteImageRecords, getImage, getImageMeta, putImage } from '../../lib/db/images';
import { providerConfigOf } from '../../lib/keys/accounts';
import { plainTransport } from '../../lib/providers/transport';
import { vaultTransport as transport } from '../../lib/vault/client';
import { authFor, keyReady } from '../../state/keys';
import { defineFeatureSettings, pickLegacy } from '../../state/feature-settings';
import { openSettings, showToast } from '../../state/ui';
import { conversations, currentConv, currentId, messages, persistDraft, putMessage, updateConversation } from '../../state/conversations';
import { beginRun, endRun } from '../../state/runs';
import { cancelSuggestions } from '../../state/suggestions';
import { resetProviderBalanceBaseline } from '../../state/balance';
import { registerToolProvider, registerUserRequestHandler } from '../../state/tool-registry';
import { ImageApiError, veniceImageProvider, type ImageModelInfo } from './providers/venice';
import { imageProviderOf, registerImageProvider, type ImageCallContext, type ImageProvider } from './providers/types';
import { makeImageTool, type ImageToolInput } from './tool';
import { t } from './messages';

registerImageProvider(veniceImageProvider);

export interface ImageDefaults {
  model: string;
  aspectRatio: string;
  resolution: string;
  variants: number;
  style: string;
  negativePrompt: string;
  enhancePrompt: boolean;
  seed: string;
}
const DEFAULT_IMAGE_SETTINGS = {
  /** Format images are saved in */
  imageFormat: 'webp' as 'webp' | 'png' | 'jpeg',
  /** Last-used options (the image bar starts from these) */
  imageDefaults: { model: '', aspectRatio: '1:1', resolution: '', variants: 1, style: '', negativePrompt: '', enhancePrompt: false, seed: '' } as ImageDefaults,
  /** Let chat models create images with the generate_image tool */
  imageTool: false
};
export const imageSettings = defineFeatureSettings('images', DEFAULT_IMAGE_SETTINGS, (old) => {
  const p = pickLegacy(old, DEFAULT_IMAGE_SETTINGS);
  return p.imageDefaults ? { ...p, imageDefaults: { ...DEFAULT_IMAGE_SETTINGS.imageDefaults, ...p.imageDefaults } } : p;
});

/** The provider used for new requests (the only one for now; see docs/specs/image-providers.md) */
export const IMAGE_PROVIDER = 'venice';

function providerFor(id: string): ImageProvider {
  const p = imageProviderOf(id);
  if (!p) throw new ImageApiError({ kind: 'bad-request', message: t('err.unsupportedProvider', { id }) });
  return p;
}

function callContext(providerId: string, signal?: AbortSignal): ImageCallContext {
  const p = providerFor(providerId);
  return { config: providerConfigOf(p.account)!, auth: authFor(p.account), transport, signal };
}

// ---- the image viewer ----
export interface LightboxItem {
  blobId: string;
  conversationId: string;
  messageId: string;
}
/** fromGallery: opened from the file manager (offers to open the image's conversation) */
export const lightbox = signal<{ items: LightboxItem[]; index: number; fromGallery?: boolean } | null>(null);

export const imageModels = signal<ImageModelInfo[]>([]);
export const imageModelsError = signal<string | null>(null);
export const imageStyles = signal<string[]>([]);
/** Bumped whenever images are added or deleted (lists of images reload on it) */
export const imagesVersion = signal(0);

/** Image generation needs the Venice key */
export const imageReady = computed(() => keyReady(IMAGE_PROVIDER));

const CACHE_KEY = 'cache:imageModels';
let loading: Promise<void> | null = null;

/** Image models (public list, cached for 6 hours) */
export function loadImageModels(force = false): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const cached = await repo.getSetting<{ at: number; list: ImageModelInfo[] } | null>(CACHE_KEY, null);
    if (cached && !force) imageModels.value = cached.list;
    if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return;
    try {
      const list = await providerFor(IMAGE_PROVIDER).listModels(providerConfigOf(IMAGE_PROVIDER)!, plainTransport);
      imageModels.value = list;
      imageModelsError.value = null;
      await repo.setSetting(CACHE_KEY, { at: Date.now(), list });
    } catch (e) {
      imageModelsError.value = (e as Error).message;
    }
  })().finally(() => (loading = null));
  return loading;
}

export async function loadImageStyles() {
  if (imageStyles.value.length || !imageReady.value) return;
  try {
    imageStyles.value = (await providerFor(IMAGE_PROVIDER).listStyles?.(callContext(IMAGE_PROVIDER))) ?? [];
  } catch {
    /* styles are optional */
  }
}

export function imageModelOf(id: string | undefined): ImageModelInfo | undefined {
  return imageModels.value.find((m) => m.id === id);
}

/** The model the image bar uses: last used, else Venice's default, else the first one */
export const currentImageModel = computed(() => {
  const list = imageModels.value;
  return list.find((m) => m.id === imageSettings.value.value.imageDefaults.model) ?? list.find((m) => m.traits.includes('default')) ?? list[0];
});

export async function setImageDefaults(patch: Partial<ImageDefaults>) {
  await imageSettings.save({ imageDefaults: { ...imageSettings.value.value.imageDefaults, ...patch } });
}

const randomSeed = () => Math.floor(Math.random() * 999_999_999);

function ensureImageKey(): boolean {
  if (imageReady.value) return true;
  openSettings('connections');
  showToast(t('bar.needKey'), 'error');
  return false;
}

/** Turn image mode on/off for the current conversation (or the new chat) */
export async function setImageMode(on: boolean) {
  await updateConversation({ imageMode: on });
  if (on) {
    void loadImageModels();
    void loadImageStyles();
  }
}

/** Parameters for a new request from the image bar */
export function paramsFromBar(prompt: string): ImageParams {
  const d = imageSettings.value.value.imageDefaults;
  const m = currentImageModel.value;
  const seed = d.seed.trim() ? Number(d.seed) : undefined;
  return {
    op: 'generate',
    providerId: IMAGE_PROVIDER,
    model: m?.id ?? '',
    prompt,
    negativePrompt: d.negativePrompt || undefined,
    aspectRatio: d.aspectRatio || undefined,
    resolution: d.resolution || undefined,
    variants: Math.min(4, Math.max(1, d.variants)),
    style: d.style || undefined,
    seed: Number.isFinite(seed) ? seed : undefined,
    enhancePrompt: d.enhancePrompt || undefined,
    safeMode: false,
    format: imageSettings.value.value.imageFormat
  };
}

/** Send an image prompt from the input box */
export async function sendImagePrompt(prompt: string) {
  if (!prompt.trim() || !ensureImageKey()) return;
  if (!imageModels.value.length) await loadImageModels();
  const p = paramsFromBar(prompt.trim());
  if (!p.model) {
    showToast(t('err.modelsFailed'), 'error');
    return;
  }
  cancelSuggestions();
  const conv = await persistDraft(prompt);
  await addUserRequest(conv, p, prompt.trim());
}

async function addUserRequest(conv: Conversation, p: ImageParams, text: string) {
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: currentConv.value.currentLeafId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    status: 'done',
    imageRequest: p
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  await runImageJob(conv.id, user.id);
}

/** Upscale / remove the background of / edit an image already in the current conversation */
export async function imageAction(op: 'upscale' | 'remove-bg' | 'edit', sourceBlobId: string, opts: { scale?: 2 | 4; prompt?: string } = {}) {
  if (!ensureImageKey() || !currentId.value) return;
  const conv = currentConv.value;
  const text = op === 'upscale' ? t('request.upscaleText', { scale: opts.scale ?? 2 }) : op === 'remove-bg' ? t('request.removeBgText') : (opts.prompt ?? '').trim();
  if (!text) return;
  const p: ImageParams = {
    op,
    providerId: IMAGE_PROVIDER,
    model: '',
    prompt: op === 'edit' ? text : '',
    variants: 1,
    safeMode: false,
    format: 'png',
    sourceBlobId,
    ...(op === 'upscale' ? { scale: opts.scale ?? 2 } : {})
  };
  await addUserRequest(conv, p, text);
}

/** Regenerate an image answer: 'same' reuses the seed (same picture), 'new' picks a new one */
export async function regenerateImage(assistantId: string, seed: 'same' | 'new') {
  const a = messages.value.find((m) => m.id === assistantId);
  if (!a?.parentId || !currentId.value) return;
  await runImageJob(currentId.value, a.parentId, seed === 'same' && a.image?.seed !== undefined ? { seed: a.image.seed } : { seed: randomSeed() });
}

/** Retry with what the provider suggested after a content-policy rejection */
export async function retryWithSuggestion(assistantId: string, use: 'prompt' | 'model') {
  const a = messages.value.find((m) => m.id === assistantId);
  const s = a?.image?.suggestion;
  if (!a?.parentId || !currentId.value || !s) return;
  await runImageJob(currentId.value, a.parentId, use === 'prompt' && s.prompt ? { prompt: s.prompt } : s.model ? { model: s.model } : {});
}

async function imageSize(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  } catch {
    return {};
  }
}

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

/** Store images for a message and return file parts */
async function storeImages(conv: Conversation, messageId: string, blobs: Blob[]): Promise<Extract<Part, { type: 'file' }>[]> {
  const parts: Extract<Part, { type: 'file' }>[] = [];
  for (const [i, blob] of blobs.entries()) {
    const blobId = repo.newId();
    await putImage({ id: blobId, conversationId: conv.id, messageId, mime: blob.type || 'image/png' }, blob, !!conv.temporary);
    parts.push({ type: 'file', blobId, name: `image-${i + 1}.${EXT[blob.type] ?? 'png'}`, mimeType: blob.type || 'image/png', ...(await imageSize(blob)) });
  }
  imagesVersion.value++;
  return parts;
}

/** Call the provider for one job */
async function call(p: ImageParams, signal: AbortSignal): Promise<{ blobs: Blob[]; result: Partial<ImageResult> }> {
  const provider = providerFor(p.providerId);
  const ctx = callContext(p.providerId, signal);
  if (p.op === 'generate') {
    const r = await provider.generate(p, imageModelOf(p.model), ctx);
    return { blobs: r.images, result: { seed: p.seed, blurred: r.blurred || undefined, violations: r.violations || undefined, enhancedPrompt: r.enhancedPrompt } };
  }
  const source = p.sourceBlobId ? await getImage(p.sourceBlobId) : null;
  if (!source) throw new ImageApiError({ kind: 'bad-request', message: t('err.noSource') });
  const op = p.op === 'upscale' ? provider.upscale : p.op === 'edit' ? provider.edit : provider.removeBackground;
  if (!op) throw new ImageApiError({ kind: 'bad-request', message: t('err.opUnsupported', { provider: provider.label }) });
  const blob = p.op === 'upscale' ? await provider.upscale!(source, p.scale ?? 2, ctx) : p.op === 'edit' ? await provider.edit!(source, p, ctx) : await provider.removeBackground!(source, ctx);
  return { blobs: [blob], result: {} };
}

/** What a request costs (estimate; undefined when unknown) */
export function estimateCost(p: ImageParams): number | undefined {
  return imageProviderOf(p.providerId)?.estimateCost(p, imageModelOf(p.model));
}

/** Who sees the prompt for the current image model (header badge, tool approval card) */
export function currentPrivacyLabel() {
  return providerFor(IMAGE_PROVIDER).privacyLabel(currentImageModel.value);
}

function recordImageUsage(conv: Conversation, p: ImageParams, count: number) {
  if (conv.temporary) return;
  const est = imageProviderOf(p.providerId)?.estimateCost({ ...p, variants: count }, imageModelOf(p.model));
  void repo
    .addUsage({
      id: repo.newId(),
      at: Date.now(),
      providerId: p.providerId,
      model: p.model || p.op,
      kind: 'image',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      ...(est !== undefined ? { costUsd: est, costEstimated: true } : {})
    })
    .catch(() => {});
  // Image prices are estimates (and some are unknown): restart the balance comparison instead of
  // adding a guess, so the "unexplained drop" alert is not triggered by our own image spend
  resetProviderBalanceBaseline(p.providerId);
}

export async function runImageJob(convId: string, userMsgId: string, override: Partial<ImageParams> = {}) {
  const conv = conversations.value.find((c) => c.id === convId);
  const user = messages.value.find((m) => m.id === userMsgId);
  if (!conv || !user?.imageRequest || !ensureImageKey()) return;
  const p: ImageParams = { ...user.imageRequest, ...override };
  // Always send a seed so "same settings again" can reproduce the picture
  if (p.op === 'generate' && p.seed === undefined) p.seed = randomSeed();
  const draft: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: user.id,
    role: 'assistant',
    parts: [],
    createdAt: Date.now(),
    status: 'streaming',
    meta: { providerId: p.providerId, model: p.model || p.op },
    image: { params: p }
  };
  messages.value = [...messages.value, draft];
  await putMessage(draft, conv);
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);
  const ctrl = beginRun(conv.id);
  let final: MessageRecord = draft;
  try {
    const { blobs, result } = await call(p, ctrl.signal);
    if (!blobs.length)
      throw new ImageApiError({ kind: 'bad-request', message: result.violations ? t('err.policy') : t('err.noImage') });
    const parts = await storeImages(conv, draft.id, blobs);
    final = { ...draft, parts, status: 'done', image: { params: p, ...result } };
    recordImageUsage(conv, p, blobs.length);
  } catch (e) {
    if (ctrl.signal.aborted) final = { ...draft, status: 'aborted' };
    else {
      const err: { kind: string; message: string; hint?: string } = e instanceof ImageApiError ? e.error : { kind: 'server', message: String((e as Error)?.message ?? e) };
      final = {
        ...draft,
        status: 'error',
        error: { kind: err.kind, message: err.message, hint: err.hint },
        image: { params: p, ...(e instanceof ImageApiError && e.suggestion ? { suggestion: e.suggestion } : {}) }
      };
    }
  } finally {
    endRun(conv.id);
  }
  await putMessage(final, conv);
  if (messages.value.some((m) => m.id === final.id)) messages.value = messages.value.map((m) => (m.id === final.id ? final : m));
  await updateConversation({ updatedAt: Date.now() }, conv.id);
}

/**
 * Delete images: the bytes are removed and the answers that showed them keep an empty slot
 * ("deleted"), so the conversation still reads correctly.
 */
export async function deleteImages(ids: string[]) {
  const gone = new Set(ids);
  queueMicrotask(() => imagesVersion.value++);
  const byConv = new Map<string, { temporary: boolean; messageIds: Set<string> }>();
  for (const id of ids) {
    const meta = await getImageMeta(id);
    if (!meta) continue;
    const g = byConv.get(meta.conversationId) ?? { temporary: meta.temporary, messageIds: new Set<string>() };
    g.messageIds.add(meta.messageId);
    byConv.set(meta.conversationId, g);
  }
  for (const [convId, g] of byConv) {
    const list = convId === currentId.value ? messages.value : await repo.listMessages(convId);
    for (const m of list) {
      if (!g.messageIds.has(m.id)) continue;
      const parts = m.parts
        .filter((p) => !(p.type === 'file' && gone.has(p.blobId)))
        .map((p) => {
          if (p.type !== 'tool' || !p.uiDetails || !Array.isArray((p.uiDetails as { blobIds?: unknown }).blobIds)) return p;
          const d = p.uiDetails as { blobIds: string[] };
          return { ...p, uiDetails: { ...d, blobIds: d.blobIds.filter((b) => !gone.has(b)), deleted: true } };
        });
      const updated: MessageRecord = { ...m, parts };
      await repo.putMessage(updated, g.temporary);
      if (convId === currentId.value) messages.value = messages.value.map((x) => (x.id === m.id ? updated : x));
    }
  }
  await deleteImageRecords(ids);
}

// Regenerating / editing an image request runs the image job again (with a new seed)
registerUserRequestHandler({
  id: 'images',
  matches: (m) => !!m.imageRequest,
  run: (convId, userMsgId) => runImageJob(convId, userMsgId, { seed: undefined }),
  edit: (orig, text) => (orig.imageRequest ? { imageRequest: { ...orig.imageRequest, prompt: text } } : {})
});

// ---- generate_image tool (chat models) ----
async function runImageTool(conv: Conversation, messageId: string, input: ImageToolInput, signal: AbortSignal) {
  if (!imageModels.value.length) await loadImageModels();
  const base = paramsFromBar(input.prompt);
  const p: ImageParams = { ...base, variants: 1, negativePrompt: input.negative_prompt, aspectRatio: input.aspect_ratio ?? base.aspectRatio, seed: randomSeed(), enhancePrompt: false };
  if (!p.model) throw new Error(t('err.modelsFailed'));
  const r = await providerFor(p.providerId).generate(p, imageModelOf(p.model), callContext(p.providerId, signal));
  if (!r.images.length) throw new Error(r.violations ? t('err.policy') : t('err.noImage'));
  const parts = await storeImages(conv, messageId, r.images);
  recordImageUsage(conv, p, r.images.length);
  return { blobIds: parts.map((x) => x.blobId), model: imageModelOf(p.model)?.name ?? p.model, blurred: !!r.blurred };
}

// Chat models can create images when the user turned it on (needs the image provider's key)
registerToolProvider({
  id: 'images',
  tools: ({ conv, messageId }) => {
    if (!imageSettings.value.value.imageTool || !imageReady.value) return [];
    // Load the model list now, so the approval card can name the model and its price
    if (!imageModels.value.length) void loadImageModels();
    return [makeImageTool((input, signal) => runImageTool(conv, messageId, input, signal))];
  }
});

