# Spec: web search and images — capabilities and routes

Status: accepted 2026-11-25. Related: [image-providers.md](image-providers.md) (image providers), [architecture.md](architecture.md) (extension points).

## 1. The model: capability × route

Users choose **what** they want (a capability); the app decides **how** it is done (the route). The two are kept apart in code and in the UI.

| Route | How it runs | Web search | Images |
|---|---|---|---|
| **A. Direct** | The app calls a service; no chat model in between | — | Image mode (prompt → image model) |
| **B. App tool** | The chat model calls a tool; the app runs it | `web_search` (Tavily), `fetch_url` (Jina Reader) | `generate_image` (the image provider) |
| **C. Native** | The chat provider does it inside the same request, on its servers | Venice, Anthropic, OpenRouter, Groq Compound, Gemini | Models that output images (Gemini image models, OpenRouter image-output models) |

Rules:

1. **The UI shows capabilities, not routes.** Web search is a global setting (on by default); there is no per-conversation search toggle in the composer. Which route a reply used is shown where it matters: on the sources of an answer and in Settings → Web 検索 (per connection).
2. **Wire formats belong to providers.** A preset (or adapter) says whether a model can search natively and turns the request flag into its own request shape; it parses the provider's results into normalized events. Features own the settings and the UI, never a wire format.
3. **Results are normalized**, whatever the route: search results become `source` parts (and a `server-tool` part that shows the query), images become stored images (`file` parts with a `blobId`) that the gallery, backups and regeneration handle like any other image.
4. **Image routes mean different things to users and stay distinct:** image mode = "send this prompt to an image model"; the tool = "the chat model may make an image when it decides to"; native output = a property of the chosen model (replies may contain images; nothing to switch on).

## 2. Web search

### 2.1 Route resolution (`features/web/state.ts` `searchRouteFor`)

```
web search off in settings          → none
model can search natively           → native   (unless the user prefers Tavily and it is usable)
model calls tools and Tavily key    → tools
otherwise                           → none
```

- Setting `web.enabled` (default **on**) and `web.prefer` (`native` | `tools`, default `native`).
- Native needs no extra key; it is billed by the chat provider per search. It runs on the provider's servers, so there is **no per-search confirmation** — only the global switch. The settings tab says so, with the cost note per provider.
- Tools route: `web_search` runs without confirmation by default (it sends only a query, like native search); `fetch_url` asks first by default (a page could steer the model into putting conversation text in a URL it then fetches through a third party).

### 2.2 Native search per provider

| Provider | Request | Results |
|---|---|---|
| Venice | `venice_parameters.enable_web_search` (`auto` / `on`) | `venice_parameters.web_search_citations` → sources; `^n^` markers → links |
| Anthropic | server tool `web_search` (`web_search_20260209` on models that support dynamic filtering, else `web_search_20250305`), `max_uses` | `server_tool_use` + `web_search_tool_result` blocks; `citations_delta` on text; `pause_turn` → continue the same turn |
| OpenRouter | server tool `openrouter:web_search` | `url_citation` annotations |
| Groq | Compound models search by themselves | `executed_tools` search results |
| Gemini | `tools: [{ google_search: {} }]` (native adapter, §4) | `groundingMetadata.groundingChunks` |

A preset declares it with `nativeWebSearch: { supports(modelId, model) }`; the request carries `ChatRequest.webSearch` (`'auto' | 'on' | undefined`) and the adapter or the preset's `transformRequest` turns it into the provider's shape.

### 2.3 Multi-turn

Provider-specific search blocks (Anthropic `server_tool_use` / `web_search_tool_result`) are kept on the `server-tool` part only while the turn runs (they must be sent back to continue after `pause_turn`); they are dropped when the turn ends. Later turns send the answer text only. Sources stay on the message for display.

## 3. Images

- **Direct and tool routes** use the image-provider registry ([image-providers.md](image-providers.md)).
- **Native output**: models whose list entry says they output images (`capabilities.imageOutput`). The request asks for image output only for those models (OpenRouter `modalities: ["image", "text"]`; Gemini `responseModalities: ["TEXT", "IMAGE"]`). Images that come back (base64) are stored with `lib/db/images` (conversation, message, model, prompt) and added to the message as `file` parts. The images feature renders them and lists them in the file manager.
- Images in earlier turns are not sent back as images (a short note is), as today.

## 4. Gemini native adapter (`lib/providers/gemini.ts`)

The OpenAI-compatible endpoint cannot use Google Search grounding, so Gemini moves to the native `generateContent` API (`streamGenerateContent?alt=sse`, key in `x-goog-api-key`). The adapter covers text, thought summaries, function calling (with `thoughtSignature` sent back on the same model's parts), Google Search grounding, image output and usage. Existing Gemini connections are migrated (kind and base URL).

## 5. Privacy and cost

- Settings → Privacy & data lists where search queries go for each enabled connection (the chat provider itself, OpenRouter's search engine, Tavily / Jina).
- Search counts (and costs when the provider reports them) are recorded on the answer and in usage.
