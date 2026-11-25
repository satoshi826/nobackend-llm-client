# Image generation providers: research notes (2026-11-25)

Input for the image-provider abstraction spec. CORS was checked with keyless `OPTIONS` preflights from a foreign origin (no credentials sent); a "yes" means the preflight passed, not that an authenticated call was made. Some details come from summarized doc pages and should be spot-checked before implementing.

| Provider | Browser-callable | Sync / async | Output | Editing | Model list with prices |
|---|---|---|---|---|---|
| OpenAI (`/v1/images/generations`, `/edits`) | Yes (ACAO `*`) | Sync (+SSE) | base64 only (GPT Image) | edits: multi-image, mask; no upscale / bg removal (use `background: transparent`) | No prices in `/v1/models`; `usage` tokens per response |
| Google Gemini API (`:generateContent`, `/v1beta/interactions`) | Yes (origin echoed; do **not** send `Api-Revision`, its preflight is refused) | Sync | base64 inline | conversational edit, up to 14 references; Imagen is shut down | No prices in `models.list` |
| OpenRouter (`/api/v1/images`, also chat completions for text+image models) | Yes (ACAO `*`) | Sync (+SSE) | `b64_json` (default) or URL (24 h) | `input_references`; model-dependent | **Yes, keyless**: `/api/v1/images/models` (+ `/endpoints` for per-provider `pricing[]`) |
| xAI (`/v1/images/generations`, `/edits`) | Yes (ACAO `*`) | Sync; optional deferred polling | URL (default; host has no CORS) or `b64_json` | edits (up to 5 images, prompt only) | **Yes**: `/v1/image-generation-models` |
| Stability AI (`/v2beta/stable-image/...`) | Yes (ACAO `*`); **multipart** body | Mostly sync; some async | bytes or base64 JSON | extensive: inpaint, erase, outpaint, remove-bg, 3 upscalers | No list; fixed credit prices per service |
| Together AI (`/v1/images/generations`) | Yes (ACAO `*`) | Sync | URL (host CORS unverified) or base64 | `image_url` / `reference_images` | `/v1/models` needs a key |
| fal.ai (`fal.run`, `queue.fal.run`) | Yes (origin echoed); auth `Key <key>` | Sync or queue | URL on `fal.media` (ACAO `*`) or data URI | huge catalog (edit, inpaint, upscale, bg removal) | **Yes**: `/v1/models` keyless, `/v1/models/pricing` with key |
| Black Forest Labs | **No** (origin allowlist) | Async | signed URL (no CORS) | yes | no |
| Replicate | **No** (no ACAO headers) | Async | URL | model-dependent | needs key |

Notes:
- Ask for base64 wherever possible (xAI `b64_json`, Together `base64`, OpenRouter default).
- Seed / negative prompt / style exist only on some providers (Venice, Stability, Together, fal models, OpenRouter `seed`); the UI must hide unsupported options per model.
- Retention: OpenAI 30-day abuse logs (ZDR-eligible models), Gemini free tier may use content for training (paid tier does not), Together ZDR by default, fal stores I/O 90 days unless `X-Fal-Store-IO: 0`, OpenRouter per-request `provider.zdr`.
- BFL and Replicate would need a server proxy, so they do not fit this app.
