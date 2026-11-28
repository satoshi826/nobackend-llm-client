// Image generation on the open-model hosts that offer an OpenAI-style Images API: NanoGPT, DeepInfra, Together.
// They use the same key as their chat provider (account). Requests from a browser are allowed (checked 2026-11-26).
// Images come back as base64 (a URL answer could not be fetched: the app reaches only fixed hosts), and their type
// is read from the bytes, since the APIs do not say it.
// - NanoGPT: its own image model list (no key), each model with its own size names and a price per size; the sizes
//   are offered as they are (no aspect ratios) and sent as `size`
// - DeepInfra: image models in the chat model list (tag image-gen), a price per image; sizes as width x height
// - Together: image models in its keyed model list (type image); no prices in the list
import type { AuthRef, ProviderConfig, Transport } from '../../../lib/providers/types';
import { blobToDataUrl } from '../../../lib/db/images';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import type { ImageProvider } from './types';
import { DEFAULT_ASPECTS, ImageApiError, aspectAndTier, fetchModelList, hasOption, imageCount, jsonPost, promptStyleOf, sendImageRequest, sizeGrid, sizeOf, type ImageModelInfo } from './common';
import { t } from '../messages';

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/** width x height for the shared aspect ratios (multiples of 64, about one megapixel) */
const SIZES: Record<string, [number, number]> = { '1:1': [1024, 1024], '4:3': [1152, 896], '3:4': [896, 1152], '16:9': [1344, 768], '9:16': [768, 1344] };
export const sizeFor = (aspect: string | undefined): [number, number] => SIZES[aspect ?? '1:1'] ?? SIZES['1:1'];

/** The image type from its first bytes (PNG, JPEG, WebP, GIF); PNG when unknown */
export function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'image/png';
}

function fromBase64(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: sniffMime(bytes) });
}

/** POST {base}/images/generations and read the base64 images out of data[] */
async function generateImages(cfg: ProviderConfig, transport: Transport, auth: AuthRef | undefined, body: Record<string, unknown>, signal?: AbortSignal) {
  const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, 'images/generations'), jsonPost(body, signal), auth);
  const data = await res.json();
  const images = (Array.isArray(data?.data) ? data.data : []).filter((x: any) => typeof x?.b64_json === 'string').map((x: any) => fromBase64(x.b64_json));
  if (!images.length) throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
  const cost = num(data?.cost) ?? num(data?.usage?.cost);
  return { images, ...(cost !== undefined ? { costUsd: cost } : {}) };
}

// ---- NanoGPT ----
export function mapNanoImageModel(raw: any, providerId = 'nanogpt'): ImageModelInfo | null {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const inputs: string[] = raw?.architecture?.input_modalities ?? [];
  // Text-to-image only (not background removal or other image-in tools)
  if (!id || !inputs.includes('text') || raw?.capabilities?.image_generation === false) return null;
  const names: string[] = Array.isArray(raw?.supported_parameters?.resolutions) ? raw.supported_parameters.resolutions.filter((s: unknown) => typeof s === 'string') : [];
  const prices = raw?.pricing?.per_image ?? {};
  // Ids do not always match the model (animagine-xl-31 is "Crystal Clear XL"), so the style comes from the name
  const name = typeof raw.name === 'string' ? raw.name : id;
  const limit = num(raw?.supported_parameters?.max_prompt_characters);
  return {
    providerId,
    id,
    name,
    privacy: 'unknown',
    traits: [],
    ...promptStyleOf(name, typeof raw.description === 'string' ? raw.description : ''),
    ...(limit ? { promptLimit: limit } : {}),
    // The provider's own size names (e.g. square_hd, landscape_16_9, 2048x2048), each with its price
    constraints: { sizes: names.map((n) => ({ id: n, price: num(prices[n]) })), defaultSize: names[0] },
    pricing: {},
    maxImages: num(raw?.supported_parameters?.max_images),
    // image_to_image: takes an image to edit; models named "…edit" only edit
    ...(raw?.capabilities?.image_to_image ? { edits: /(^|[/-])edit/i.test(id) ? ('only' as const) : ('also' as const) } : {}),
    // A seed where the model lists one (negative_prompt is listed too, but the API reference does not document it)
    options: { seed: !!raw?.supported_parameters?.seed, negativePrompt: false, styles: false, enhance: false }
  };
}

