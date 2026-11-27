// Image generation: image mode in the input box, jobs (generate / upscale / edit / background removal),
// regeneration, the image viewer's state, and the generate_image tool for chat models.
// Providers are reached only through the ImageProvider interface.
import { computed, effect, signal } from '@preact/signals';
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
import { recordUsage } from '../../state/request-helpers';
import { conversations, currentConv, currentId, messages, persistDraft, putMessage, updateConversation } from '../../state/conversations';
import { beginRun, endRun } from '../../state/runs';
import { cancelSuggestions } from '../../state/suggestions';
import { resetProviderBalanceBaseline } from '../../state/balance';
import { registerToolProvider, registerUserRequestHandler } from '../../state/tool-registry';
import { veniceImageProvider } from './providers/venice';
import { openrouterImageProvider } from './providers/openrouter';
import { geminiImageProvider } from './providers/gemini';
import { openaiImageProvider } from './providers/openai';
import { ImageApiError, generationCost, hasOption, sizeOf, type ImageModelInfo } from './providers/common';
import { deepinfraImageProvider, nanogptImageProvider, togetherImageProvider } from './providers/hosts';
import { imageProviderList, imageProviderOf, registerImageProvider, type ImageCallContext, type ImageProvider } from './providers/types';
import { makeImageTool, type ImageToolInput } from './tool';
import type { IconName } from '../../components/ui';
import { t } from './messages';

// Image providers in menu order. A provider is offered once its key is set.
registerImageProvider(veniceImageProvider);
registerImageProvider(openrouterImageProvider);
registerImageProvider(geminiImageProvider);
registerImageProvider(openaiImageProvider);
registerImageProvider(nanogptImageProvider);
registerImageProvider(deepinfraImageProvider);
registerImageProvider(togetherImageProvider);

export interface ImageDefaults {
  /** The default image model (Settings → 画像): used by the generate_image tool and image mode */
  providerId: string;
  model: string;
  /** The chosen size (ImageSize.id) of the model */
  size: string;
  /** The chosen aspect ratio, kept when the model changes (its size ids differ) */
  aspectRatio: string;
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
  imageDefaults: { providerId: '', model: '', size: '', aspectRatio: '1:1', variants: 1, style: '', negativePrompt: '', enhancePrompt: false, seed: '' } as ImageDefaults,
  /** Let chat models create images with the generate_image tool */
  imageTool: true
};
export const imageSettings = defineFeatureSettings('images', DEFAULT_IMAGE_SETTINGS, (old) => {
  const p = pickLegacy(old, DEFAULT_IMAGE_SETTINGS);
  return p.imageDefaults ? { ...p, imageDefaults: { ...DEFAULT_IMAGE_SETTINGS.imageDefaults, ...p.imageDefaults } } : p;
});

/** Changes to an existing image, and the provider method that runs each */
export type EditOp = 'upscale' | 'edit' | 'remove-bg';
const EDIT_METHOD = { upscale: 'upscale', edit: 'edit', 'remove-bg': 'removeBackground' } as const;

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
/** An image in the viewer; one brought in by the user belongs to no conversation */
export interface LightboxItem {
  blobId: string;
  conversationId?: string;
  messageId?: string;
  /** The file name to download it as (the file manager knows it) */
  name?: string;
  /** A video (stored with the images): played, and not offered image edits */
  video?: boolean;
}
/** Actions another feature adds for an image (video: make a video from it), shown in the viewer and on image answers */
export interface ImageAction {
  id: string;
  label(): string;
  title(): string;
  icon: IconName;
  /** Offered only while this holds (e.g. a video provider has a key) */
  shown(): boolean;
  run(blobId: string, name?: string): void | Promise<void>;
}
export const imageActions: ImageAction[] = [];
export function registerImageAction(a: ImageAction) {
  const i = imageActions.findIndex((x) => x.id === a.id);
  if (i >= 0) imageActions[i] = a;
  else imageActions.push(a);
}

/** fromGallery: opened from the file manager (offers to open the image's conversation) */
export const lightbox = signal<{ items: LightboxItem[]; index: number; fromGallery?: boolean } | null>(null);

