# nobackend-llm-client

**English** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

> Bring your own API key. No backend — runs entirely in your browser.

A chat client for LLM APIs that doesn't need a server and doesn't keep logs. It's for people who want to use less-censored or open-weight models without leaving their conversations in a SaaS product, and without hosting their own server or running a model locally.

- **No backend**: static files only. Your browser talks directly to the provider's API with your key. No account, no analytics, no third-party scripts.
- **Your data stays local**: conversations and settings are stored in your browser (IndexedDB).
- **Keys are hard to steal**: API keys live only in a separate key vault page and never reach the app itself. The vault attaches a key only to that provider's fixed host. There's a strict CSP with Trusted Types.
- **Optional passphrase**: encrypts both API keys and conversations at rest. The whole app stays behind a lock screen until you unlock it.

The UI is available in Japanese, English and Simplified Chinese (automatic, or chosen in Settings → Appearance). Principles and rules: [docs/principles.md](docs/principles.md).

What the security design protects, and where it stops: [docs/security.md](docs/security.md).

## Features

- **Providers**: Venice, OpenRouter, Anthropic, Google Gemini, OpenAI, DeepSeek, Groq, NanoGPT, DeepInfra, Cerebras, Novita, Chutes, Together, plus OpenAI-compatible endpoints added at build time (e.g. Ollama). No provider is privileged; you choose which to use on first launch.
- **Model list**: bookmarks (starred models across providers), sort (recommended / newest / name / price / context length) and filter (private / reasoning / images / search / free), with pricing, capabilities, release date and the end of a sale price shown, and each model's details (knowledge cutoff, the provider's description).
- **Chat**: streaming, visible reasoning, Markdown and code highlighting, a conversation tree (regenerate, edit, regenerate with another model), and temporary chats that are never saved (toggle in the chat header before the first message). A failed answer says what went wrong and what to do, with a button where the app can do it (open connections and keys, add credit, compact the conversation, regenerate, regenerate with another model).
- **Sandbox**: HTML and SVG files open as a page, html / svg / js code blocks get a Run button, and chat models can run JavaScript (`run_javascript`, asks first) for exact calculations. All of it runs in an isolated frame with no access to the app and no network (peer connections (WebRTC) are blocked only in browsers that enforce it, not in Chrome).
- **Files**: ask for a report, notes or a translation and the model saves it as a file (Markdown, CSV, …) in the Files tab, writing long documents in parts; each file keeps the text before its last change, so one step can be undone. A chat's files go in its working folder, made with its first file and named by the model; the model reads and writes only there (and files attached to the chat), with tools shaped like a coding agent's (list by pattern, search lines, read with line numbers, write, edit, append, move, and delete, which asks you every time), and it can open a page it made to see its errors and what it shows, and fix them (preview_page); the preview shows the same errors to you, and "Chat in this folder" in the Files tab starts a new chat on a folder that already exists. A file name may include folders (`site/css/style.css`), and an HTML page previews with the files of its site it refers to (CSS, JavaScript modules, images; the site is the nearest folder above it with an index.html), still without network, and keeps its localStorage in localStorage.json in the site (delete it to reset the page's data). The Files tab is a file manager, by folder, by type or by chat (new folders, renaming, moving by menu or by dragging onto a folder, deleting a folder with what it holds, a menu on every item and a right click, cards or list, sorting, search inside files, views by type and by conversation, multi-select, drag-and-drop upload). Attach text files, CSV, code or PDFs (text is extracted in the browser) from your device or from saved files, or drop or paste them into the input box. View, edit, download or print to PDF.
- **Image generation** (Venice, OpenAI, Gemini, OpenRouter, NanoGPT, DeepInfra, Together; editing from instructions on Gemini, NanoGPT, OpenAI, OpenRouter and Venice; upscale and background removal on Venice): image mode in the input box, shown once one of them has a key (model, aspect ratio, resolution, 1–4 images, style, negative prompt, seed), "Again with the same seed", and in the image viewer: edit, upscale, background removal and "Make a video". For models prompted with Danbooru tags (anime models, marked in the model lists with their family, such as Illustrious or Pony): tag suggestions while you type (from a tag list bundled with the app; the image options can show them for every model, or turn them off), the model family's recommended quality tags (editable per family) and negative prompt, "Convert to tags" under the prompt (the chat model rewrites a prompt as tags; Undo puts the text back), and the model's prompt length limit. An optional tool lets chat models create images. Images are stored locally (encrypted with a passphrase) and listed with the videos in the Files tab ("Images & videos").
- **Video generation** (Venice, OpenRouter, Gemini): video mode in the input box, shown once one of them has a key (model, length, resolution, aspect ratio, sound, and a first frame to start from an image; "Make a video" on any image), with the price before sending. A job keeps running at the provider for minutes: waiting goes on after a reload (Venice, OpenRouter) and can be stopped and started again. Videos are stored with the images.
- **Reply suggestions**: short follow-ups under the latest reply; tap one to put it in the input box. Count, how many recent exchanges to use, and the model are configurable.
- **Web**: search with the provider's built-in search (Anthropic, Gemini, Groq, OpenRouter, Venice) or the Tavily tool; models read pages (HTML, text, PDF) with `fetch_url`, where a separate call takes out only what was asked before the model sees it (like Claude Code's WebFetch); and bring files in with `fetch_file`. Every fetch is confirmed in the fetch page, which can remember sites you allow.
- **Skills**: SKILL.md-compatible instructions, with the files in their folder (scripts, references), imported from a SKILL.md, a zip or a folder after you have looked through every file. The model loads a skill's body only when it needs it, or you can attach one with `/name`; it can then read the skill's files and run its JavaScript scripts in the sandbox (CommonJS under a Node-like shim, no network, asked before each run unless you allow it in settings), and the files a script writes are saved in the working folder if you choose to. Ask it to "turn this into a skill" and it drafts one, which is saved after you approve it.
- **Long conversations**: compaction (manual or automatic), prompt caching, and a context-length safeguard.
- **Usage**: cost and tokens over time, by model, provider, use and conversation, recorded only in this browser. The balance of DeepSeek, NanoGPT, OpenRouter (the key's limit left) and Venice.
- **Data**: full-text search, backup/import (JSON, or zip with images and videos; optionally password-encrypted), storage use and its breakdown, a request for persistent storage, wipe everything. Conversations restored from a backup can be read before any key is entered; a key is asked for only when you send. One tab uses the data at a time: another tab waits until you choose to use the app there.
- **App**: a PWA that starts offline after one visit, a dark theme, a mobile layout, and an update check that tells you before a new version applies (on reload).
- **For developers**: each reply can show the requests (JSON) sent to the provider (Settings → About → "Show the requests sent"), and Settings → About copies diagnostics for a bug report (no keys, conversation text, file names or URLs).

## Quick start

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # unit tests (Vitest)
npm run typecheck   # TypeScript
npm run lint        # oxlint
npm run lint:deps   # imports between layers point one way (docs/principles.md §5)
npm run e2e         # user flows on the production build with the mock (first: npx playwright install chromium)
npm run perf        # compares the UI performance of two versions (scripts/perf/README.md)
npm run tags:update # rebuilds the bundled Danbooru tag list from the archive's newest list (by hand, not in the build)
```

`npm run e2e` fails on any CSP violation, console error or request to an origin other than the app's and the mock's, and on new serious accessibility findings (axe-core, WCAG 2.1 AA). `npm run e2e -- --flows chat,lock` runs some of the flows.

### Try it without real APIs (mock server)

```bash
npm run mock      # Venice / Anthropic / Gemini / OpenRouter / OpenAI / Tavily / Jina Reader-compatible mock on :8787
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 \
VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 \
VITE_TAVILY_BASE_URL=http://localhost:8787/tavily \
VITE_JINA_BASE_URL=http://localhost:8787/jina \
npm run dev
```

**Mock keys**: Venice `mock-key`, Anthropic `mock-ant`, Tavily `tvly-mock`. Gemini (`mock-gem`), OpenRouter (`mock-or`; model list, balance, images and videos only) and OpenAI (`mock-oai`) are used with `VITE_GEMINI_BASE_URL=http://localhost:8787/gemini/v1beta`, `VITE_OPENROUTER_BASE_URL=http://localhost:8787/openrouter/api/v1` and `VITE_OPENAI_BASE_URL=http://localhost:8787/openai/v1`. The mock also serves the image models of Venice, OpenAI, Gemini and OpenRouter and generates PNGs, answers "To tags" with tags (after 2 s for a text containing `ゆっくり`), and answers video jobs of all three video APIs (after a few asks) with a short clip; an image or video prompt containing `違反` is rejected for content policy (Venice with a suggested prompt), an image prompt containing `ぼかし` gives a blurred result, and asking a chat model "絵を描いて" (with the image tool on) calls `generate_image` with `path: assets/cat.png`, and then (in a chat without a working folder) "絵をページに入れて" moves that image in with `move_file` by its id and writes a page that shows it; "スクリプトを書いて" writes a script with a syntax error and "スクリプトを直して" fixes it with `edit_file` (with the file tools on).

**Keywords** in a message change the mock's behaviour:

- General: `思考` / `think`, `コード`, `長文`, `エラー`, `残高`, `画像`, `xss`, `盗用`.
- Failures (Venice, Anthropic, Gemini and OpenAI mocks, each in its API's own shape): `#err:auth`, `#err:balance`, `#err:rate`, `#err:model`, `#err:context`, `#err:policy`, `#err:overloaded`, `#err:server`, `#err:timeout`, `#err:network` (the connection is dropped), `#err:stream` (an error after the answer started).
- Tool-based web search: `検索`, `読んで` (after a search). Reading a page directly: `ページを読んで`.
- Built-in search (the Anthropic and Gemini mocks): `検索` / `天気`; with `一時停止` too, the Anthropic mock pauses the turn after the search (`pause_turn`).
- Skills: `スキル` loads the first skill; `<name> のスクリプトを実行して` loads the skill named and runs its `scripts/hello.js` with `run_skill_script`.
- Skill creator: `作って` / `直して` calls `save_skill` in a skill-creator conversation.
- Files: `レポートにまとめて` calls `write_file`; with a file in the conversation, `追記して` / `結論を直して` / `全部読んで` call `append_file` / `edit_file` / `read_file`.
- Sandbox: `実行できる例` answers with runnable JS and HTML code blocks, `計算して` calls `run_javascript`, `ページを作って` creates an HTML page and the script it loads, `ゲームを作って` writes a page that counts its animation frames and tries it with `preview_page`.

### Check with production headers

```bash
npm run build
npm run preview:csp                              # serves dist/ on :4173 with dist/_headers applied
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

### Check a build against its source

The build is reproducible: one commit, built with the same `VITE_*` variables and the Node version in `.node-version`, gives the same files byte for byte (the date in Settings → About is the commit's, not the build's). To check a deployment or someone else's build against source you have read:

```bash
git checkout <commit>                  # Settings → About shows it
npm ci
npm run -s build:verify > mine.txt     # builds dist/ and prints the SHA-256 of every file in it
diff mine.txt theirs.txt               # their list, made the same way
curl -s https://<your-site>/sw.js | shasum -a 256   # a deployed file against its line (sw.js lists every script and stylesheet)
```

For the strict setup, hash the other two builds as well: `node scripts/hashes.mjs dist-vault dist-fetch`.

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

`npm run build` puts each page's CSP in its HTML as well as in `_headers`, so a host that ignores `_headers` (GitHub Pages) still enforces it. What a `<meta>` CSP cannot carry is lost there: `frame-ancestors` (other sites may embed the pages), the other headers (`nosniff`, `Referrer-Policy`, COOP), and the PDF worker's CSP (a `<meta>` CSP does not reach workers). Prefer Cloudflare for daily use.

By default the app is served from the root of a domain (a repository named `<user>.github.io`, or a custom domain). To serve it under a path such as `<user>.github.io/<repository>/`, build with that path:

```bash
VITE_BASE_PATH=/<repository>/ npm run build
```

The pages (`fetch/`, `vault/`, `sandbox/`), the Service Worker and the assets are then all under that path. Every project site under `<user>.github.io` shares one origin: scripts on your other project sites can read what the app stores (conversations, keys in the vault), which only a passphrase keeps encrypted. Prefer a domain of its own.

### Reading pages and fetching files from the web

Models reach the web in two ways, both through a separate fetch page (`/fetch/`, its own CSP) that shows the address and asks you first; you can have it stop asking for a site, for reading pages and for fetching files apart (kept in the fetch page's storage; forget it under Settings → Web → "Fetch page settings"). Addresses on such a site that appeared in the conversation (in your messages, search results, links on pages read) are then fetched without asking; one the model put together is always asked about, its new parts marked, with a warning when they hold text of the conversation (docs/security.md §3.6); a redirect to another site is asked about again. The app itself never reaches arbitrary addresses, nor Jina Reader. The fetch page tries the site directly, then your relay (when there is one), then Jina Reader (for reading only).

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

The relay only takes public https addresses, passes on none of your headers or cookies, keeps nothing, answers only to the allowed origins, follows no redirect itself (it tells the fetch page where one leads, and the fetch page asks you if it leaves the site), and asks Cloudflare to cap each IP at 30 requests a minute (the allowed origin is a header any script can fake, and the relay's address is readable in the app). Cloudflare applies this cap loosely: in a test it let every request through. Addresses you fetch through it are seen by it (your own Worker).

### Experimental: pages that reach the web, their files and the model (at your own risk)

For your own builds only. With `VITE_EXPERIMENTAL_PAGE_API=1`, an HTML page in a folder that you show from the Files tab (not one a model tries) gets:

- `nbl.files.list()`, `nbl.files.read(path)`, `nbl.files.write(path, text)`: the files of its site (paths from the site's top; text only for writing).
- `nbl.chat(prompt, { system })`: the text of an answer from the model a new chat would use (no tools, at most 20 a minute; the cost counts like any other).
- With `VITE_FETCH_RELAY_URL` set too: `fetch(url)` of https addresses, GET only, through the fetch page, which asks about each (or not again for a site you choose; kept apart from reading and saving), and `<img>` from https addresses fetched the same way.

```bash
VITE_EXPERIMENTAL_PAGE_API=1 VITE_FETCH_RELAY_URL=https://nobackend-fetch-relay.<account>.workers.dev npm run build
```

A page sends whatever it puts in an address to the site, its site's files included, and a site you chose not to be asked about gets it without asking. Model calls from a page cost money. Don't serve such a build to others.

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
  - API keys, conversations, files, images, videos, saved prompts, skills with their files and the settings that hold your own text (default instructions, image options) are encrypted (not the fetch page's Jina Reader key and sites not asked about).
  - The app is hidden behind a lock screen until you unlock it.
  - Each tab and each reload must be unlocked again.
  - You can lock with the sidebar button, or set an idle auto-lock.
  - You can also register a passkey (fingerprint, face or the device's PIN) to unlock with, where the browser supports it; the passphrase still works. Changing or removing the passphrase removes the passkeys.
- **Setup**: right after you save your first key, the app offers to set one (you can skip). You can also set, change or remove it under Settings → Connections and keys. Changing or removing it requires the current passphrase.
- **If you forget it**, nothing can be recovered. The lock screen can only wipe everything so you can start over.
- **Backups are plain JSON (zip with images and videos) unless you set a password when exporting** (on by default once a passphrase is set). Store plain backups carefully.

## API key safety

Always use **spend-limited keys**: set a spending limit at the provider where it offers one (below). If a key ever leaks, the damage stops at the limit.

Store only **keys for normal use**, never admin, management or provisioning keys (such as OpenRouter provisioning keys or OpenAI admin keys). The vault attaches a key only to its provider's API, but a script that ever ran in the app could still use whatever that key is allowed to do there.

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

## Privacy

The app has no server of its own: your browser sends your requests straight to the provider. What each party can see:

- **The site you open the app from, and its host** (Cloudflare with the deploy above): what any static site sees. Its request logs may hold your IP address, your browser's user agent, and which of the app's files were requested (pages, scripts, and the update check at start and then every hour). Nothing you send to providers goes through it, and a conversation's address comes after `#`, which browsers do not send.
- **The relay and its host**, if the site has a relay for reading pages and fetching files: the addresses fetched through it.
- **Providers**, Tavily, Jina Reader and the sites a model reads: what is sent to them, your IP address, and the site's address (the `Origin` header). What they keep and how they use it is up to their own policies (see "API key safety").
- **No analytics and no cookies.** The app has no analytics or tracking, loads no third-party scripts or fonts, sets no cookies, and sends its requests without cookies. Its CSP lets it connect only to the site itself and to the providers; other sites are reached only by the fetch page, after it asks you. The diagnostics in Settings → About are only copied, for you to paste where you choose.

Details: [docs/security.md](docs/security.md) §3.1, §3.6 and §4.

## Reporting a vulnerability

Report it privately with GitHub's private vulnerability reporting, not in a public issue. How, and what to include: [SECURITY.md](SECURITY.md).

## Disclaimer

The software is provided "as is", without warranty of any kind, under the MIT License ([LICENSE](LICENSE)). You are responsible for your API keys, the costs of your requests, and what you send to providers. This project is not affiliated with or endorsed by any of the providers or services it works with.

## License

MIT ([LICENSE](LICENSE)). A build also writes `licenses.md` with the licenses of the packages it bundles (Dexie, pdf.js, DOMPurify, highlight.js, marked, Preact and others) and serves it next to the app, with the font's license (Inter, SIL OFL) as `licenses-fonts.txt`. The Danbooru tag list is built from DraconicDragon/dbr-e621-lists-archive (Unlicense).
