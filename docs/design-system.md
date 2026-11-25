# Design system — "Moonlight"

Status: direction chosen 2026-11-25 (A. Glass, Moonlight variant). Mock-ups: the design canvas "nobackend LLM client — デザインの方向性（仮 UI）", artboards A (layout) and A-5 Moonlight (colors). Tokens below are the source of truth; `src/styles.css` implements them as CSS variables / Tailwind theme values.

## 1. Principles

1. **Quiet glass on a dark night.** A near-black ground, a few large, slow, desaturated light blobs behind, and translucent "glass" panels on top. The light sets the mood; it never competes with the text.
2. **Color means something.** Silver is the only accent (focus, selection, the primary action). Green = protected / private, amber = relayed / caution, rose = danger / error. Features do not get their own colors (no violet skills, green attachments, fuchsia images, sky web search): they are told apart by icon and label.
3. **One way to do each thing.** One button set, one chip, one card, one field style, one dialog. A new screen is built from these, not restyled locally.
4. **Motion explains, never decorates.** Things appear (rise / fade), the background drifts slowly, controls respond on hover/press. Everything stops under `prefers-reduced-motion`.
5. **Text first.** Body copy stays high-contrast (≥ 4.5:1 on its glass); secondary text never drops below 4.5:1 at ≤ 14 px.

## 2. Tokens

### 2.1 Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07080d` | Page ground |
| `--glow-1` / `--glow-2` / `--glow-3` | `#64748b` / `#6366f1` / `#94a3b8` | Background light blobs (opacity 0.30 / 0.24 / 0.13, blur 110–120 px) |
| `--glass` | `rgba(255,255,255,.06)` | Panels (sidebar, header, cards, composer) |
| `--glass-strong` | `rgba(255,255,255,.10)` | Raised / hovered glass, active row |
| `--sunken` | `rgba(0,0,0,.25)` | Fields, segmented controls inside glass |
| `--line` | `rgba(255,255,255,.12)` | Panel borders, dividers |
| `--line-strong` | `rgba(255,255,255,.22)` | Hover borders, focused fields |
| `--ink` | `#e7e9f3` | Body |
| `--ink-strong` | `#ffffff` | Headings, selected items |
| `--muted` | `#a3a8bd` | Secondary text, captions |
| `--faint` | `#868ba3` | Group labels, placeholders (≥ 12 px only) |
| `--accent` | `#cbd5e1` | Primary button fill, focus ring, selection |
| `--accent-ink` | `#0b0d17` | Text/icons on `--accent` |
| `--accent-soft` | `rgba(203,213,225,.14)` | Selected chips, the user's bubble |
| `--ok` / `--ok-soft` | `#6ee7b7` / `rgba(52,211,153,.16)` | private, success |
| `--warn` / `--warn-soft` | `#fcd34d` / `rgba(251,191,36,.14)` | relayed, caution |
| `--danger` / `--danger-soft` | `#fda4af` / `rgba(244,63,94,.16)` | errors, destructive actions |

Dark is the default theme. The light theme uses the same token names with light values (`:root` in `src/styles.css`): ground `#eceef4`, white glass, slate accent `#334155`.

### 2.2 Glass

`background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(24px) saturate(140%)`. Floating surfaces (composer, menus, toasts) add `box-shadow: 0 20px 60px rgba(0,0,0,.35)`. Glass is never stacked more than two deep (panel → card inside); a third layer uses `--glass-sunken`.

### 2.3 Type

Inter + Noto Sans JP (system fallback). Sizes: 12 (captions, badges), 13 (chips, secondary), 14 (UI default), 15 (message body, input), 18 (section titles), 24 (screen titles). Weights 400 / 500 / 600. Line height 1.7–1.8 for message text, 1.4 for UI.

### 2.4 Space, radius, size

- Spacing scale (px): 4, 6, 8, 12, 16, 20, 24, 32.
- Radius: 10 (buttons, chips that are not pills), 12–14 (rows, fields, small cards), 18 (message bubbles, cards), 22 (panels, composer), 999 (pills, badges, round buttons).
- Control heights: 34 (compact chips / toolbar buttons), 40 (default buttons, fields), 44 (primary actions, send). Touch targets ≥ 44 px on touch devices.

### 2.5 Motion