export const imageModels = signal<ImageModelInfo[]>([]);
export const imageModelsError = signal<string | null>(null);
/** Style presets per provider (loaded for the current model's provider) */
const styleLists = signal<Record<string, string[]>>({});
export const imageStyles = computed(() => styleLists.value[currentImageModel.value?.providerId ?? ''] ?? []);

/** Image providers whose key is set (generation needs it, so only their models are offered) */
export const readyImageProviders = computed(() => imageProviderList().filter((p) => keyReady(p.account)));
/** Image generation needs the key of at least one image provider */
export const imageReady = computed(() => readyImageProviders.value.length > 0);

/** Where an edit runs: a provider, and the model for edits from a prompt ('' = the provider's own) */
export interface EditTarget {
  provider: ImageProvider;
  model: string;
}

/**
 * Where an edit of an image runs. from: the provider and model that made it.
 * Upscale and background removal: that provider when it offers them, else the first ready one that does.
 * Edit from a prompt: the model that made the image when it edits, else that provider's own edit model, else the
 * current image model when it edits, else a provider with its own edit model, else any model that edits.
 */
export function editTargetFor(op: EditOp, from: { providerId?: string; model?: string } = {}): EditTarget | undefined {
  const able = readyImageProviders.value.filter((p) => !!p[EDIT_METHOD[op]]);
  if (op !== 'edit') {
    const provider = able.find((p) => p.id === from.providerId) ?? able[0];
    return provider && { provider, model: '' };
  }
  const byModel = (m: ImageModelInfo | undefined): EditTarget | undefined => {
    const provider = m?.edits && able.find((p) => p.id === m.providerId);
    return provider ? { provider, model: m!.id } : undefined;
  };
  const own = (p: ImageProvider | undefined): EditTarget | undefined => (p?.ownEditModel ? { provider: p, model: '' } : undefined);
  return (
    byModel(imageModelOf(from.providerId, from.model)) ??
    own(able.find((p) => p.id === from.providerId)) ??
    byModel(currentImageModel.value) ??
    own(able.find((p) => p.ownEditModel)) ??
    byModel(imageModels.value.find((m) => byModel(m)))
  );
}

/** v2: models describe their sizes as one list */
const cacheKey = (id: string) => `cache:imageModels:v2:${id}`;
let loading: Promise<void> | null = null;

/** Image models of every provider whose key is set (each list cached for 6 hours) */
export function loadImageModels(force = false): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const errors: string[] = [];
    const lists = await Promise.all(
      readyImageProviders.value.map(async (p) => {
        const cached = await repo.getSetting<{ at: number; list: ImageModelInfo[] } | null>(cacheKey(p.id), null);
        if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return cached.list;
        try {
          const list = await p.listModels(providerConfigOf(p.account)!, p.keyedList ? transport : plainTransport, p.keyedList ? authFor(p.account) : undefined);
          await repo.setSetting(cacheKey(p.id), { at: Date.now(), list });
          return list;
        } catch (e) {
          errors.push(`${p.label}: ${(e as Error).message}`);
          return cached?.list ?? [];
        }
      })
    );
    imageModels.value = lists.flat();
    imageModelsError.value = errors.length ? errors.join(' / ') : null;
  })().finally(() => (loading = null));
  return loading;
}

/** Style presets of the current model's provider (once per provider) */
export async function loadImageStyles() {
  const p = imageProviderOf(currentImageModel.value?.providerId ?? '');
  if (!p?.listStyles || p.id in styleLists.value || !keyReady(p.account)) return;
  try {
    const list = await p.listStyles(callContext(p.id));
    styleLists.value = { ...styleLists.value, [p.id]: list };
  } catch {
    /* styles are optional */
  }
}

export function imageModelOf(providerId: string | undefined, id: string | undefined): ImageModelInfo | undefined {
  return imageModels.value.find((m) => m.id === id && (!providerId || m.providerId === providerId));
}

/** Models that make images from text (edit-only models are left out of the menus) */
export const generationModels = computed(() => imageModels.value.filter((m) => m.edits !== 'only'));

