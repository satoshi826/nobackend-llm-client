# Architecture: layers, extension points and the migration plan

Status: adopted 2026-11-25. The files feature is built this way. Moving the existing features over is the next piece of work (§5).

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
| Tool providers | `state/tool-registry.ts` `registerToolProvider` | Tools offered to the model for a reply, plus a system-prompt note (files, images) |
| Routes | `state/router.ts` `registerRoute` | URL hash routes restored after reload (`#/c/<id>`, `#/f/<id>`) |
| Main views | `components/extensions.ts` `registerMainView` | Screens shown instead of the chat (`mainView` signal) |
| Sidebar tabs | `registerSidebarTab` | Tabs next to 会話; `onSelect` shows the feature's screen in the main area |
| Composer add-ons | `registerComposerAddon` | Toolbar button, content above the input, extras sent with the message (`SendExtras`), dropped / pasted files |
| Tool views | `registerToolView` | Label, icon, summary, finished status and detail content of a tool card |
| User message extras | `registerUserMessageExtra` | Content under a user message (attachment chips) |
| Settings sections | `registerSettingsSection` | Sections added to a settings tab (shared building blocks in `components/settings-ui.tsx`) |

Registries are plain arrays filled at import time, before the first render. A new point is added only when a second feature needs the same kind of hook, or when a feature would otherwise have to edit a core file.

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

## 5. Migration plan for existing features

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
5. **Split the large core components** (`ChatView` 600+ lines, `SettingsModal` 600+ lines) along the seams the steps above leave behind.
6. **Narrow `state/app.ts`**: it re-exports everything today. Components should import from the specific module or the feature's `index.ts`.
7. **Enforce the rules in CI** with dependency-cruiser:
   - `lib` must not import `state`, `components` or `features`;
   - `state` must not import `components` or `features`;
   - `components` must not import `features`;
   - one feature may import another only through its `index.ts`.
   Add an `npm run lint:deps` script to the build check.

## 6. Known debt (to clear during the migration)

- 14 of 14 core components import `lib/` directly. That is acceptable for types; for behavior they should go through state or a feature.
- `venice` is hard-coded in 9 files outside its preset. This is solved by the image-provider abstraction and by moving Venice-specific UI text into the preset.
- `lib/` contains Japanese user-facing strings (errors, labels). Before any localization, move them to message keys resolved in the UI.
- `generation.ts` still holds approvals, balance tracking, suggestions and compaction triggers. Split them out once skills and images have moved.