| Name | Spec |
|---|---|
| `drift` | Background blobs, 22–30 s ease-in-out loop, translate ≤ 140 px, scale 0.95–1.15 |
| `rise` | New message / card: 0.6 s cubic-bezier(.2,.7,.2,1), from 10 px below + transparent |
| `press` | Everything clickable: scale .97 on active, 80 ms |
| `hover` | Color / background / border 200 ms on every interactive element (base layer in styles.css); icons in buttons grow slightly; cards that open something lift 2 px (`lift`) |
| `slide` | Segmented / tab indicators, switch knob, drawer: 300 ms ease-out (knob: spring) |
| `collapse` | Accordions: grid rows 0fr ↔ 1fr + opacity, 300 ms |
| `pop` | Menus: 180 ms fade + scale from .96 |
| `fade-in` | Settings tab panels, the selection bar: 220 ms |
| `caret` | Streaming caret blink 1 s steps |
| `shimmer` | "Working…" text sweep 2.2 s linear |

All animations are disabled under `prefers-reduced-motion: reduce`.

## 3. Components

- **Button**: `primary` (accent fill, accent-ink text; one per view), `secondary` (glass + line), `ghost` (transparent, glass-strong on hover), `danger` (danger-soft fill, danger text). Icon-only buttons are round or square, always with `aria-label`.
- **Chip / toggle chip** (`Chip`): pill, 32 px; off = glass + line; on = accent-soft + strong text + `aria-pressed`.
- **Badge**: pill, 12 px, soft background of its meaning color (ok / warn / neutral). `private` keeps its name and lock icon.
- **Field**: glass-sunken, radius 12, no visible border until hover/focus (line-strong), focus ring = accent 2 px.
- **Segmented control** (`Segmented`: sidebar tabs, theme picker, grid / list): sunken track, glass-strong selected segment that slides to the chosen item.
- **Tab strip** (`TabStrip`: settings): text tabs with an accent underline that slides to the selected tab; the panel fades in.
- **Switch** (`Toggle` in settings-ui, `.switch`): text left, switch right; the knob slides with a slight spring and stretches while pressed.
- **Accordion** (`Collapse`; `<details>` where supported): height and opacity animate open and closed; the chevron rotates.
- **Menu / popover** (`components/menu.tsx`: `Popover`, `MenuItem`, `MenuSeparator`): every floating list uses it. It renders in a portal on `<body>` (inside glass, a backdrop-filter only blurs that glass, so a menu in the composer could not blur the page), places itself from its anchor and flips when there is no room, and closes on Escape or a press outside. It is an opaque `panel` with a strong blur, radius 16, and opens with `pop` (fade + scale from .96). Arrow keys move between items.
- **Card**: glass, radius 18; tool cards and file cards use it; the header row is 13 px muted with an icon.
- **Dialog**: a `frosted` window — translucent, with what shows through strongly blurred (48 px) — over the `backdrop` utility, which neither darkens nor blurs the page (a backdrop-filter there would stop the window's own blur). Radius 22, max width 640 (wide 900); focus handling as `useDialog`. Menus stay nearly opaque `panel`s.
- **Toast**: floating glass, bottom center, above the composer.

## 4. Screen patterns

- **Shell**: 16 px outer padding on desktop; sidebar and main are separate glass panels with a 16 px gap. On phones the sidebar becomes a full-height glass drawer over the scrim; the main area loses its outer padding.
- **Chat**: header is a glass bar; messages sit directly on the background (no panel) inside a 720–760 px column; the composer is floating glass anchored to the bottom.
- **Lists** (conversations, files list view, settings rows): rows on glass, active row glass-strong; no zebra stripes.
- **File manager**: cards on glass; previews on glass-sunken.

## 5. Writing

See [specs/i18n.md](specs/i18n.md) (wording rules for all three languages).

## 6. Implementation notes

- Tokens live in `src/styles.css` (`:root` light values, `.dark` overrides, exposed to Tailwind through `@theme inline` as `bg-glass`, `text-ink`, `border-line`, …). Components use the tokens through a small set of shared classes / components in `components/ui.tsx`; features never introduce their own colors.
- The key vault page (`vault/style.css`) uses the same variable names.

## 7. Decisions (2026-11-25)

- Applied to every screen; dark is the default theme.
- Composer: attach inside on the left; model and send inside on the right (the model moved out of the header); 画像 / Web 検索 / スキル as chips below the box. Placeholder is just 「メッセージを入力」.
- Header: conversation title, temporary chat, context meter, 指示.
- No "relayed" badge on answers or in the composer (the model picker still shows it where models are chosen); "private" keeps its lock.
- Regenerate and "regenerate with another model" are one control.
- Settings gain 表示 (theme, language) and 機能 (image and file sections).
- Model-picker capability badges are neutral; only private / relayed / deprecated keep meaning colors.
- Not done yet (deliberately): a "…" menu per message, context meter / compaction split, moving 指示 into a menu, hover-only answer meta.
