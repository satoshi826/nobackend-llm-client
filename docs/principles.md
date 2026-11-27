# nobackend-llm-client — Principles

What this app is and the rules every change keeps. It states what is true now; how and why it got here is in the git history. UI rules are in [design-system.md](design-system.md), UI wording in [writing.md](writing.md). Setup and deployment are in the [README](../README.md).

## 1. Purpose

A chat client for LLM APIs that runs entirely in the browser, for people who want less-censored or open-weight models without leaving logs in a SaaS product, and without hosting a server or running a model locally.

- **Bring your own key, no backend.** Static files only. The browser talks to each provider's API directly with the user's key. The one optional server is a fetch relay the user deploys for themselves; nothing uses it unless it is configured at build time.
- **General-purpose.** Chat, web search, files, images, skills and an agent-style tool loop.
- **Not goals:** accounts, sync between devices, analytics, role-play features, adding providers from the UI at runtime.

## 2. Security

Threats the design holds against, and the rule that holds each one.

- **The app never holds an API key.** Only the key vault page reads, stores, shows or sends keys; the app asks the vault to make keyed requests and never sees the value. *Why:* the app's code, its rendering of model output and its dependencies never touch a key. Against a script running in the app (XSS) only a vault on its own origin protects the keys; a vault on the app's origin is within that script's reach (README, strict setup). The one key outside the vault is the Jina Reader key: the fetch page keeps it in its own storage and sends it only to Jina Reader, which the app never reaches.
- **A key goes only to its provider's fixed hosts.** Allowed hosts are fixed at build time; the vault refuses any other host, refuses redirects and drops auth headers the app sends. Providers cannot be added at runtime. *Why:* a script or a prompt must not be able to send a key elsewhere. *Check:* vault tests.
- **No script but our own in the app.** Every document has a strict CSP (no inline script, `script-src 'self'`), sent as a header and also written in the HTML for hosts that send no headers, Trusted Types, sanitized Markdown, and images linked in answers are never fetched. No analytics or third-party scripts; host features that inject scripts (e.g. Cloudflare Web Analytics, Rocket Loader) stay off. *Check:* CSP tests, production headers locally (README).
- **Scripts a model writes or a file holds run only in the sandbox,** and only when the user presses run or approves the tool. The sandbox page is framed with `sandbox="allow-scripts"` (no origin of its own: no app storage, no key vault, no page around it), its CSP blocks every request, the app's `frame-src` keeps it from navigating to another site, it does nothing when it has an origin (framed without the sandbox, or opened directly), it talks to the app only over a private port the shown page cannot reach, and a shown page that stops answering is removed. Left open: DNS prefetch hints (asked off, not guaranteed by browsers), and peer connections (WebRTC) in browsers that do not enforce the CSP's `webrtc` directive, Chrome among them (the sandbox removes them from its own window, but a frame the code creates has its own). *Why:* HTML and code from a model are untrusted, but showing and running them is useful. *Check:* sandbox tests; in a production build in a browser, a fetch and a navigation to another site from the sandbox both fail.
- **With a passphrase, everything personal is encrypted at rest.** Keys, conversations, files, images, saved prompts and skills; only what is needed for ordering and indexing stays plain, and the fetch page's own data (§3) is outside the app's reach and not encrypted. The whole app is hidden behind a lock screen until unlocked, unlock is per tab and per reload, and locking drops all decrypted data from memory. *Why:* someone with the device or a copy of the browser profile must not read anything.
- **Showing a saved key asks for the passphrase again,** even while unlocked. *Why:* an unlocked device left alone must not give a key away.
- **The web is fetched only through the fetch page, after the user confirms.** Only that page may reach arbitrary https addresses (its own CSP); it shows the address and asks before every fetch unless the user chose not to be asked again for that site (for reading pages and for saving files apart, next to a warning that the site then gets whatever the model puts in an address), and limits the size it passes on; the app limits the types it keeps. A page read for a model goes to a separate call with no tools that answers the model's request from it; only that answer reaches the model in the conversation. *Why:* a prompt-injected model must not be able to send anything out inside an address. Against a script running in the app this holds only with the fetch page on its own origin, and the app build then leaves out its same-origin copy.
- **Tool results and files from outside are untrusted input.** They are marked as such for the model (web results, and the text of attached, uploaded or fetched files), the system prompt tells models that see them to follow no instructions in them; tools that send data to an address the model chooses ask every time unless the user allows them in settings, next to a warning (never with one press on the approval card), and a search query is the only thing sent without asking by default; creating or changing a skill always asks. *Why:* prompt injection through pages and search results.
- **Leaked keys are limited.** The app tells users to use spend-limited keys, and warns when a provider balance drops more than this app spent.
- **Out of scope:** a malicious build of the app itself (self-deploy instead of trusting a distributor), a compromised browser or OS, and a conversation while it is unlocked and on screen.

