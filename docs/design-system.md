# Design system — "Moonlight"

The rules every screen follows: principles for judgment calls (§1), concrete rules with how to check them (§2), and the tokens (§3). It states what is true now; how and why it got here is in the git history. `src/styles.css` implements the tokens: change a value in both, in the same commit.

## 1. Principles

1. **Quiet glass on a dark night.** A near-black ground, a few large, slow, desaturated light blobs behind, and translucent "glass" panels on top. The light sets the mood; it never competes with the text.
2. **Color means something.** Silver is the only accent (focus, selection, the primary action). Green = protected / private, amber = relayed / caution, rose = danger / error. Features do not get their own colors (no violet skills, green attachments, fuchsia images, sky web search): they are told apart by icon and label.
3. **Consistent everywhere.** The same kind of thing looks, moves and reads the same wherever it appears, so what the user learns in one place holds in every other: the app's model is learned by using it. Before adding UI, find where the app already does the same thing and do it that way.
4. **Shared components, not copies.** UI that should be the same is one component (`components/ui.tsx`, `components/settings-ui.tsx`), used everywhere; a screen never re-creates it with its own markup and classes. A continuous setting, for example, is always the shared `Slider`, never a bare range input. Copies drift apart, and a fix then reaches only one of them.
5. **Icons carry meaning.** Actions, navigation and kinds of things get an icon, so they are recognized at a glance, in any of the three languages and in narrow space. One meaning has one icon everywhere; icon-only buttons always have `aria-label` and a tooltip.
6. **Motion explains, never decorates.** Things appear (rise / fade), the background drifts slowly, controls respond on hover/press. Everything stops under `prefers-reduced-motion`.
7. **No layout shift.** What is on screen never moves unless the user moved it: content that arrives later (images, highlighted code, fonts, loaded data, a toast) has its space reserved or floats over the page, and nothing pushes what the user is reading or about to press.
8. **Text first.** Body copy stays high-contrast (≥ 4.5:1 on its glass); secondary text never drops below 4.5:1 at ≤ 14 px.

## 2. Rules

- **A container keeps its size.** Switching tabs, selection or hover never resizes a dialog, panel or row, and never moves what is around it. *Why:* a moving frame shifts what the user was about to press. *Check:* switch every tab / item and measure the container.
- **Text is never crushed.** A control with a label never shrinks below its text; in a row that runs out of room, the free text wraps instead. *Check:* every screen at 320 px wide.
- **Scroll areas reach the edge of their surface.** No empty strip is left beside a scrollbar. *Check:* scroll every long area at 1100 px wide.
- **Clickable looks clickable, and only that.** Everything clickable has the pointer cursor, a hover state and the press response; nothing else has them; disabled controls show not-allowed. *Check:* hover each control.
- **Fit the input device.** On touch devices no text field is focused automatically unless typing is the only way on (the on-screen keyboard would cover the screen); anything shown only on hover is always shown on touch. Enter in the composer inserts a newline on touch devices. *Check:* open the screen with touch emulation (375 px) and watch the keyboard and focus.
- **Selection is shown one way.** The selected item gets a background that slides to it (segmented controls, side tabs, the conversation list), or, in a row of text tabs, an underline that slides. *Check:* any new selectable list uses the same shared highlight.
- **Open and close one way.** Anything that opens and closes has its chevron at the right end, pointing down, turned up while open, and its content opens with the height animation. *Check:* no `<details>`, no left-hand or sideways chevrons, no "show / hide" label swaps.
- **Destructive actions look the same and always ask first.** An icon-only delete turns red only under the pointer; a labelled one is the danger button with the trash icon. Anything that cannot be undone is confirmed before it runs (the vault page uses its in-page confirm card). *Check:* every delete, clear and wipe.
- **A busy control keeps its label and width.** While it works, a spinner takes the place of its icon (or covers the label where there is no icon); the text does not change to "…ing". *Check:* start each slow action and watch the control.
- **Every interactive element is reachable by keyboard.** Visible `:focus-visible` ring, Tab stays inside an open dialog, Esc closes the topmost one, focus returns to the opener. *Check:* go through the screen with Tab, Enter and Esc.
- **No browser dialogs.** No `alert()` / `confirm()` / `prompt()`; confirmations are in-app dialogs.

### When UI changes

1. Find where the app already does the same thing; reuse that component or extract a shared one (§1.3, §1.4).
2. View the screen at 320, 768 and 1100 px, and once with touch emulation.
3. Switch every tab / mode on the screen and confirm nothing resizes or shifts.
4. Go through it with the keyboard only.
5. If a problem slipped through, name the principle or rule it broke; if none covers it, propose one for this document, then check the rest of the app against it.

## 3. Tokens

