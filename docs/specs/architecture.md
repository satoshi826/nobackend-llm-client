# Architecture: layers, extension points and the migration plan

Status: adopted and applied 2026-11-25. Images, web search, skills, files and the usage tab are features; the rules are checked by `npm run lint:deps` (part of `npm run build`).

## 1. Why

The app grew one feature at a time, and each feature was wired directly into the core:
- the image tool sat in `generation.ts`;
- image settings sat in `SettingsModal`;
- image cards sat in `ToolCallCard`;
- the gallery button sat in `Sidebar`;
- image types were checked in `request.ts`.

Adding a feature meant editing ten core files, and every one of those edits made the next feature harder. The rules below keep new features out of the core.

## 2. Layers and the dependency rule

```
lib/         pure logic and storage (no Preact, no signals, no DOM except where unavoidable)
  ↑
state/       core app state (signals) and orchestration: conversations, generation, settings, keys, lock …
  ↑
components/  core UI: shell, chat, settings, dialogs
  ↑
features/*   one folder per feature: its own lib-like code, state and components
```

- A layer imports only from layers below it. `lib` never imports `state`, `components` or `features`. The core (`state`, `components`) never imports `features`.
- A feature uses other features only through their `index.ts`; it never reaches into another feature's internals.
- A feature joins the app through **extension points** (§3). `src/features/index.ts` imports every feature once at startup (from `main.tsx`), and that is the only place a feature is named.
- Storage schema changes stay central (`lib/db/schema.ts`), because Dexie versions are global. A feature keeps its persistence helpers in `lib/db/<feature>.ts`, so backups (`lib/db/export.ts`) and re-encryption (`repo.resealAll`) can include it without importing the feature.

## 3. Extension points

| Point | Where | Used for |
|---|---|---|
| Tool providers | `state/tool-registry.ts` `registerToolProvider` | Tools (and tools unlocked mid-turn), system-prompt notes and the provider's built-in search for a reply (images, files, web, skills) |
| Request handlers | `registerUserRequestHandler` | User messages a feature answers itself; regenerate / edit go back to it (image requests) |
| Message transforms | `lib/chat/request.ts` `registerMessageTransform` | What is sent for a stored message (image note, picked skills, attached files) |
| Data loaders | `state/lifecycle.ts` `registerDataLoader` | Loading a feature's stored data at startup, after unlock and after import (skills) |
| Routes | `state/router.ts` `registerRoute` | URL hash routes restored after reload (`#/c/<id>`, `#/f/<id>`) |
| Main views | `components/extensions.ts` `registerMainView` | Screens shown instead of the chat (`mainView` signal) |
| Sidebar tabs | `registerSidebarTab` | Tabs next to 会話; `onSelect` shows the feature's screen in the main area |
| Composer add-ons | `registerComposerAddon` | A button (`placement: 'inside'` = bottom left inside the input box, e.g. attach; default = the chip row below the box), content above the input, a mode that takes over the input (image mode), key handling (`/` suggestions), extras sent with the message (`SendExtras`), dropped / pasted files |
| Model slot | `registerModelSlot` | Replaces the model button (bottom right of the input box) while it applies (the image model in image mode) |
| Assistant extras | `registerAssistantExtra` | Content inside an assistant message, and messages the feature owns (generated images) |
| Overlays | `registerOverlay` | Components rendered once at the root (the image viewer) |
| Settings tabs | `registerSettingsTab` | Whole tabs between the core tabs and プライバシーとデータ (Web 検索, スキル, 使用量) |
| Tool views | `registerToolView` | Label, icon, summary, finished status, detail content, editable approval field and note, or a whole approval card of its own |
| User message extras | `registerUserMessageExtra` | Content under a user message (attachment chips) |
| Settings sections | `registerSettingsSection` | Sections added to a settings tab (shared building blocks in `components/settings-ui.tsx`) |

Registries are plain arrays filled at import time, before the first render. A new point is added only when a second feature needs the same kind of hook, or when a feature would otherwise have to edit a core file.

### 3.1 Loading screens later (code splitting)

Screens that are not on the first screen load their code when first opened. Register them through `lazyComponent` (`components/lazy.tsx`) instead of importing the component:

```ts
registerMainView({ kind: 'files', Component: lazyComponent(() => import('./components/Filer').then((m) => m.Filer)) });
```

