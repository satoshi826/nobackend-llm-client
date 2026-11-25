# nobackend-llm-client

**English** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

> Bring your own API key. No backend — runs entirely in your browser.

A chat client for LLM APIs that doesn't need a server and doesn't keep logs. It's for people who want to use less-censored or open-weight models without leaving their conversations in a SaaS product, and without hosting their own server or running a model locally.

- **No backend**: static files only. Your browser talks directly to the provider's API with your key. No account, no analytics, no third-party scripts.
- **Your data stays local**: conversations and settings are stored in your browser (IndexedDB).
- **Keys are hard to steal**: API keys live only in a separate key vault page and never reach the app itself. The vault attaches a key only to that provider's fixed host. There's a strict CSP with Trusted Types.
- **Optional passphrase**: encrypts both API keys and conversations at rest. The whole app stays behind a lock screen until you unlock it.

The UI is currently in Japanese only. Design details: [docs/design.md](docs/design.md).

## Features

- **Providers**: Venice, OpenRouter, Anthropic, Google Gemini, DeepSeek, Groq, plus OpenAI-compatible endpoints added at build time (e.g. Ollama). No provider is privileged; you choose which to use on first launch.
- **Model list**: bookmarks (starred models across providers), sort (recommended / name / price / context length) and filter (private / reasoning / vision / search / free), with pricing and capabilities shown.
- **Chat**: streaming, visible reasoning, Markdown and code highlighting, a conversation tree (regenerate, edit, regenerate with another model), and temporary chats that are never saved (toggle in the chat header before the first message).
- **Image generation (Venice)**: image mode in the input box (model, aspect ratio, resolution, 1–4 images, style, negative prompt, seed), "same settings again" / "similar image", upscale, edit, background removal, a gallery, and an optional tool so chat models can create images. Images are stored locally (encrypted with a passphrase).
- **Files**: ask for a report, notes or a translation and the model saves it as a file (Markdown, CSV, …) in the Files tab, writing long documents in parts and keeping every version. The Files tab is a file manager (cards or list, sorting, search inside files, views by type and by conversation, multi-select, drag-and-drop upload). Attach text files, CSV, code or PDFs (text is extracted in the browser) from your device or from saved files. View, edit, download or print to PDF.
- **Reply suggestions**: short follow-ups under the latest reply; tap one to put it in the input box. Count, how many recent exchanges to use, and the model are configurable.
- **Web search**: the provider's built-in search (Venice), or tools (Tavily search and Jina Reader page fetch, each run after your approval).
- **Skills**: SKILL.md-compatible instruction files. The model loads a skill's body only when it needs it, or you can attach one with `/name`. Ask it to "turn this into a skill" and it drafts one, which is saved after you approve it.
- **Long conversations**: compaction (manual or automatic), prompt caching, and a context-length safeguard.
- **Usage**: tokens and cost per day, provider and model, recorded only in this browser. Balance alert for Venice.
- **Data**: full-text search, JSON backup/import (optionally password-encrypted), image deletion, wipe everything, PWA, dark mode, mobile layout.

## Quick start

```bash
npm install
npm test          # unit tests (Vitest)
npm run dev       # http://localhost:5173
```

### Try it without real APIs (mock server)

```bash
npm run mock      # Venice / Anthropic / Tavily / Jina-compatible mock on :8787
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 \
VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 \
VITE_TAVILY_BASE_URL=http://localhost:8787/tavily \
VITE_JINA_BASE_URL=http://localhost:8787/jina \
npm run dev
```

**Mock keys**: Venice `mock-key`, Anthropic `mock-ant`, Tavily `tvly-mock`. The mock also serves Venice image models and generates PNGs; an image prompt containing `違反` returns a content-policy rejection with a suggestion, and asking a chat model "絵を描いて" (with the image tool on) calls `generate_image`.

**Keywords** in a message change the mock's behaviour:

- General: `思考` / `think`, `コード`, `長文`, `エラー`, `残高`, `画像`, `xss`, `盗用`.
- Tool-based web search: `検索`, `読んで`.
- Skills: `スキル` loads the first skill.
- Skill creator: `作って` / `直して` calls `save_skill` in a skill-creator conversation.

### Check with production headers

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173   # applies dist/_headers
npx wrangler dev --local                         # or: Cloudflare's local runtime
```

## Deploy (Cloudflare Workers via GitHub)

The app is deployed as a Worker that only serves static files (`wrangler.jsonc`, no Worker code). The key vault is served from the same site at `/vault/`.

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

**Data is per origin.** Conversations and keys belong to the URL you use. When moving (from a local trial build, from `workers.dev` to a custom domain, and so on), export a backup in Settings → Privacy & data first, then import it on the new site. Keys must be entered again.

### Separate-origin key vault (recommended with a custom domain)

With the vault on its own origin, an XSS in the app still cannot read your keys.

```bash
# vault site (deploy dist-vault/)
VITE_APP_ORIGIN=https://app.example.com npm run build:vault
# app site (the vault origin is added to frame-src automatically)
VITE_VAULT_URL=https://vault.example.com/ npm run build
```

Use subdomains of one custom domain. Two different `*.workers.dev` / `*.pages.dev` sites count as different sites, so the vault's storage may be partitioned. The app's preview deployments can't embed a separate vault.

### Adding providers at build time

`VITE_CUSTOM_PROVIDERS` takes a JSON array of OpenAI-compatible endpoints. They're added to the provider list, the vault's allowed hosts, and the CSP.

```bash
VITE_CUSTOM_PROVIDERS='[{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]' npm run build
```

| Field | Meaning |
|---|---|
| `id` | lowercase letters, digits, hyphens |
| `baseUrl` | https; plain http is allowed for localhost only |
| `keyOptional` | usable without a key |
| `publicModels` | the model list can be fetched without a key |

An invalid value fails the build. The endpoint must allow CORS from your site; for Ollama, start it with `OLLAMA_ORIGINS=https://<your-site>`. Providers cannot be added from the UI at runtime, because key destinations are fixed at build time.

## Passphrase (protecting keys and conversations)

There's no storage mode to choose.

- **Without a passphrase**, keys and conversations are stored as-is.
- **With a passphrase**:
  - API keys, conversations, saved prompts and skills are encrypted.
  - The app is hidden behind a lock screen until you unlock it.
  - Each tab and each reload must be unlocked again.
  - You can lock with the sidebar button, or set an idle auto-lock.
- **Setup**: right after you save your first key, the app offers to set one (you can skip). You can also set, change or remove it under Settings → Connections & keys. Changing or removing it requires the current passphrase.
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
- **Tavily** (tool-based web search): set a usage limit.