### 3.1 Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07080d` | Page ground |
| `--glow-1` / `--glow-2` / `--glow-3` | `#64748b` / `#6366f1` / `#94a3b8` | Background light blobs (opacity 0.30 / 0.24 / 0.13, blur 110–120 px): the Moonlight set and the default. Settings → 表示 → 背景 can pick another light set and its drift speed (0 holds it still; a change never makes the light jump), or replace the light with a solid colour or the user's picture, darkened so text stays readable |
| `--glass` | `rgba(255,255,255,.06)` | Panels (sidebar, header, cards, composer) |
| `--glass-strong` | `rgba(255,255,255,.11)` | Raised / hovered glass, active row |
| `--sunken` | `rgba(0,0,0,.35)` | Fields, segmented controls inside glass |
| `--line` | `rgba(255,255,255,.12)` | Panel borders, dividers, edges of fields and selects |
| `--line-strong` | `rgba(255,255,255,.24)` | Hover borders, focused fields |
| `--ink` | `#e7e9f3` | Body |
| `--ink-strong` | `#ffffff` | Headings, selected items |
| `--muted` | `#a3a8bd` | Secondary text, captions |
| `--faint` | `#868ba3` | Group labels, placeholders (≥ 12 px only) |
| `--accent` | `#cbd5e1` | Primary button fill, focus ring, selection |
| `--accent-ink` | `#0b0d17` | Text/icons on `--accent` |
| `--accent-soft` | `rgba(203,213,225,.14)` | Selected chips, the user's bubble |
| `--accent-text` | `#e2e8f0` | Links, chips and running spinners in the accent colour |
| `--ok` / `--ok-soft` | `#6ee7b7` / `rgba(52,211,153,.16)` | private, success |
| `--warn` / `--warn-soft` | `#fcd34d` / `rgba(251,191,36,.14)` | relayed, caution |
| `--danger` / `--danger-soft` | `#fda4af` / `rgba(244,63,94,.16)` | errors, destructive actions |
| `--scrim` | `rgba(0,0,0,.5)` | Fields laid over an image |

**Dark only for now**: the light theme is not offered (`DARK_ONLY` in `state/settings.ts`; the theme picker is hidden and the stored setting is kept). When it comes back, it uses the same token names with light values (`:root` in `src/styles.css`): ground `#eceef4`, white glass, slate accent `#334155`.

### 3.2 Glass

`background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(36px) saturate(140%)`. Floating surfaces (composer, menus, toasts, dialogs) add `--shadow-float` (`0 20px 60px rgba(0,0,0,.35)`) and a stronger blur (40–48 px); the composer, dialogs, menus and toasts mix `--bg` into their fill so what scrolls behind them does not wash them out. Glass is never stacked more than two deep (panel → card inside); a third layer uses `--sunken`.

### 3.3 Type

Inter, then the system's Japanese font (Hiragino Sans, Noto Sans JP, Yu Gothic UI). Sizes: 12 (captions, badges), 13 (chips, secondary), 14 (UI default), 15 (message body, input), 18 (section titles), 24 (screen titles). Weights 400 / 500 / 600. Line height 1.7–1.8 for message text, 1.4 for UI.

### 3.4 Space, radius, size

- Spacing scale (px): 4, 6, 8, 12, 16, 20, 24, 32.
- Radius: 4–6 (tags, inline code, checkboxes, small text buttons), 8 (images, rows, small cards), 10 (buttons, selects, segmented items), 12 (fields, code blocks, lists), 16 (message bubbles, toasts, floating bars), 18 (file cards, the file editor), 22 (dialogs, panels, composer, sidebar), 999 (pills, badges, round buttons).
- Control heights: 34 (compact chips / toolbar buttons), 40 (default buttons, fields), 44 (primary actions, send). Touch targets ≥ 44 px on touch devices.

### 3.5 Motion

| Name | Spec |
|---|---|
| `drift` | Background blobs, 22–30 s ease-in-out loop, translate ≤ 140 px, scale 0.95–1.15 |
| `rise` | New message / card: 0.6 s cubic-bezier(.2,.7,.2,1), from 10 px below + transparent. Frosted dialogs: 0.45 s from 12 px below and scale .98, without the fade |
| `press` | Everything clickable: scale .97 on active, 80 ms |
| `hover` | Color / background / border 200 ms on every interactive element (base layer in styles.css); icons in buttons grow slightly; cards that open something lift 2 px (`lift`) |
| `slide` | Segmented / tab indicators, switch knob, drawer: 300 ms ease-out (knob: spring) |
| `collapse` | Accordions: grid rows 0fr ↔ 1fr + opacity, 300 ms |
| `pop` | Menus: 180 ms fade + scale from .96 |
| `fade-in` | Settings tab panels, the selection bar: 220 ms |
| `caret` | Streaming caret pulse, 2 s |
| `shimmer` | "Working…" text sweep 1.8 s linear |

All animations are disabled under `prefers-reduced-motion: reduce`.
