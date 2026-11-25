# Spec: image generation from more than one provider

Status: proposal (2026-11-25). Research notes: [image-provider-research.md](image-provider-research.md). It is meant to land together with step 1 of the [architecture migration](architecture.md#5-migration-plan-for-existing-features), moving images into `features/images`.

## 1. Goal

- Image generation works like chat providers do: choose a provider and model, use the key you already have, and do not depend on Venice.
- Everything still runs in the browser through the key vault. Providers that cannot be called from a browser are out of scope.

## 2. Which providers

| Phase | Provider | Why |
|---|---|---|
| 1 | **Venice** (existing) | — |
| 1 | **OpenRouter** | Already a chat provider (same key). It has a keyless image model list with prices, `seed`, and base64 output. |
| 1 | **Google Gemini** | Already a chat provider (same key). Image-output Gemini models via `:generateContent`. Imagen is shut down, so it is not supported. |
| 1 | **OpenAI** | The most requested. Base64 output and edits. It needs an OpenAI connection, which is also useful for chat. |
| 2 | xAI | Model list with prices. Request `b64_json`, since its image URLs have no CORS. |
| 2 | Stability AI | Richest editing: upscale, remove background, inpaint. Its body is multipart. |
| 2 | Together AI, fal.ai | Many open models. fal uses `Authorization: Key …`. Other models can be reached through OpenRouter. |
| — | Black Forest Labs, Replicate | No browser CORS; they would need a server. Use FLUX through OpenRouter, Together or fal instead. |

## 3. The provider interface (`features/images/providers/*`)

```ts
interface ImageProvider {
  id: string;                    // 'venice' | 'openrouter' | 'gemini' | 'openai' | …
  label: string;
  /** Key used (an LLM provider id or a service id in the vault) */
  account: string;
  /** Where prompts go and what the provider keeps: shown in the header and on the tool card */
  privacy(model: ImageModel): { level: 'private' | 'provider' | 'relayed'; note: string };
  listModels(t: Transport): Promise<ImageModel[]>;      // cached 6 h, like today
  generate(p: ImageParams, m: ImageModel, ctx): Promise<ImageOutput>;
  edit?(p: ImageParams, source: Blob, m: ImageModel, ctx): Promise<ImageOutput>;
  upscale?(source: Blob, scale: 2 | 4, ctx): Promise<ImageOutput>;
  removeBackground?(source: Blob, ctx): Promise<ImageOutput>;
  estimateCost(p: ImageParams, m: ImageModel): number | undefined;
}

interface ImageModel {
  id: string; name: string; providerId: string;
  /** What the option bar may show for this model */
  options: {
    aspectRatios?: string[]; sizes?: { w: number; h: number }[]; resolutions?: string[];
    maxVariants: number; seed: boolean; negativePrompt: boolean; styles?: string[];
    formats: ('png' | 'webp' | 'jpeg')[]; quality?: string[]; transparentBackground?: boolean;
  };
  pricing?: { perImage?: number; perResolution?: Record<string, number>; perMegapixel?: number; source: 'api' | 'table'; asOf?: string };
}

interface ImageOutput { images: Blob[]; seed?: number; blurred?: boolean; violations?: number; costUsd?: number; enhancedPrompt?: string; suggestion?: { prompt?: string; model?: string } }
```

- `ImageParams` already stores `providerId`. Old records keep `'venice'`.
- The option bar (`ImageBar`) shows only the options in `model.options`. Seed, negative prompt and style disappear for models that do not have them.
- The viewer shows upscale, remove background and edit only when the image's provider has them. Otherwise it offers to run the operation with another provider that does: "Venice で背景を除去".
- The `generate_image` tool uses the model chosen in the option bar, whatever its provider.
- **Cost**:
  - From the API where available: OpenRouter `pricing[]`, xAI `image_price`, and the response's `usage.cost` / `cost_in_usd_ticks` after the call.
  - Otherwise a dated price table kept in the preset (OpenAI, Gemini).
  - Otherwise "費用不明".
  - A cost the provider reports back is recorded as actual spend. An estimate only resets the balance baseline, as now.

## 4. Per-provider notes

- **OpenRouter**:
  - Models come from `GET /api/v1/images/models`, keyless.
  - Prices come from `/endpoints`, fetched lazily for the selected model.
  - Generate with `POST /api/v1/images` and `response_format: b64_json`. Edits use `input_references` with data URLs.
  - Privacy level `relayed`. Offer the `provider.zdr` toggle (on by default).
- **Gemini**:
  - Generate with `POST /v1beta/models/{m}:generateContent`, `responseModalities: ['IMAGE']` and `imageConfig: { aspectRatio, imageSize }`.
  - Never send the `Api-Revision` header; its CORS preflight is refused.
  - Edits send the source image as `inline_data` along with the instruction.
  - Show that the free tier may use content for training.
- **OpenAI**:
  - Generate with `POST /v1/images/generations`; base64 is always returned. The size list comes from the model.
  - Edits use `POST /v1/images/edits` with a JSON `images[]` data URL.
  - Transparent background replaces background removal.
  - No seed: hide "same settings again" and offer "似た画像を作る" only.
- **xAI** (phase 2): `b64_json` and `aspect_ratio` / `resolution`. Prices come from `/v1/image-generation-models`.
- **Stability** (phase 2):
  - Requests are `multipart/form-data` with `Accept: application/json`. `finish_reason: CONTENT_FILTERED` means blurred.
  - Endpoints are fixed per service, and their prices come from a table.
- **fal / Together** (phase 2):
  - Both have model-specific schemas, so support a curated list of models rather than the whole catalog.

## 5. Keys, CSP and settings

- Providers that are also chat providers (OpenRouter, Gemini, OpenAI once added) reuse the same vault key.
- Image-only services (Stability, fal, Together) are added like Tavily: a vault key and a section in Settings → チャット → 画像.
- Each provider's origin goes into `endpoints.ts`, so it reaches the vault CSP `connect-src`. The app CSP needs nothing new, because images come back as base64.
- In Settings → 画像:
  - choose which image providers are used;
  - set a default model per provider;
  - see the privacy note for each.
- The option bar's model menu is grouped by provider. The first time, it picks a model from a provider whose key is set.

## 6. Testing

- Unit tests per provider: request building, response parsing, cost estimates, option mapping.
- Add OpenAI-style, Gemini-style and OpenRouter-style image endpoints to the mock server, then check in the browser: generate on each, unsupported options hidden, edit / upscale availability, and the cost label.

## 7. Open questions for the user

1. Phase 1 order. Proposed: OpenRouter and Gemini first (they reuse keys you may already have), then OpenAI.
2. Add OpenAI as a chat provider too? It is natural once its key is in the vault for images.
3. When an operation is not supported by the image's own provider, offer another provider ("Venice で背景を除去"), or only hide the button?