- Split: settings (the modal and every tab / section a feature adds), the model picker, the file manager and the file screen. The first screen (sidebar, chat, composer, message parts, tool cards) stays in the main chunk.
- The split module must not be imported statically from anywhere else, or it is pulled back into the main chunk. Code shared with first-screen parts goes in a small module of its own (e.g. `features/files/components/filer-items.ts` for the sidebar's Files panel).
- `preloadLazyComponents()` (called from `main.tsx`) fetches every split chunk when the browser is idle, and the service worker caches all of them at install, so opening a screen normally does not wait.
- While loading: nothing for 150 ms, then a spinner. On failure (offline before caching, or an update removed the old file): a message with 再読み込み (and 閉じる for dialogs). Browsers remember a failed `import()` of a URL, so a reload is the only fix.
- Large libraries are split the same way at their call sites (pdf.js, highlight.js).

## 4. Anatomy of a feature (`src/features/files`)

```
features/files/
  index.ts        registers everything; the feature's public API
  state.ts        signals and actions; registers tool provider and route
  tools.ts        Tool definitions (pure; storage injected)
  extract.ts      helpers (PDF / text extraction)
  csv.ts          helpers
  components/     UI pieces handed to the extension points
  files.test.ts
lib/db/files.ts   persistence (kept in lib so backup / reseal can include it)
```

## 5. Migration (done)

What was done, in order (kept as a record of where things went):

Each step is a refactor with no change in behavior, done with the tests and a browser check.

1. **Images → `features/images`**
   - Move `state/images.ts`, `ImageView`, `ImageBar` and the image parts of `ToolCallCard`, `MessageItem`, `ChatView` (header badge, image mode button), `SettingsModal` (image section) and `request.ts` (image note).
   - New extension points this needs: a header slot, an assistant-message renderer for messages with `image`, and a request transformer so `lib/chat/request.ts` stops knowing about images.
   - This is also the step where the image-provider abstraction lands ([image-providers.md](image-providers.md)).
2. **Web search → `features/web`**
   - Move the tools, the approval-card field mapping and the Web search settings tab.
   - Needs a settings-tab extension point and a per-tool approval-card description.
3. **Skills → `features/skills`**
   - Move the skills state, the skills tab, the composer skill menu / slash suggestions, and the `load_skill` / `save_skill` tools.
   - `generation.ts` keeps only the generic loop.
4. **Usage → `features/usage`** (settings tab, recording hook after a reply).
5. **Split the large core components**: `ChatView` became `components/chat/` (Header, Composer, MessageList, Onboarding); `SettingsModal` became `components/settings/` (ConnectionsTab, ChatTab, PrivacyTab, AccountRow).
6. **Narrow `state/app.ts`**: it no longer re-exports anything; code imports the specific state module or a feature's `index.ts`.
7. **Enforce the rules**: `scripts/check-deps.mjs` (`npm run lint:deps`, run by `npm run build`) fails when
   - `lib` imports `state`, `components` or `features`;
   - `state` imports `components` or `features`;
   - `components` imports `features`, or anything but `main.tsx` loads features;
   - a feature imports another feature's internals instead of its `index.ts`;
   - the key vault imports the app.

## 6. Follow-ups done after the migration

- **Feature settings**: features own their settings (`state/feature-settings.ts`, `defineFeatureSettings(id, defaults, legacy)`), stored as `settings:<id>` and loaded right after the core settings. Values that used to be in the core record are copied once (`pickLegacy`). Images (`imageFormat`, `imageDefaults`, `imageTool`), files (`fileTools`), web (`searchEngine`) and skills (`disabledBuiltinSkills`) use it; tool permissions stay in the core.
- **Data tables**: storage modules register their table (`lib/db/data-tables.ts`, `registerDataTable`): backup key, export / clean / import, re-encryption and what happens when a conversation is deleted. Backups, the passphrase switch and conversation deletion iterate the registry (images and files today). Backup files keep the same property names.
- **generation.ts split**: `runs` (streaming and the stop button), `balance`, `approvals`, `suggestions`, `compaction` and `request-helpers` are separate state modules; `generation.ts` only sends, regenerates and edits.
- **i18n**: see [i18n.md](i18n.md). Every folder keeps its messages in `messages.ts`; `lib/` errors and model prompts are localized too.

## 7. Remaining debt

- Usage recording stays in the core (`recordUsage`, image jobs write their own record); only the usage tab is a feature. This is deliberate: every reply records usage.
- The dependency check is a small script (`scripts/check-deps.mjs`) because dependency-cruiser cannot read TypeScript 7 sources yet.