export const nanogptImageProvider: ImageProvider = {
  id: 'nanogpt',
  label: 'NanoGPT',
  account: 'nanogpt',
  listModels: (cfg, transport) => fetchModelList(transport, joinUrl(cfg.baseUrl, 'image-models'), undefined, (r) => mapNanoImageModel(r, cfg.id)),
  generate(p, m, c) {
    const size = sizeOf(m, p)?.id;
    return generateImages(
      c.config,
      c.transport,
      c.auth,
      { model: p.model, prompt: p.prompt, n: imageCount(p, m), ...(size ? { size } : {}), ...(p.seed !== undefined && hasOption(m, 'seed') ? { seed: p.seed } : {}), response_format: 'b64_json' },
      c.signal
    );
  },
  // The image goes as imageDataUrl (a data: URL, up to 4 MB)
  async edit(source, p, c) {
    const { images } = await generateImages(c.config, c.transport, c.auth, { model: p.model, prompt: p.prompt, n: 1, imageDataUrl: await blobToDataUrl(source), response_format: 'b64_json' }, c.signal);
    return images[0];
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'NanoGPT', title: t('privacy.nanogptTitle') })
};

// ---- DeepInfra ----
/** Image models that need an image in (editing, expanding, background removal, vectors) are left out */
const DEEPINFRA_SKIP = /edit|expand|rmbg|remov|upscal|inpaint|vector/i;

export function mapDeepInfraImageModel(raw: any, providerId = 'deepinfra'): ImageModelInfo | null {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const m = raw?.metadata ?? {};
  if (!id || !(m.tags ?? []).includes('image-gen') || DEEPINFRA_SKIP.test(id)) return null;
  const each = num(m.pricing?.per_image_unit);
  return {
    providerId,
    id,
    name: id,
    privacy: 'unknown',
    traits: [],
    ...promptStyleOf(id, typeof m.description === 'string' ? m.description : ''),
    constraints: { sizes: sizeGrid(DEFAULT_ASPECTS), defaultSize: '1:1' },
    pricing: each !== undefined ? { generation: each } : {},
    options: { seed: false, negativePrompt: false, styles: false, enhance: false }
  };
}

export const deepinfraImageProvider: ImageProvider = {
  id: 'deepinfra',
  label: 'DeepInfra',
  account: 'deepinfra',
  listModels: (cfg, transport) => fetchModelList(transport, joinUrl(cfg.baseUrl, 'models'), undefined, (r) => mapDeepInfraImageModel(r, cfg.id)),
  generate(p, m, c) {
    const [w, h] = sizeFor(aspectAndTier(m, p).aspect);
    return generateImages(c.config, c.transport, c.auth, { model: p.model, prompt: p.prompt, n: imageCount(p, m), size: `${w}x${h}`, response_format: 'b64_json' }, c.signal);
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'DeepInfra', title: t('privacy.deepinfraTitle') })
};

// ---- Together ----
export function mapTogetherImageModel(raw: any, providerId = 'together'): ImageModelInfo | null {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  if (!id || raw?.type !== 'image') return null;
  const name = typeof raw.display_name === 'string' ? raw.display_name : id;
  return {
    providerId,
    id,
    name,
    privacy: 'unknown',
    traits: [],
    ...promptStyleOf(name),
    constraints: { sizes: sizeGrid(DEFAULT_ASPECTS), defaultSize: '1:1' },
    pricing: {},
    options: { seed: false, negativePrompt: false, styles: false, enhance: false }
  };
}

export const togetherImageProvider: ImageProvider = {
  id: 'together',
  label: 'Together',
  account: 'together',
  keyedList: true,
  listModels: (cfg, transport, auth) => fetchModelList(transport, joinUrl(cfg.baseUrl, 'models'), auth, (r) => mapTogetherImageModel(r, cfg.id), (data) => (Array.isArray(data) ? data : data?.data)),
  generate(p, m, c) {
    const [width, height] = sizeFor(aspectAndTier(m, p).aspect);
    return generateImages(c.config, c.transport, c.auth, { model: p.model, prompt: p.prompt, n: imageCount(p, m), width, height, response_format: 'base64' }, c.signal);
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'Together', title: t('privacy.togetherTitle') })
};