/** "provider|model" (how a model choice is stored on a conversation) */
export const modelRef = (m: { providerId: string; id: string }) => `${m.providerId}|${m.id}`;
function byRef(ref: string | undefined): ImageModelInfo | undefined {
  const i = ref?.indexOf('|') ?? -1;
  return ref && i > 0 ? imageModelOf(ref.slice(0, i), ref.slice(i + 1)) : undefined;
}

/** The default model: the one chosen in settings, else one its provider marks as default (Venice does), else the first one */
export const defaultImageModel = computed(() => {
  const list = generationModels.value;
  const d = imageSettings.value.value.imageDefaults;
  return imageModelOf(d.providerId || undefined, d.model || undefined) ?? list.find((m) => m.traits.includes('default')) ?? list[0];
});

/** The model for a conversation: its own choice in image mode, else the default */
export function imageModelFor(conv: Conversation | undefined): ImageModelInfo | undefined {
  return byRef(conv?.imageModel) ?? defaultImageModel.value;
}

/** The model the image bar (and the tool, in the current conversation) uses */
export const currentImageModel = computed(() => imageModelFor(currentConv.value));

export async function setImageDefaults(patch: Partial<ImageDefaults>) {
  await imageSettings.save({ imageDefaults: { ...imageSettings.value.value.imageDefaults, ...patch } });
}

/** Choose the model for the current conversation only (the image bar); the default clears the choice */
export async function setConversationImageModel(m: ImageModelInfo) {
  const isDefault = defaultImageModel.value && modelRef(defaultImageModel.value) === modelRef(m);
  await updateConversation({ imageModel: isDefault ? undefined : modelRef(m) });
  await setImageDefaults({ size: '' });
}

/** Choose the default model (settings) */
export async function setDefaultImageModel(m: ImageModelInfo) {
  await setImageDefaults({ providerId: m.providerId, model: m.id, size: '' });
}

// Prices some providers list per model (OpenRouter) are fetched when the model is in use
const pricingAsked = new Set<string>();
effect(() => {
  for (const m of [currentImageModel.value, defaultImageModel.value]) {
    if (!m || pricingAsked.has(modelRef(m))) continue;
    const p = imageProviderOf(m.providerId);
    if (!p?.loadPricing || m.pricing.generation !== undefined || m.constraints.sizes.some((s) => s.price !== undefined)) continue;
    pricingAsked.add(modelRef(m));
    void p
      .loadPricing(m, providerConfigOf(p.account)!, plainTransport)
      .then((priced) => {
        if (priced !== m) imageModels.value = imageModels.peek().map((x) => (modelRef(x) === modelRef(m) ? priced : x));
      })
      .catch(() => {});
  }
});

const randomSeed = () => Math.floor(Math.random() * 999_999_999);

/** Whether an image provider can be used now (its key is set and unlocked) */
export const imageProviderReady = (providerId: string) => keyReady(imageProviderOf(providerId)?.account ?? providerId);

function ensureImageKey(providerId?: string): boolean {
  if (providerId ? imageProviderReady(providerId) : imageReady.value) return true;
  openSettings('connections');
  showToast(t('bar.needKey'), 'error');
  return false;
}

/** Turn image mode on/off for the current conversation (or the new chat) */
export async function setImageMode(on: boolean) {
  // It takes the input box over from video mode
  await updateConversation(on ? { imageMode: true, videoMode: false } : { imageMode: false });
  if (on) {
    void loadImageModels();
    void loadImageStyles();
  }
}

/** Parameters for a new request with a conversation's model and the bar's options (options the model lacks are left out) */
export function paramsFor(conv: Conversation | undefined, prompt: string): ImageParams {
  const d = imageSettings.value.value.imageDefaults;
  const m = imageModelFor(conv);
  const seed = d.seed.trim() ? Number(d.seed) : undefined;
  const size = sizeOf(m, d);
  return {
    op: 'generate',
    providerId: m?.providerId ?? '',
    model: m?.id ?? '',
    prompt,
    negativePrompt: hasOption(m, 'negativePrompt') ? d.negativePrompt || undefined : undefined,
    size: size?.id,
    aspectRatio: size ? size.aspect : d.aspectRatio || undefined,
    resolution: size?.tier,
    variants: Math.min(4, Math.max(1, d.variants)),
    style: hasOption(m, 'styles') ? d.style || undefined : undefined,
    seed: hasOption(m, 'seed') && Number.isFinite(seed) ? seed : undefined,
    enhancePrompt: hasOption(m, 'enhance') ? d.enhancePrompt || undefined : undefined,
    safeMode: false,
    format: imageSettings.value.value.imageFormat
  };
}

