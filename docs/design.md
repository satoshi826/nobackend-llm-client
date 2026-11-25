# nobackend-llm-client — Design

This document describes the current design. For setup and deployment, see the [README](../README.md).

## 1. Purpose and threat model

A chat client for LLM APIs that runs entirely in the browser:

- **Bring your own key, no backend.** Static files only. The browser talks directly to the LLM provider's API with the user's key. No account, no analytics, no third-party scripts.
- **For whom.** People who want to use less-censored or open-weight models without leaving logs in a SaaS chat product, and without hosting Open WebUI or running a local model.
- **General-purpose.** Chat, web search, skills and an agent-style tool loop. No role-play features.

Threats we design against:

| Threat | Mitigation |
|---|---|
| XSS in the app reads API keys | Keys live only in the key vault page; the app never holds a key value. A separate-origin vault isolates keys even from app XSS |
| XSS / injected script in general | Strict CSP per document, Trusted Types, no inline script, Markdown sanitized, external images not loaded |
| Key sent to an attacker-controlled host | The vault attaches a key only to the provider's build-time host list; redirects are refused |
| Someone with access to the device or a copy of the browser profile | Optional passphrase: API keys, conversations, saved prompts and skills are encrypted at rest; the whole app is hidden behind a lock screen |
| Shoulder surfing / unattended device | Lock button, optional idle auto-lock, unlock required per tab and per reload |
| Leaked key abused | Users are told to use spend-limited keys; Venice balance drops not explained by this app's own spending raise an alert |
| Prompt injection via tool results | Tool results are wrapped as untrusted; tools that leave the browser need approval; `save_skill` always needs approval |

Out of scope: a malicious build of the app itself (self-deploy to avoid trusting a distributor), a compromised browser or OS, and protecting a conversation while the app is unlocked and showing it.

## 2. Architecture overview

```
┌────────────── app origin ─────────────────────────────────────────┐
│ index.html  (Preact + signals, Tailwind)                           │
│   state/*  ── lib/chat (runner, compaction, suggestions)           │
│            ── lib/providers (adapters, presets, endpoints)         │
│            ── lib/tools (web_search, fetch_url, load_skill, ...)   │
│            ── lib/db (Dexie / IndexedDB, sealed records)           │
│   hidden iframe  ─ MessageChannel ─┐                               │
└────────────────────────────────────┼───────────────────────────────┘
                                     ▼
┌──────── vault origin (same origin /vault/, or a separate site) ────┐
│ vault/index.html  view=transport | keys | security | unlock         │
│   store.ts: keys + passphrase (IndexedDB "key-vault")               │
│   keyedFetch: adds the key header, only for allowed hosts           │
└──────────────────────────────────┬──────────────────────────────────┘
                                   ▼
          LLM APIs (Venice, OpenRouter, Anthropic, Gemini, DeepSeek, Groq,
          build-time custom) · Tavily · Jina Reader
```

- **Stack**: Vite, Preact + `@preact/signals`, TypeScript, Tailwind v4, Dexie 4, marked + DOMPurify + highlight.js (lazy), Vitest.
- **Source layout** (dependencies point one way: `lib` → `state` → `components` → `features`; see [docs/specs/architecture.md](specs/architecture.md)):
  - `src/lib/` — UI-independent logic (providers, chat pipeline, tools, skills, db, crypto, vault client, usage). Never imports state or UI.
  - `src/state/` — core app state as signals: `settings`, `ui`, `keys`, `models`, `conversations`, `generation`, `skills`, `lock`, `data`, `images`; `app.ts` is the entry point and startup sequence. Extension points: `tool-registry.ts` (tools a feature offers to the model), `router.ts` (URL hash routes).
  - `src/components/` — core UI. `extensions.ts` holds the UI extension points (sidebar tabs, composer add-ons, tool-card views, main-area views, user-message extras, settings sections).
  - `src/features/<name>/` — self-contained features (`files` so far). A feature imports the core and registers itself through the extension points when `src/features/index.ts` imports it; the core never imports a feature.
  - `vault/` — the key vault page (no framework, DOM built with `createElement`/`textContent`).
  - `csp.config.ts` — builds the `_headers` file for both the app and a separately deployed vault.

## 3. Key vault

### 3.1 Responsibilities

The vault page is the only code that ever sees an API key. It:

- stores keys (IndexedDB `key-vault`, store `secrets`);
- validates a key before saving (the preset's `validateKey`, run through a fetch that attaches the candidate key);
- performs every keyed request on behalf of the app (`keyedFetch`);
- holds the passphrase while unlocked and wraps/unwraps the app's data key (section 4).

### 3.2 Placement

| | Same origin (default) | Separate origin (recommended) |
|---|---|---|
| Deploy | one site, vault at `/vault/` | two sites, e.g. `app.example.com` + `vault.example.com` |
| Build | `npm run build` | vault: `VITE_APP_ORIGIN=https://app… npm run build:vault` (output `dist-vault/`); app: `VITE_VAULT_URL=https://vault…/ npm run build` |
| XSS in the app | key values stay out of the app UI, but the app origin can read the vault's storage | the app cannot read keys at all; damage is limited to misuse while a tab is open |

The vault accepts connections only from `VITE_APP_ORIGIN` origins plus its own origin, and its CSP `frame-ancestors` lists the same. `*.pages.dev`/`*.workers.dev` sites are different sites, so a separate vault there may get partitioned storage; use subdomains of one custom domain.

### 3.3 Protocol (`nbl-vault/1`)

The app creates a hidden `view=transport` iframe and passes a `MessagePort` (`connect` message, checked against the vault origin). Messages (`src/lib/vault/protocol.ts`):

- App → vault: `fetch {id, providerId, url, method, headers, body}`, `abort`, `status`, `clear-all`, `lock`, `wrap-data-key {raw}`, `unwrap-data-key {blob}`.
- Vault → app: `status {providers: KeyStatus map, vault: {hasPassphrase, locked, passphraseId}}`, `head`, `chunk`, `end`, `error`, `ack`, `result`.

Responses are streamed back as `head` + `chunk`s and rebuilt into a `Response` with a `ReadableStream`, so adapters and the SSE parser are unaware of the vault. Only a fixed set of response headers is passed through (`content-type`, `retry-after`, rate-limit headers, and headers each preset declares in `responseHeaders`, e.g. Venice balance).

The app only ever sends an `AuthRef {keyId}` — "attach this account's key". `vaultTransport` routes requests with an `AuthRef` through the vault and others through a plain `fetch` (`redirect: 'error'`, `credentials: 'omit'`, `no-referrer`, `no-store`).

### 3.4 Keyed requests

`keyedFetch(id, url, init)`:

- refuses unknown accounts and URLs whose host is not the account's host (from `src/lib/keys/accounts.ts`, built from presets and services at build time); `http` only for localhost; no credentials in the URL;
- drops any auth-like headers sent by the app (`authorization`, `cookie`, `proxy-authorization`, `x-api-key`, `x-goog-api-key`, `api-key`);
- adds the key with the account's header — `Authorization: Bearer <key>` by default, `x-api-key` for Anthropic;
- sends with `redirect: 'error'`, `credentials: 'omit'`, `no-referrer`, `no-store`.

### 3.5 Passphrase

There is no storage-mode choice:

- **No passphrase**: keys are stored as-is.
- **Passphrase set**: every key is encrypted (PBKDF2-SHA256, 600,000 iterations → AES-GCM-256, `src/lib/crypto/passphrase.ts`), including keys saved later. A check record (`__passphrase__`) verifies the passphrase and carries a random `pid` (passphrase id) that changes whenever the passphrase is set or changed.
- **Set / change / remove** re-encrypts all stored keys (or decrypts them on removal). Changing and removing require the current passphrase.
- **Unlock** once per page: the passphrase and decrypted keys stay in memory. Keys encrypted by an older per-key scheme are opened with the entered passphrase and re-encrypted under it.
- **Lock** clears the passphrase and decrypted keys from memory.
- **Delete all keys** clears the store, including the passphrase.

**Per-tab unlock.** The app generates a random session id per page load and adds `?session=` to every vault URL. Vault frames share unlocked state over `BroadcastChannel` only within the same session id, so a new tab or a reload starts locked. Storage-change notifications are shared across sessions.

**Vault views**:

- `transport` — no UI.
- `keys&provider=ID` — save, replace or delete one key; shows the unlock form when locked.
- `security` — set, unlock, lock, change or remove the passphrase; delete all keys (two-step, inline confirmation).
- `security&setup=1` — the set form only (used by the first-run prompt).
- `unlock` — the unlock form only (used by the app's lock screen).

Frames report their height (`vault-resize`) and forward Escape (`vault-escape`).

## 4. Data and encryption

### 4.1 Storage

IndexedDB via Dexie (`src/lib/db/schema.ts`, schema version 4):

| Table | Content |
|---|---|
| `conversations` | id, timestamps, `currentLeafId`, provider/model, system prompt, web-search mode, pinned, tags |
| `messages` | tree nodes (`parentId`), parts, status, meta (provider, model, usage, cost), compaction node data, attached skills, reply suggestions |
| `prompts` | saved system prompts |
| `skills` | user skills |
| `models` | cached model lists per provider |
| `settings` | the settings object and `secret:dataKey` |
| `usage` | usage log (section 9.6) |
| `blobs` | reserved for attachments |

Temporary chats are kept in memory only and never written. A new, still-empty chat is switched to/from temporary with the toggle in the chat header; once a message is sent, the header shows a "temporary chat" badge instead.

### 4.2 Conversation encryption

When the vault has a passphrase, conversations are encrypted at rest too.

- **Data key**: random AES-GCM-256 (`src/lib/crypto/data.ts`).
- **Sealed records** (`src/lib/db/sealed.ts`): content fields move into an `enc {iv, ct}` field.
  - conversations: `title`, `systemPrompt`, `tags`
  - messages: `parts`, `vendorState`, `skills`, `compaction`, `error`, `suggestions`
  - prompts: `name`, `content`
  - skills: `description`, `body`
  - Fields used for indexing and ordering (ids, timestamps, conversation id, pinned, provider/model ids, skill name) stay plain. Usage records, settings and model lists are not encrypted.
- **Repository layer**: `src/lib/db/repo.ts` seals on write and unseals on read. Crypto runs outside IndexedDB transactions.
- **Search**: when encrypted, the first search decrypts all messages into an in-memory cache.
- **Key storage**: the data key is wrapped by the vault with the passphrase (`wrap-data-key`; the plaintext carries a fixed prefix so the vault will not unwrap arbitrary ciphertexts) and stored in the app DB as `secret:dataKey {wrapped, pid, complete}`. It is excluded from backups.

**Lifecycle** (`src/state/lock.ts`), driven by vault status:

| Vault event | App action |
|---|---|
| Passphrase set, unlocked, no stored data key | generate a data key → store the wrapped key first (`complete: false`) → seal all existing rows → `complete: true` |
| Unlocked, stored data key | unwrap → keep the key in memory → finish sealing if incomplete → re-wrap if `pid` changed → load conversations |
| Passphrase changed (`pid` differs) | re-wrap the data key with the new passphrase |
| Passphrase removed | decrypt all rows, then delete the stored data key |
| Locked while the app holds the data key | reload the page (drops all decrypted data from memory) |
| Stored data key but no passphrase while locked | "cannot open" state; the user can wipe everything |

Bulk re-sealing (`resealAll`) is idempotent, so an interrupted run continues on the next unlock.

### 4.3 Lock screen and startup

Startup (`state/app.ts`): load settings → load models → connect to the vault → `initDataLock`. If a wrapped data key exists, the app shows `LockScreen` (vault `view=unlock` iframe) and loads no conversation data until unlocked. Otherwise it loads conversations and skills immediately.

- **Lock**: the sidebar lock button, or idle auto-lock (`autoLockMinutes`: off/5/15/30/60; never during generation). Both lock the vault and reload.
- **Forgot passphrase**: wipe all app data and keys (requires typing a confirmation word).
- **First-run prompt**: after the first key is saved, if there is no passphrase, the app offers to set one (`passphrasePrompted` records that it was shown, skipped or set).

### 4.4 Backup and wipe

- **Export**: decrypted JSON of conversations, messages, prompts and skills (images optional). Keys, the data key and connection settings are not included. Optionally the whole file is encrypted with a backup password (PBKDF2 + AES-GCM, the vault's scheme; format `nobackend-llm-client/export-encrypted`); this is on by default when a passphrase is set. Import asks for the password when it sees that format.
- **Storage persistence**: the app calls `navigator.storage.persist()` at start; Settings → Privacy shows the result and offers a "request persistence" button when it was refused.
- **Import**: validates shape, accepts only text/reasoning parts, compaction system nodes and attached-skill snapshots, drops invalid skills, never overwrites existing ids or skill names, and seals rows if encryption is on.
- **Wipe everything**: asks the vault to clear keys (works cross-origin), deletes the app database and the same-origin `key-vault` database, and reloads.

## 5. Providers

### 5.1 Model

- `ProviderAdapter`: `listModels(cfg, preset, transport, auth?)` and `chat(cfg, preset, auth, req, transport)` returning an async iterable of `ProviderEvent`.
- `ProviderEvent`s are block-based: `text-*`, `reasoning-*`, `tool-call-*`, `source`, `usage`, `vendor-state`, `account`, `done`, `error`.
- Errors are normalized into `ProviderError` kinds, with CORS hints.

A **preset** (`src/lib/providers/presets/`) declares everything provider-specific, so app code has no per-provider branches:

| Field | Meaning |
|---|---|
| `defaults` | base URL, adapter kind, extra headers/body |
| `tagline`, `keyGuide`, `copy` | onboarding text, key safety guide, privacy and picker notes, privacy-tab destinations |
| `keyHeader` | header used by the vault (default Bearer) |
| `keyOptional` | can be used without a key |
| `modelsNeedKey` | the model list is fetched through the vault with the key, automatically once a key is ready |
| `mapModel` | raw model → `ModelInfo` (capabilities, pricing, context length, privacy, tags) |
| `features.builtInWebSearch` | provider-side web search |
| `settings` + `requestOptions({purpose, webSearch, settings})` | provider-only toggles and how they map to request options (`purpose: 'chat' \| 'summary'`) |
| `responseHeaders`, `readHeaders` | headers the vault may pass back, e.g. balance |
| `reasoningResend` | `always` / `tool-turns` / `never` for sending `reasoning_content` back |
| `validateKey` | how the vault checks a key |

### 5.2 Built-in providers

| Provider | Adapter | Notes |
|---|---|---|
| Venice | OpenAI-compatible | public model list with privacy (`private` / `anonymized`), built-in web search with citations, `venice_parameters`, `prompt_cache_key` = conversation id, balance headers. Setting: include Venice's own system prompt (off by default) |
| OpenRouter | OpenAI-compatible | public model list with pricing; sends `provider.data_collection: deny` and `usage.include`; `reasoning_effort` → `reasoning.effort` |
| Anthropic | Messages API (`anthropic.ts`) | `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access`; system as a top-level block; tool_use/tool_result mapping; cache breakpoints on the system prompt and the last message; `max_tokens` default 8192; extended thinking not used |
| Google Gemini | OpenAI-compatible endpoint | key-gated model list filtered to chat models; free-tier data-use note; never resends reasoning |
| DeepSeek | OpenAI-compatible | resends reasoning only in tool-call turns; cache-hit tokens parsed |
| Groq | OpenAI-compatible | key-gated list filtered to chat models; `x_groq.usage`; never resends reasoning |

### 5.3 Endpoints and build-time providers

`src/lib/providers/endpoints.ts` is the single source of hosts:

- built-in base URLs (overridable with `VITE_<ID>_BASE_URL` for the mock);
- **`VITE_CUSTOM_PROVIDERS`**: a JSON array of OpenAI-compatible providers `{id, label, baseUrl, keyOptional?, publicModels?}`, e.g. Ollama or LM Studio. Validated at build time (id format, no clash, https or http-localhost, no credentials or query); invalid input fails the build.

From it are derived: presets, the vault's allowed hosts, the app CSP `connect-src` (only hosts the app calls without a key: Venice and OpenRouter model lists, key-optional or public-model custom providers, Jina), and the vault CSP `connect-src` (all keyed hosts plus Tavily and Jina). A provider cannot be added from the UI at runtime; that would break the fixed key destinations.

### 5.4 Enabling and models

- No provider is privileged. With none enabled, the chat area shows a provider chooser. Enabling a provider triggers a model fetch.
- Model lists are cached in IndexedDB and refreshed when older than 6 hours.
- The default model for a new chat is the last used one, else the `default`-tagged model of the first enabled provider, else its first model.
- **Model picker**: one scrollable list — a bookmarks section at the top (starred models across providers, stored as `favoriteModels`), then one collapsible section per enabled provider (open by default; collapsed state kept while the app is open; all sections open while searching, and providers without matches are hidden while searching or filtering). Search, sort (recommended: private first, then default, then not deprecated, then name; name; cheapest; longest context), filter chips (private, reasoning, vision, search, free — shown only when some model matches; AND-combined) apply to every section. Sort and filters are persisted.

## 6. Chat pipeline

### 6.1 Conversation tree

- Messages form a tree (`parentId`); a conversation stores `currentLeafId`.
- Regenerate, edit and regenerate with another model add siblings; `< n/m >` switches between them.
- A new chat is an unsaved draft (`id: 'draft'`) until the first send. URLs use `#/c/<id>`.

### 6.2 Request building (`lib/chat/request.ts`)

- History is the path to the parent user message. Reasoning parts are not sent.
- `vendorState` (`reasoning_content`) is resent only if the user setting `resendReasoning` (on by default) is enabled, the message came from the same provider and model, and the preset allows it.
- Attached skills are prepended to that user message as `<skill name="…">…</skill>` blocks.
- **Compaction**: the latest compaction node replaces the history it covers with its summary, appended to the system prompt.
- **Context safeguard**: `fitToContext` drops the oldest messages so the input stays within `(contextLength − reserved output) × 0.9`; the reply notes how many were dropped.
- **Skill catalog** (names and descriptions only) is appended to the system prompt for tool-capable models.

### 6.3 Runner (`lib/chat/runner.ts`)

- Loop: generate → run tools (approval if needed) → send results → generate, up to 8 steps when tools exist (else 1). `finishReason: limit` is shown when the limit is reached.
- `dynamicTools(turn)` can add tools from the next step (used to unlock `save_skill` after `skill-creator` is loaded).
- **Approvals**: per-tool permission `allow` / `ask` / `deny`. The approval card can edit arguments, approve, "always allow" (except `ALWAYS_ASK` tools) or deny with a reason, which is sent to the model.
- **Repeat guard**: the same call with the same arguments three times stops the loop.
- Usage and cost are summed across steps. Updates are batched per animation frame and persisted periodically.

### 6.4 Compaction (`lib/chat/compact.ts`)

- Manual (header button) or automatic when the estimated input exceeds `compactThreshold` (default 70%) of the model's context.
- The oldest part, except the last 4 messages, is summarized (with the previous summary) by the conversation's model or a chosen `compactModel`. The result is stored as a `system` node with `compaction {summary, coversUntilId, count, model, auto}`. The original messages remain.

### 6.5 Reply suggestions (`lib/chat/suggest.ts`)

- On by default. After a successful reply, a separate small request generates `suggestionCount` (default 3) short follow-ups from the last `suggestionTurns` (default 2) exchanges, each message clipped to 3,000 characters.
- Model: `suggestionModel`, or the conversation's model when empty.
- The output is parsed as a JSON array, with a bullet-list fallback, and stored on the reply (`suggestions`).
- Skipped for errors or aborts; cancelled when the user sends or starts typing.
- Chips under the latest reply put the text into the composer and focus it. Cost is logged as usage kind `suggest`.

### 6.6 Prompt cache and balance

- Venice gets `prompt_cache_key` = conversation id. Anthropic uses cache breakpoints. Cached input tokens are shown under replies when reported.
- **Balance**: for providers whose headers report a balance (Venice), the app tracks balance minus its own spending per provider. An unexplained drop of $0.50 or more raises a sidebar alert.

## 7. Tools and skills

### 7.1 Web search

- **Built-in**: providers with `builtInWebSearch` (Venice). Citations become sources, and `^n^` markers become links.
- **Tools**: `web_search` (Tavily, key in the vault, 1–10 results) and `fetch_url` (Jina Reader, key optional, 12,000-character cap). Results are wrapped with an untrusted-content note. Default permission is `ask`.
- Mode: on providers with built-in search, the setting `searchEngine` chooses `builtin` or `tools`; other providers use tools when the model supports tool calls and a Tavily key is set.

### 7.2 Skills

- A skill is a SKILL.md-compatible instruction document: name (lowercase, digits, hyphens, ≤ 64), description (≤ 1,024), Markdown body, and `modelInvocable` (`disable-model-invocation`).
- Users create, edit, import and export SKILL.md files in Settings → Skills.
- **Progressive loading**: tool-capable models see only the catalog and call `load_skill` (local, read-only, allowed by default) to read a body.
- **Manual attach**: the composer's skill menu or `/name`. The body is snapshotted onto the user message, so regenerate and edit send the same text.
- **Built-in `skill-creator`** (read-only, can be turned off): instructions for writing skills. Its `allowedTools: ['save_skill']` unlocks, in conversations where it was attached or successfully loaded, the `save_skill` tool and a `load_skill` that can read all skills (to edit non-invocable ones).
- **`save_skill`** creates or updates a skill by name. It always asks for approval (no "always allow"). The card shows the full draft, editable, and a line diff of the description and body for updates. Skills created by the model are marked `createdBy: 'model'`.
- Script and resource files bundled with Claude skills are not supported.

### 7.3 Image generation (Venice)

- **Image mode** (`Conversation.imageMode`, toggled in the composer): the input text is an image prompt. The bar above the input chooses the image model (`/models?type=image`, public, cached 6 h), aspect ratio (the model's `aspectRatios`, else presets mapped to width/height rounded to `widthHeightDivisor`), resolution (when the model lists them), 1–4 variants, style (`/image/styles`), and in "details" a negative prompt, a fixed seed and prompt enhancement. The bar shows an estimated cost (per-image or per-resolution price × variants). Choices persist as `imageDefaults`.
- **Requests**: the user message stores `imageRequest` (`ImageParams`: op, model, prompt, size, seed, …); the answer stores `image` (`ImageResult`: params, seed used, blurred, policy-dropped count, enhanced prompt, suggestion) and one `file` part per image. A seed is always sent (random when not fixed) so "same settings again" reproduces the picture and "similar image" picks a new seed. Regenerate / edit route image requests to `state/images.ts` via a registered handler.
- **Operations**: `POST /image/generate` (base64 JSON), `/image/upscale` (2×/4×), `/image/edit` (instruction), `/image/background-remove` (raw bytes), all through the vault with the Venice key; no new CSP host is needed. Upscale / edit / background removal are started from the viewer and append a request + answer pair after the current leaf. A 422 content-policy rejection shows Venice's suggested prompt / model as one-tap retries. `safe_mode` is always sent as off (no setting); if Venice still blurs a result, the viewer says so.
- **Storage** (`lib/db/images.ts`, schema v5 `blobs`): one record per image keyed by id, indexed by conversation and time; encrypted with the data key when a passphrase is set (`sealBytes`), decrypted to object URLs on display. Deleting a conversation deletes its images; temporary chats keep images in memory. Single images can be deleted from the viewer, and several at once from the gallery (select mode); `deleteImages` removes the blob records, strips the file parts / tool `blobIds` from messages and marks them `deleted`, so the conversation shows "image deleted" instead of a broken picture. Backups include images only when "include images" is on.
- **Chat context**: chat models receive a short text note ("generated N images: prompt…") instead of image data.
- **generate_image tool** (`lib/tools/image.ts`, offered through the tool registry, off by default): tool-capable chat models can create one image with the current image-bar model; permission defaults to "ask"; the images show inside the tool card.
- **UI**: thumbnails in the answer (spinner + elapsed time while working), a full-screen viewer (download, copy prompt, upscale, background removal, edit, previous/next), and all images in the file manager (画像 view). In image mode the chat header shows the image model and its privacy badge (that is where prompts go). The approval card of the `generate_image` tool names the model, private / relayed, and the estimated cost. Usage is logged as kind `image` with an estimated cost (labelled "unknown" when no price is listed; enhancement is extra). Because image prices are estimates, an image job restarts the balance comparison instead of adding a guess, so it never triggers the unexplained-drop alert.

### 7.4 Files (`src/features/files`)

- **What**: documents the model writes (kind `document`) and files the user attaches or uploads (kind `upload`), managed together with images. Text only; images stay in `blobs`.
- **File manager** (main area, `#/files`, shown when the sidebar's ファイル tab is chosen): files and images as cards (text preview / thumbnail) or a list (name, type, size, updated, conversation); sort by updated / name / type / size (layout and sort saved as setting `ui:filer`); checkbox, Shift-range and Ctrl/Cmd-click selection with "use in chat" (attach the files and return to the chat), download and delete; drag-and-drop or the アップロード button imports files without a chat. The sidebar tab becomes navigation: アップロード, search (names and contents), views (すべて / 最近使ったもの (7 days) / 文書 / 添付 / 画像, with counts) and 会話ごと (items made in or attached to each conversation). Images open in the image viewer; the old gallery modal is gone. Filtering and sorting are pure functions in `features/files/filer.ts`.
- **Storage** (`lib/db/files.ts`, schema v6 `files`): `FileRecord` with `versions[]` (oldest first, at most 30; each with author `model` / `user` / `upload` and an optional note). `name`, `versions` and `source` are sealed with the data key. Temporary chats keep their files in memory. Files outlive the conversation they were made in (deleting a conversation deletes its images but not its files). Backups always include files.
- **Attachments**: the composer's 添付 button (device or saved files), drag-and-drop and paste. Text formats are read as-is; PDFs go through pdf.js (lazy chunk; worker created through the `app-pdf` Trusted Types policy; character maps served from `/pdfjs/cmaps/` for CJK PDFs; 60 s timeout). On send, `takeAttachments` snapshots each file into `MessageRecord.attachments` (up to 60,000 characters inline, with `totalChars`), so regeneration sends the same content; `request.ts` puts `<file name id version>…</file>` blocks before the message text and tells the model to use `read_file` for the rest.
- **Tools** (`features/files/tools.ts`, on by default, permission "allow" since nothing leaves the browser): `create_file`, `append_file` (long documents in parts), `edit_file` (whole text, or one exact find/replace) and `read_file` (20,000 characters per call with offsets). Every write makes a new version. The model may only touch files attached to or created in the conversation (scope rebuilt from history + this turn); the system prompt lists them by id. Tool cards show a file card that opens the file.
- **File view** (main area, `#/f/<id>`; a breadcrumb back to the file manager, or a back arrow to the chat when opened from a chat): Markdown rendered, CSV/TSV as a table, other text as-is; version picker with "restore this version" (saved as a new version), manual editing (new version by "you"), rename, copy, download, print / save as PDF (the document is copied into `#print-root` and printed alone), "use in chat" (attach and return), open the source conversation, delete.

## 8. UI structure

- **Sidebar**: tabs at the top — 会話 (新しいチャット, search with full text, decrypted in memory when encrypted, list with pinned first) and tabs registered by features (ファイル: アップロード, search, views and per-conversation groups for the file manager); choosing a tab shows its screen in the main area (`showChat` / the tab's `onSelect`) — then notices (balance alert, leftover same-origin keys after moving to a separate vault, backup reminder), settings button, lock button, balances.
- **Chat view**: header (model, privacy badge, context meter with manual compaction, system prompt), then one of: provider chooser, key setup or unlock, passphrase prompt, empty state, or message list. The composer has web search, skills, `/name`, add-ons registered by features (添付), and send/stop. The main area shows the chat or a feature's view (`mainView`, e.g. a file).
- **Settings tabs**:
  - Connections & keys: vault placement banner, passphrase section with auto-lock, per-provider key and settings.
  - Chat: theme, temperature, default system prompt, reply suggestions, compaction, reasoning resend.
  - Web search: mode, tool permissions, service keys.
  - Skills.
  - Usage.
  - Privacy & data: destinations table, storage usage, backup, delete all keys, wipe.
- No `alert()` or `confirm()`: dialogs are in-app (`askConfirm`, optionally requiring a typed word).
- **Dialogs** (`components/dialog.ts`, `useDialog`): used by modals, the confirm dialog, the image viewer and the mobile sidebar drawer. It moves focus in (`[data-autofocus]`, else the first field, else the first control that is not the close button), traps Tab, makes everything outside inert (except `data-live` toasts), closes on Esc (only the topmost dialog when they stack) and returns focus to the opener. All controls get a visible `:focus-visible` ring.
- **Lock screen**: the vault's unlock field is focused on load; a wrong passphrase keeps the text selected with an inline error.
- The UI text is Japanese only for now.

## 9. Security details

### 9.1 Headers (`csp.config.ts` → `_headers`)

- **All paths**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- **App documents** (`/`, `/index.html`):
  - `default-src 'none'`; `script-src 'self'`; `style-src 'self'`; `img-src 'self' data: blob:`.
  - `connect-src 'self'` plus the hosts the app calls without a key.
  - `frame-src 'self'` plus the vault origin; `frame-ancestors 'none'`.
  - `base-uri 'none'`; `form-action 'none'`; `object-src 'none'`.
  - `require-trusted-types-for 'script'`; `trusted-types app-md dompurify app-sw`.
- **Vault documents** (`/vault/*`, or `/*` for a separate vault):
  - `connect-src` for keyed hosts, Tavily and Jina.
  - `frame-ancestors` set to the app origins.
  - `trusted-types 'none'`.
- The CSP is attached per document rather than detached with `! Content-Security-Policy`. If detaching is unsupported, two CSPs would stack on the vault and block its requests.

### 9.2 Rendering

- Markdown is rendered with marked and sanitized by DOMPurify (allow-list), through the `app-md` Trusted Types policy. If DOMPurify fails, the text is escaped instead.
- Raw HTML is escaped, links open in a new tab with `noopener noreferrer nofollow`, `javascript:` links are removed, and external images become links (never fetched).
- Code highlighting is loaded lazily.

### 9.3 Service worker (`public/sw.js`)

- Caches same-origin static assets for offline start.
- Hashed `/assets/` are cache-first; the app page `/` is network-first, keyed as `/`, and never serves a redirected response for a navigation.
- Never handles the vault page or any cross-origin request.

## 10. Deployment

- **Cloudflare Workers static assets** (`wrangler.jsonc`):
  - no Worker code; `assets.directory: ./dist`; `build.command: npm run build`.
  - `html_handling: auto-trailing-slash`: `/index.html` → `/`, `/vault/index.html` → `/vault/` (the app opens the vault at `/vault/`).
  - `not_found_handling: none`: unknown paths are 404, because conversations use hash URLs.
- **GitHub integration**: pushes to `main` build and deploy. `.node-version` pins Node 22. `VITE_*_BASE_URL` must not be set in production.
- **Turn off Cloudflare features that inject scripts**: Web Analytics, Rocket Loader, Email Obfuscation, Zaraz.
- Cloudflare Pages also works (build `npm run build`, output `dist`); `_headers` behaves the same.
- **Data is per origin**: moving to another URL needs export/import, and keys must be entered again.

## 11. Usage tracking

- Every reply, summary and suggestion request logs `{at, providerId, model, kind, tokens, cost}` (`src/lib/usage.ts`). Temporary chats are not logged.
- When the provider reports no cost, it is estimated from model pricing and marked "approx."; with no pricing, cost is unknown.
- The log survives conversation deletion and was backfilled from existing replies by the v4 migration.
- Settings → Usage: today / 7 / 30 days / all; totals, a daily bar chart (or table) of cost or tokens, per-provider and per-model tables, and a clear button.

## 12. Testing and development

- `npm test` (Vitest) covers:
  - providers: SSE, think splitter, error mapping, adapters including Anthropic, presets, endpoints and CSP;
  - the chat tree, request building, compaction, runner and tool loop including dynamic tools;
  - skills, SKILL.md parsing, diff, suggestions, model list, usage, settings migration;
  - sealed storage and re-sealing, export/import;
  - vault host checks, key headers, passphrase lifecycle and data-key wrapping;
  - Markdown sanitization.
- `npm run mock` starts `scripts/mock-venice.mjs` (port 8787), which mocks Venice, an Anthropic-style API, Tavily and Jina. Keywords in messages trigger behaviors (reasoning, code, long text, errors, balance drop, XSS, tool calls, skills, save_skill, suggestions, file tools: 「レポートにまとめて」「追記して」「結論を直して」「全部読んで」, and attachments are echoed back).
- `scripts/serve-with-headers.mjs` serves a build with its `_headers`; `npx wrangler dev --local` reproduces Workers behavior.

## 13. Limitations and future work

- **Not yet supported**: attachments (images, text, PDF), HTML/code preview (needs a third sandbox origin to run scripts), code execution and a generated-file store, MCP, memory.
- **UI language** is Japanese only; there is no i18n yet.
- **Not verified with real keys**: OpenRouter, Anthropic, Gemini, DeepSeek, Groq, Tavily and Jina have been tested against mocks only.
- **Approvals** waiting at reload are not resumed; an aborted reply cannot be continued.
- **Pricing** is unavailable for Anthropic, Gemini, DeepSeek and Groq, so usage shows tokens only.
- **Backups** are plaintext JSON unless a backup password is set when exporting.
