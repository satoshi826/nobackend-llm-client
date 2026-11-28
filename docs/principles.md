# nobackend-llm-client — Principles

What this app is and the rules every change keeps. It states what is true now; how and why it got here is in the git history. UI rules are in [design-system.md](design-system.md), UI wording in [writing.md](writing.md). Setup and deployment are in the [README](../README.md).

## 1. Purpose

A chat client for LLM APIs that runs entirely in the browser, for people who want less-censored or open-weight models without leaving logs in a SaaS product, and without hosting a server or running a model locally.

- **Bring your own key, no backend.** Static files only. The browser talks to each provider's API directly with the user's key. The one optional server is a fetch relay the user deploys for themselves; nothing uses it unless it is configured at build time.
- **General-purpose.** Chat, web search, files, images, videos, skills and an agent-style tool loop.
- **Not goals:** accounts, sync between devices, analytics, role-play features, adding providers from the UI at runtime.

## 2. Security

Threats the design holds against, and the rule that holds each one.

- **The app never holds an API key.** Only the key vault page reads, stores, shows or sends keys; the app asks the vault to make keyed requests and never sees the value. *Why:* the app's code, its rendering of model output and its dependencies never touch a key. Against a script running in the app (XSS) only a vault on its own origin protects the keys; a vault on the app's origin is within that script's reach (README, strict setup). The one key outside the vault is the Jina Reader key: the fetch page keeps it in its own storage and sends it only to Jina Reader, which the app never reaches.
- **A key goes only to its provider's fixed hosts.** Allowed hosts are fixed at build time; the vault refuses any other host, refuses redirects and drops auth headers the app sends. Providers cannot be added at runtime. *Why:* a script or a prompt must not be able to send a key elsewhere. *Check:* vault tests.
- **No script but our own in the app.** Every document has a strict CSP (no inline script, `script-src 'self'`), sent as a header and also written in the HTML for hosts that send no headers, Trusted Types, sanitized Markdown, and images linked in answers are never fetched; media plays only from data stored in the app (`media-src blob:`). No analytics or third-party scripts; host features that inject scripts (e.g. Cloudflare Web Analytics, Rocket Loader) stay off. *Check:* CSP tests, production headers locally (README).
- **Scripts a model writes or a file holds run only in the sandbox,** and only when the user presses run or approves the tool. The sandbox page is framed with `sandbox="allow-scripts allow-forms"` (no origin of its own: no app storage, no key vault, no page around it; forms run their submit handlers), its CSP blocks every request, form submissions included, the app's `frame-src` keeps it from navigating to another site, it does nothing when it has an origin (framed without the sandbox, or opened directly), it talks to the app only over a private port, and the app checks the shape of everything that arrives on it before using it (the shown page runs in the same window, so it may send there too), a shown page gets only the files of its site (the nearest folder above it with an index.html, else its own folder; a page at the top gets none), and the app takes from it only its log (console output and errors, as text, shown to the user and to a model trying the page) and its localStorage (an object of strings up to 1.5 million characters, checked on arrival), kept in localStorage.json at the top of its site; a page a model tries (preview_page) keeps nothing, and a shown page that stops answering is removed. Left open: DNS prefetch hints (asked off, not guaranteed by browsers), and peer connections (WebRTC) in browsers that do not enforce the CSP's `webrtc` directive, Chrome among them (the sandbox removes them from its own window, but a frame the code creates has its own). *Why:* HTML and code from a model are untrusted, but showing and running them is useful. *Check:* sandbox tests; in a production build in a browser, a fetch, a form submission and a navigation to another site from the sandbox all fail.
- **With a passphrase, everything personal is encrypted at rest.** Keys, conversations, files, images, saved prompts, skills, and the settings that hold the user's own text (default instructions, image options); only what is needed for ordering and indexing stays plain, and the fetch page's own data (§3) is outside the app's reach and not encrypted. The whole app is hidden behind a lock screen until unlocked, unlock is per tab and per reload, and locking drops all decrypted data from memory. *Why:* someone with the device or a copy of the browser profile must not read anything.
- **Showing a saved key asks for the passphrase again,** even while unlocked. *Why:* an unlocked device left alone must not give a key away.
- **The web is fetched only through the fetch page, after the user confirms.** Only that page may reach arbitrary https addresses (its own CSP); it shows the address and asks before every fetch unless the user chose not to be asked again for that site (for reading pages and for saving files apart, next to a warning that the site then gets whatever the model puts in an address), and limits the size it passes on; the app limits the types it keeps. A page read for a model goes to a separate call with no tools that answers the model's request from it; only that answer reaches the model in the conversation. *Why:* a prompt-injected model must not be able to send anything out inside an address. Against a script running in the app this holds only with the fetch page on its own origin, and the app build then leaves out its same-origin copy.
- **A model reads and writes only its conversation's working folder.** The conversation's first file makes the folder, named by the model (after that file when the model gave no name); file tools take paths inside it and have no way to name another folder, and a file attached to the conversation from elsewhere can be read but not changed. A model's delete asks the user every time, whatever the settings say, and its searches run in the sandbox under a time limit. Only the user gives an existing folder to a chat, by starting a new one on it from the Files tab, and never to a temporary chat. *Why:* a mistaken or prompt-injected model must not read or overwrite the files of other conversations. *Check:* working folder tests.
- **Experimental, at the builder's own risk: shown pages may do more, only in a build that asks for it.** With `VITE_EXPERIMENTAL_PAGE_API=1`, a page in a folder that the user shows (never one a model tries) may read and write the text files of its site, get answers from the model of the next new chat (no tools, at most 20 a minute), and, when the build also has a relay, make GET requests to https addresses through the fetch page, asked about like any fetch (sites not asked about again are kept apart for pages; images in the page are fetched the same way). The sandbox's CSP does not change: every call goes to the app over the private port, and the fetch page itself refuses pages' requests in a build without the flag and a relay. Not for builds served to others. *Why:* the owner's own tools (scrapers, viewers of a site) need the web and their files; what it opens (a page sending its site's files to a site not asked about again, model calls that cost money) is accepted only by whoever builds with the flag.
- **Tool results and files from outside are untrusted input.** They are marked as such for the model (web results, and the text of attached, uploaded or fetched files), the system prompt tells models that see them to follow no instructions in them; tools that send data to an address the model chooses ask every time unless the user allows them in settings, next to a warning (never with one press on the approval card), and a search query is the only thing sent without asking by default; creating or changing a skill always asks. *Why:* prompt injection through pages and search results.
- **Leaked keys are limited.** The app tells users to use spend-limited keys.
- **Out of scope:** a malicious build of the app itself (self-deploy instead of trusting a distributor), a compromised browser or OS, and a conversation while it is unlocked and on screen.

## 3. Data

- **Everything stays in this browser.** Conversations, files, images, settings and the usage log live in IndexedDB of this origin; nothing is sent anywhere except the requests the user makes to providers and services they enabled.
- **Temporary chats are never written** (not to the database, not to the usage log).
- **Deleting a conversation keeps what was made in it unless the user chooses otherwise.** Its images, videos and files (made or brought in there) stay in the Files tab, unless the user ticks the box in the delete confirmation that deletes them too (unticked by default); a temporary chat's always go with it.
- **A file keeps its current text and the one before its last change, nothing older.** Undo swaps the two; appending to a file and a page saving its localStorage leave the earlier text as it was. *Why:* a model that edits a file dozens of times would otherwise pile up full copies of it.
- **A path names one thing in the whole app.** Files and named images (uploaded or fetched) share one set of paths: folders separated by `/`, compared in NFC with case folded, and no path is another one's folder. A name already in use gets a number when the user brings something in, and is refused when they rename. *Why:* pages and tools find files by path, and a folder must stay one folder on a disk or in a zip.
- **Backups never contain keys or the data key.** They can be encrypted with a separate password.
- **A backup from any released version can be read.** Each backup version keeps a backup of its own made by its export (`src/lib/db/backups/`), and the tests import every one. *Why:* a backup outlives the version that wrote it, and unlike the database it cannot be converted later.
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
- **Only what changed is drawn again.** An answer being written updates its own message only, and list rows get props that stay the same unless the row changed. *Why:* with thousands of rows or a long answer, redrawing everything makes the app stall, and nothing on screen shows it. *Check:* render-count tests (`Filer.render.test.tsx`) and `npm run perf`.
- **Every list that grows with use is measured.** A list whose items pile up as the app is used (conversations, files, images, models, usage records, …) has a scenario in `npm run perf` at the size users reach. *Why:* a list nobody measured stays slow without anyone noticing.
- **Performance work is measured.** A change made for speed is compared with its base by `npm run perf` (scripts/perf), and the result goes in its commit message. *Why:* a change that should be faster may do nothing, or make another step slower.
- **The first screen loads only what it shows.** Other screens and large libraries load when first opened.
- **The vault page has no framework** and builds its DOM with `createElement` / `textContent` only.
- **Boundaries narrow upstream shapes.** Provider responses and stored records are turned into the app's own types where they enter; the rest of the code never sees a provider's raw shape.

## 6. Language

- The UI is in Japanese (reference), English and Simplified Chinese; every text exists in all three. Prompts the app sends to models are in English, and ask for answers the user reads in the conversation's language. Wording rules: [writing.md](writing.md).

## 7. Verifying a change

- `npm test`, `npm run typecheck`, `npm run lint` and `npm run lint:deps` pass.
- Behavior is checked in the browser, against the mock server when it needs a provider (README).
- UI changes go through the design system's checklist ([design-system.md](design-system.md) §2).