/** Parameters for a new request from the image bar (the current conversation) */
export function paramsFromBar(prompt: string): ImageParams {
  return paramsFor(currentConv.value, prompt);
}

/** Send an image prompt from the input box */
export async function sendImagePrompt(prompt: string) {
  if (!prompt.trim() || !ensureImageKey()) return;
  if (!imageModels.value.length) await loadImageModels();
  const p = paramsFromBar(prompt.trim());
  if (!ensureImageKey(p.providerId)) return;
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

/** Upscale / remove the background of / edit an image. from: the provider and model that made it (see editTargetFor) */
export async function imageAction(op: EditOp, sourceBlobId: string, opts: { scale?: 2 | 4; prompt?: string; from?: { providerId?: string; model?: string } } = {}) {
  const target = editTargetFor(op, opts.from);
  if (!target) return;
  const text = op === 'upscale' ? t('request.upscaleText', { scale: opts.scale ?? 2 }) : op === 'remove-bg' ? t('request.removeBgText') : (opts.prompt ?? '').trim();
  if (!text) return;
  // In a new chat (an image whose conversation was deleted) the request starts a saved conversation
  const conv = await persistDraft(text);
  const p: ImageParams = {
    op,
    providerId: target.provider.id,
    model: target.model,
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
  return parts;
}

/** Call the provider for one job */
async function call(p: ImageParams, signal: AbortSignal): Promise<{ blobs: Blob[]; result: Partial<ImageResult>; costUsd?: number }> {
  const provider = providerFor(p.providerId);
  const ctx = callContext(p.providerId, signal);
  if (p.op === 'generate') {
    const r = await provider.generate(p, imageModelOf(p.providerId, p.model), ctx);
    return { blobs: r.images, result: { seed: p.seed, blurred: r.blurred || undefined, violations: r.violations || undefined, enhancedPrompt: r.enhancedPrompt }, costUsd: r.costUsd };
  }
  const source = p.sourceBlobId ? await getImage(p.sourceBlobId) : null;
  if (!source) throw new ImageApiError({ kind: 'bad-request', message: t('err.noSource') });
  if (!provider[EDIT_METHOD[p.op]]) throw new ImageApiError({ kind: 'bad-request', message: t('err.opUnsupported', { provider: provider.label }) });
  const blob = p.op === 'upscale' ? await provider.upscale!(source, p.scale ?? 2, ctx) : p.op === 'edit' ? await provider.edit!(source, p, ctx) : await provider.removeBackground!(source, ctx);
  return { blobs: [blob], result: {} };
}

/** What a request costs (estimate; undefined when unknown) */
export function estimateCost(p: ImageParams): number | undefined {
  if (p.op === 'generate') return generationCost(p, imageModelOf(p.providerId, p.model));
  // An edit on a model of the list costs about one image of that model
  return imageProviderOf(p.providerId)?.editCost?.(p) ?? (p.model ? generationCost({ ...p, variants: 1 }, imageModelOf(p.providerId, p.model)) : undefined);
}

/** Who sees the prompt for a model (input box, tool approval card) */
export function privacyLabelOf(m: ImageModelInfo | undefined) {
  return (m && imageProviderOf(m.providerId)?.privacyLabel(m)) ?? { tone: 'zinc' as const, label: '', title: '' };
}

/** Who sees the prompt for the current image model */
export function currentPrivacyLabel() {
  return privacyLabelOf(currentImageModel.value);
}

/** Record an image job: the cost the provider reported, else the estimate (also counted in the conversation's total) */
function recordImageUsage(conv: Conversation, p: ImageParams, count: number, reported?: number): number | undefined {
  const est = reported ?? estimateCost({ ...p, variants: count });
  recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: p.providerId, model: p.model || p.op, kind: 'image', costUsd: est, costEstimated: reported === undefined, temporary: conv.temporary });
  // Image prices are estimates (and some are unknown): restart the balance comparison instead of
  // adding a guess, so the "unexplained drop" alert is not triggered by our own image spend
  resetProviderBalanceBaseline(p.providerId);
  return est;
}