## 3. Data

- **Everything stays in this browser.** Conversations, files, images, settings and the usage log live in IndexedDB of this origin; nothing is sent anywhere except the requests the user makes to providers and services they enabled.
- **Temporary chats are never written** (not to the database, not to the usage log).
- **Deleting a conversation keeps what was made in it.** Its images and documents stay in the Files tab until deleted there; only a temporary chat's go with it.
- **Backups never contain keys or the data key.** They can be encrypted with a separate password.
- **The background picture is stored unencrypted** (downscaled, with the settings) and is included in backups.
- **The fetch page keeps its own data in its own storage:** the Jina Reader key and the sites not asked about, unencrypted and not in backups. They are managed in the fetch page's settings (Settings → Web).
- **Data is per origin.** Moving the app to another URL means export, import and entering the keys again.
- **Storage changes migrate existing data.** A schema change never drops what users have stored.

## 4. Providers and features

- **No provider is privileged.** With none enabled, the user chooses one.
- **Provider differences live in the provider's own definition** (preset / adapter). App code has no branches per provider; wire formats never leak into features.
- **The UI shows capabilities, not routes.** The user turns on what they want (web search, images); the app picks how (the provider's own feature, an app tool, or a direct service call). Which route was used shows only where it matters (an answer's sources, the settings of each connection).
- **Results are normalized** whatever the route: search results become sources, images become stored images, so display, backup, deletion and regeneration treat them the same.
- **Costs are shown honestly.** Reported costs as reported, estimates marked as estimates, unknown as unknown.

## 5. Code structure

- **Dependencies point one way:** `lib` → `state` → `components` → `features`. `lib` never imports state, UI or features; the core never imports a feature; a feature uses another only through its `index.ts`; the vault imports nothing from the app. *Check:* `npm run lint:deps` (part of `npm run build`).
- **Features join through extension points.** A feature registers itself; adding one never means editing the core. A new extension point is added only when a second feature needs the same hook, or a feature would otherwise have to edit a core file.
- **Built for thousands to tens of thousands of items.** Everything keeps working without trouble when conversations, files or images number in the thousands to tens of thousands; designs pay attention to performance with that in mind.
- **The first screen loads only what it shows.** Other screens and large libraries load when first opened.
- **The vault page has no framework** and builds its DOM with `createElement` / `textContent` only.
- **Boundaries narrow upstream shapes.** Provider responses and stored records are turned into the app's own types where they enter; the rest of the code never sees a provider's raw shape.

## 6. Language

- The UI is in Japanese (reference), English and Simplified Chinese; every text exists in all three. Prompts the app sends to models follow the UI language. Wording rules: [writing.md](writing.md).

## 7. Verifying a change

- `npm test`, `npm run typecheck` and `npm run lint:deps` pass.
- Behavior is checked in the browser, against the mock server when it needs a provider (README).
- UI changes go through the design system's checklist ([design-system.md](design-system.md) §2).
