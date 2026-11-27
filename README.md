# nobackend-llm-client

**English** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

> Bring your own API key. No backend — runs entirely in your browser.

A chat client for LLM APIs that doesn't need a server and doesn't keep logs. It's for people who want to use less-censored or open-weight models without leaving their conversations in a SaaS product, and without hosting their own server or running a model locally.

- **No backend**: static files only. Your browser talks directly to the provider's API with your key. No account, no analytics, no third-party scripts.
- **Your data stays local**: conversations and settings are stored in your browser (IndexedDB).
- **Keys are hard to steal**: API keys live only in a separate key vault page and never reach the app itself. The vault attaches a key only to that provider's fixed host. There's a strict CSP with Trusted Types.
- **Optional passphrase**: encrypts both API keys and conversations at rest. The whole app stays behind a lock screen until you unlock it.

The UI is available in Japanese, English and Simplified Chinese (automatic, or chosen in Settings → Appearance). Principles and rules: [docs/principles.md](docs/principles.md).

## Features

- **Providers**: Venice, OpenRouter, Anthropic, Google Gemini, OpenAI, DeepSeek, Groq, NanoGPT, DeepInfra, Cerebras, Novita, Chutes, Together, plus OpenAI-compatible endpoints added at build time (e.g. Ollama). No provider is privileged; you choose which to use on first launch.
- **Model list**: bookmarks (starred models across providers), sort (recommended / name / price / context length) and filter (private / reasoning / vision / search / free), with pricing and capabilities shown.
- **Chat**: streaming, visible reasoning, Markdown and code highlighting, a conversation tree (regenerate, edit, regenerate with another model), and temporary chats that are never saved (toggle in the chat header before the first message).
- **Sandbox**: HTML and SVG files open as a page, html / svg / js code blocks get a Run button, and chat models can run JavaScript (`run_javascript`, asks first) for exact calculations. All of it runs in an isolated frame with no access to the app, whose requests are blocked (peer connections, WebRTC, only in browsers that enforce it: not Chrome).
- **Files**: ask for a report, notes or a translation and the model saves it as a file (Markdown, CSV, …) in the Files tab, writing long documents in parts and keeping every version. The Files tab is a file manager (cards or list, sorting, search inside files, views by type and by conversation, multi-select, drag-and-drop upload). Attach text files, CSV, code or PDFs (text is extracted in the browser) from your device or from saved files. View, edit, download or print to PDF.
- **Image generation** (Venice, OpenAI, Gemini, OpenRouter, NanoGPT, DeepInfra, Together; editing from instructions on Gemini, NanoGPT, OpenAI, OpenRouter and Venice; upscale and background removal on Venice): image mode in the input box (model, aspect ratio, resolution, 1–4 images, style, negative prompt, seed), "same settings again" / "similar image", upscale, edit, background removal, a gallery, and an optional tool so chat models can create images. Images are stored locally (encrypted with a passphrase).
- **Video generation** (Venice, OpenRouter, Gemini): video mode in the input box, shown once one of them has a key (model, length, resolution, aspect ratio, sound, and a first frame to start from an image; "Make a video" on any image), with the price before sending. A job keeps running at the provider for minutes: waiting goes on after a reload (Venice, OpenRouter) and can be stopped and started again. Videos are stored with the images.
- **Reply suggestions**: short follow-ups under the latest reply; tap one to put it in the input box. Count, how many recent exchanges to use, and the model are configurable.
- **Web**: search with the provider's built-in search (Anthropic, Gemini, Groq, OpenRouter, Venice) or the Tavily tool; models read pages (HTML, text, PDF) with `fetch_url`, where a separate call takes out only what was asked before the model sees it (like Claude Code's WebFetch); and bring files in with `fetch_file`. Every fetch is confirmed in the fetch page, which can remember sites you allow.
- **Skills**: SKILL.md-compatible instruction files. The model loads a skill's body only when it needs it, or you can attach one with `/name`. Ask it to "turn this into a skill" and it drafts one, which is saved after you approve it.
- **Long conversations**: compaction (manual or automatic), prompt caching, and a context-length safeguard.
- **Usage**: tokens and cost per day, provider and model, recorded only in this browser. Balance and balance alert for DeepSeek, NanoGPT, OpenRouter (the key's limit left) and Venice.
- **Data**: full-text search, JSON backup/import (optionally password-encrypted), image deletion, wipe everything, PWA, dark mode, mobile layout.
- **For developers**: each reply can show the requests (JSON) sent to the provider (Settings → About → "Show the requests sent").

## Quick start

```bash
npm install
npm test          # unit tests (Vitest)
npm run dev       # http://localhost:5173
```

### Try it without real APIs (mock server)

```bash
npm run mock      # Venice / Anthropic / Gemini / OpenRouter / OpenAI / Tavily / Jina Reader-compatible mock on :8787
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 \
VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 \
VITE_TAVILY_BASE_URL=http://localhost:8787/tavily \
VITE_JINA_BASE_URL=http://localhost:8787/jina \
npm run dev
```

**Mock keys**: Venice `mock-key`, Anthropic `mock-ant`, Tavily `tvly-mock`. Gemini (`mock-gem`), OpenRouter (`mock-or`; model list, balance, images and videos only) and OpenAI (`mock-oai`) are used with `VITE_GEMINI_BASE_URL=http://localhost:8787/gemini/v1beta`, `VITE_OPENROUTER_BASE_URL=http://localhost:8787/openrouter/api/v1` and `VITE_OPENAI_BASE_URL=http://localhost:8787/openai/v1`. The mock also serves Venice image models and generates PNGs, and answers video jobs of all three (after a few asks) with a short clip; an image prompt containing `違反` returns a content-policy rejection with a suggestion, one containing `ぼかし` a blurred result, and asking a chat model "絵を描いて" (with the image tool on) calls `generate_image`.

**Keywords** in a message change the mock's behaviour:

- General: `思考` / `think`, `コード`, `長文`, `エラー`, `残高`, `画像`, `xss`, `盗用`.
- Tool-based web search: `検索`, `読んで` (after a search). Reading a page directly: `ページを読んで`.
- Built-in search (the Anthropic and Gemini mocks): `検索` / `天気`.
- Skills: `スキル` loads the first skill.
- Skill creator: `作って` / `直して` calls `save_skill` in a skill-creator conversation.
- Files: `レポートにまとめて` calls `create_file`; with a file in the conversation, `追記して` / `結論を直して` / `全部読んで` call `append_file` / `edit_file` / `read_file`.
- Sandbox: `実行できる例` answers with runnable JS and HTML code blocks, `計算して` calls `run_javascript`, `ページを作って` creates an HTML file.

### Check with production headers

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173   # applies dist/_headers
npx wrangler dev --local                         # or: Cloudflare's local runtime
```

## Deploy (Cloudflare Workers via GitHub)

The app is deployed as a Worker that only serves static files (`wrangler.jsonc`, no Worker code). The key vault (`/vault/`) and the fetch page (`/fetch/`) are served from the same site.

1. Push this repository to GitHub.
2. In Cloudflare: Workers & Pages → Create → **Import a repository**, then select it.
3. Set up the project:
   - **Project name**: the same as `name` in `wrangler.jsonc` (`nobackend-llm-client`).
   - **Build command**: `npm run build`. It may be left empty, because `wrangler.jsonc` runs it anyway.
   - **Deploy command**: `npx wrangler deploy` (the default).
   - **Environment variables**: none. Node 22 comes from `.node-version`. Do **not** set any `VITE_*_BASE_URL`; those are for the mock only.
4. Every push to `main` deploys to `https://<name>.<account>.workers.dev`.

**Turn these Cloudflare features off.** They inject scripts, which the CSP blocks, and they break the no-third-party-scripts rule: Web Analytics, Rocket Loader, Email Address Obfuscation, Zaraz.

**Verify**: each document should get exactly one CSP, and the vault page should get the vault's CSP, whose `connect-src` lists the LLM APIs.

```bash
curl -sI https://<your-site>/ | grep -i content-security-policy
curl -sI https://<your-site>/vault/ | grep -i content-security-policy
```

Then open the site, check the developer console for CSP errors, and try a spend-limited key: save the key, chat, set and unlock a passphrase.

Cloudflare Pages also works (build command `npm run build`, output directory `dist`); `_headers` applies the same way.

**Data is per origin.** Conversations and keys belong to the URL you use. When moving (from a local trial build, from `workers.dev` to a custom domain, and so on), export a backup in Settings → Privacy and data first, then import it on the new site. Keys must be entered again.

### Strict setup: the vault and the fetch page on their own origins

By default the key vault (`/vault/`) and the fetch page (`/fetch/`) are served from the app's own origin, which works on any host. Their limit: if a script ever ran inside the app (XSS), it could reach them, ask the vault for the keys, and use the fetch page to send data to any address. With both on origins of their own, such a script can do neither.

```bash
# vault site (deploy dist-vault/) and fetch page site (deploy dist-fetch/)
VITE_APP_ORIGIN=https://app.example.com npm run build:vault
VITE_APP_ORIGIN=https://app.example.com npm run build:fetch
# app site: both origins go into frame-src, and /vault/ and /fetch/ are no longer built
VITE_VAULT_URL=https://vault.example.com/ VITE_FETCH_URL=https://fetch.example.com/ npm run build
```

Use subdomains of one custom domain (three Workers or Pages sites, free). Two different `*.workers.dev` / `*.pages.dev` sites count as different sites, so the vault's storage may be partitioned, and `*.github.io` pages share one origin. The app's preview deployments can't embed a separate vault. Keys are entered again in the new vault.

### Other static hosts (GitHub Pages and the like)

`npm run build` puts each page's CSP in its HTML as well as in `_headers`, so a host that ignores `_headers` (GitHub Pages) still enforces it. What a `<meta>` CSP cannot carry is lost there: `frame-ancestors` (other sites may embed the pages) and the other headers (`nosniff`, `Referrer-Policy`, COOP). Prefer Cloudflare for daily use.

By default the app is served from the root of a domain (a repository named `<user>.github.io`, or a custom domain). To serve it under a path such as `<user>.github.io/<repository>/`, build with that path:

```bash
VITE_BASE_PATH=/<repository>/ npm run build
```

The pages (`fetch/`, `vault/`, `sandbox/`), the Service Worker and the assets are then all under that path. Every project site under `<user>.github.io` shares one origin: scripts on your other project sites can read what the app stores (conversations, keys in the vault), which only a passphrase keeps encrypted. Prefer a domain of its own.

### Reading pages and fetching files from the web

Models reach the web in two ways, both through a separate fetch page (`/fetch/`, its own CSP) that shows the address and asks you first; you can have it stop asking for a site, for reading pages and for fetching files apart (kept in the fetch page's storage; forget it under Settings → Web → "Fetch page settings"). Addresses on such a site are then sent without asking, whatever the model puts in them. The app itself never reaches arbitrary addresses, nor Jina Reader. The fetch page tries the site directly, then your relay (when there is one), then Jina Reader (for reading only).

- **Read** (`fetch_url`, with what the model wants from the page): the page (HTML, text or PDF) becomes text in the app, and a separate call with no tools answers the request from it. Only that answer reaches the conversation's model, so instructions planted in the page have little hold. The reading model is the conversation's unless you pick one in Settings → Web ("Model that reads pages"). Pages that refuse direct fetching go through your relay (below); pages that still can't be fetched, and pages whose HTML holds almost no text (under about 400 visible characters, drawn by scripts), are read through Jina Reader (`r.jina.ai`).
- **Save** (`fetch_file`): a file or an image is kept in the Files tab as it is. Text, CSV, HTML, code and PDFs become files the model can read; images are saved as images (up to 20 MB; no SVG). To work with a page's markup (a scraper, say), save it and have the model read it, or try code on it with `run_javascript`.

Jina Reader works without a key (up to 20 requests a minute per IP address). To raise the limit, enter an API key in the fetch page's settings (optional). The key is kept unencrypted in the fetch page's storage (with a passphrase too), sent only with requests to Jina Reader, and not included in backups.

A browser can only fetch from sites that allow it (CORS): file and image hosts often do (GitHub raw files, Wikimedia, many CDNs), ordinary web pages often don't. For those, you can deploy your own relay (optional):

```bash
# relay (relay/worker.js) on your Cloudflare account; set ALLOWED_ORIGINS in relay/wrangler.jsonc to the fetch page's origin (the app's, when they share a site)
cd relay && npx wrangler deploy
# app: tell the fetch page where the relay is
VITE_FETCH_RELAY_URL=https://nobackend-fetch-relay.<account>.workers.dev npm run build
# with the fetch page on its own origin, pass the same value to build:fetch and to the app build (Settings → Web shows it)
```

The relay only takes public https addresses, passes on none of your headers or cookies, keeps nothing, answers only to the allowed origins, checks every redirect the same way, and asks Cloudflare to cap each IP at 30 requests a minute (the allowed origin is a header any script can fake, and the relay's address is readable in the app). Cloudflare applies this cap loosely: in a test it let every request through. Addresses you fetch through it are seen by it (your own Worker).

### Adding providers at build time

`VITE_CUSTOM_PROVIDERS` takes a JSON array of OpenAI-compatible endpoints. They're added to the provider list, the vault's allowed hosts, and the CSP.

```bash
VITE_CUSTOM_PROVIDERS='[{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]' npm run build
```

| Field | Meaning |
|---|---|
| `id` | lowercase letters, digits, hyphens |
| `label` | the name shown (`id` when left out) |
| `baseUrl` | https; plain http is allowed for localhost only |
| `keyOptional` | usable without a key |
| `publicModels` | the model list can be fetched without a key |

An invalid value fails the build. The endpoint must allow CORS from your site; for Ollama, start it with `OLLAMA_ORIGINS=https://<your-site>`. Providers cannot be added from the UI at runtime, because key destinations are fixed at build time.

## Passphrase (protecting keys and conversations)

There's no storage mode to choose.

- **Without a passphrase**, keys and conversations are stored as-is.
- **With a passphrase**:
  - API keys, conversations, files, images, saved prompts and skills are encrypted (not the fetch page's Jina Reader key and sites not asked about).
  - The app is hidden behind a lock screen until you unlock it.
  - Each tab and each reload must be unlocked again.
  - You can lock with the sidebar button, or set an idle auto-lock.
- **Setup**: right after you save your first key, the app offers to set one (you can skip). You can also set, change or remove it under Settings → Connections and keys. Changing or removing it requires the current passphrase.
- **If you forget it**, nothing can be recovered. The lock screen can only wipe everything so you can start over.
- **Backups are plain JSON unless you set a password when exporting** (on by default once a passphrase is set). Store plain backups carefully.

## API key safety

Always use **spend-limited keys**. If a key ever leaks, the damage stops at the limit.

- **Venice**: create an **INFERENCE** key with a daily consumption limit and an expiry. `modelPrivacy: PRIVATE_ONLY` blocks models relayed to third parties.
- **OpenRouter**: set a credit limit on the key.
- **Anthropic**: set a workspace spend limit in the Console.
- **Gemini**: on the free tier, Google may use your prompts to improve its products. The paid tier doesn't.
- **DeepSeek**: prepaid, so your balance is the limit. Data is processed by a company in China.
- **Groq**: the free tier has rate and token limits; set a spend limit if you upgrade.
- **NanoGPT**: set a daily, weekly or monthly spending limit on the key.
- **DeepInfra**: set a monthly spending limit on the key.
- **Cerebras**: prepaid credits, so your balance is the limit.
- **Novita**: set a budget on the key.
- **Chutes**: a per-key spending limit could not be confirmed; top up small amounts.
- **Together**: prepaid with no per-key limit; top up small amounts.
- **Tavily** (tool-based web search): set a usage limit.