export async function runImageJob(convId: string, userMsgId: string, override: Partial<ImageParams> = {}) {
  const conv = conversations.value.find((c) => c.id === convId);
  const user = messages.value.find((m) => m.id === userMsgId);
  if (!conv || !user?.imageRequest || !ensureImageKey()) return;
  const p: ImageParams = { ...user.imageRequest, ...override };
  if (!ensureImageKey(p.providerId)) return;
  // Send a seed (when the model takes one) so "same settings again" can reproduce the picture
  if (p.op === 'generate' && p.seed === undefined && hasOption(imageModelOf(p.providerId, p.model), 'seed')) p.seed = randomSeed();
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
    const { blobs, result, costUsd } = await call(p, ctrl.signal);
    if (!blobs.length)
      throw new ImageApiError({ kind: 'bad-request', message: result.violations ? t('err.policy') : t('err.noImage') });
    const parts = await storeImages(conv, draft.id, blobs);
    final = { ...draft, parts, status: 'done', image: { params: p, ...result } };
    recordImageUsage(conv, p, blobs.length, costUsd);
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
  const byConv = new Map<string, { temporary: boolean; messageIds: Set<string> }>();
  for (const id of ids) {
    const meta = await getImageMeta(id);
    // Brought-in images belong to no answer
    if (!meta?.conversationId || !meta.messageId) continue;
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

// Regenerating / editing an image request runs the image job again (with a new seed). Upscaling and background
// removal take no prompt, so their text is not edited
registerUserRequestHandler({
  id: 'images',
  matches: (m) => !!m.imageRequest,
  run: (convId, userMsgId) => runImageJob(convId, userMsgId, { seed: undefined }),
  ready: (m) => !!m.imageRequest && imageProviderReady(m.imageRequest.providerId),
  edit: (orig, text) => (orig.imageRequest && (orig.imageRequest.op === 'generate' || orig.imageRequest.op === 'edit') ? { imageRequest: { ...orig.imageRequest, prompt: text } } : undefined)
});

// ---- generate_image tool (chat models) ----
/** The request the generate_image tool makes for an input (shown in full on its card before and after running) */
export function toolParams(conv: Conversation | undefined, input: Partial<ImageToolInput>): ImageParams {
  const base = paramsFor(conv, input.prompt ?? '');
  const m = imageModelFor(conv);
  // The aspect the chat model asked for, in the bar's tier (when the image model has that aspect)
  const asked = input.aspect_ratio ? sizeOf(m, { aspectRatio: input.aspect_ratio, resolution: base.resolution }) : undefined;
  const sized = asked && asked.aspect === input.aspect_ratio ? { size: asked.id, aspectRatio: asked.aspect, resolution: asked.tier } : {};
  return { ...base, ...sized, variants: 1, negativePrompt: hasOption(m, 'negativePrompt') ? input.negative_prompt : undefined, seed: hasOption(m, 'seed') ? randomSeed() : undefined, enhancePrompt: false };
}

async function runImageTool(conv: Conversation, messageId: string, input: ImageToolInput, signal: AbortSignal) {
  if (!imageModels.value.length) await loadImageModels();
  const p = toolParams(conv, input);
  if (!p.model) throw new Error(t('err.modelsFailed'));
  const model = imageModelOf(p.providerId, p.model);
  const r = await providerFor(p.providerId).generate(p, model, callContext(p.providerId, signal));
  if (!r.images.length) throw new Error(r.violations ? t('err.policy') : t('err.noImage'));
  const parts = await storeImages(conv, messageId, r.images);
  const cost = recordImageUsage(conv, p, r.images.length, r.costUsd);
  return {
    blobIds: parts.map((x) => x.blobId),
    model: model?.name ?? p.model,
    blurred: !!r.blurred,
    request: { provider: imageProviderOf(p.providerId)?.label ?? p.providerId, prompt: p.prompt, negativePrompt: p.negativePrompt, aspectRatio: p.aspectRatio, resolution: p.resolution, size: p.size, costUsd: cost, costEstimated: r.costUsd === undefined }
  };
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

