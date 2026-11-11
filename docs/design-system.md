# SubCleared design system

The live reference is `/design` (rendered with the application's own components). Tokens live in `src/styles.css` (CSS variables) and `tailwind.config.cjs`; components in `src/ui/index.tsx`.

## Principles

1. Neutrals carry the interface. Colour is for meaning, never decoration.
2. One accent (deep cyan) marks what you can act on and where you are.
3. Status is always an icon **and** words. Colour is the third signal, not the first.
4. One primary action per view, labelled verb + object ("Request documents").
5. Show the summary first; reveal detail on demand (expand rows, side panels).
6. Side panels (drawers) for contextual editing; dialogs only for short decisions and confirmations.

## Colour — "Graphite & Deep Cyan"

| Token | HEX | Use |
|---|---|---|
| `canvas` | #F7F8F8 | App background |
| `paper` | #FFFFFF | Inputs, drawers, dialogs, preview panes |
| `raised` | #EEF1F2 | Hover, selected rows, skeletons |
| `ink` | #161B1F | Headings, body text, values |
| `muted` | #4B555E | Descriptions, supporting copy |
| `faint` | #626C76 | Metadata, timestamps, hints |
| `line` | #E2E6E8 | Dividers, table rows |
| `line-strong` | #C7CDD1 | Input borders, section rules, table header rule |
| `accent` | #155E75 | Primary buttons, links, active navigation, focus |
| `accent-hover` | #0E4C5F | Primary hover |
| `accent-tint` | #E7F0F3 | Selected navigation background |
| `success` | #1E784A | Ready, approved, in date |
| `warning` | #9B5800 | Expiring soon, needs attention |
| `danger` | #B22218 | Not ready, expired, rejected, missing; destructive buttons |
| `info` | #295999 | Awaiting review, in progress |
| tints | #E9F4ED · #FBF2E4 · #FCECEA · #EBF1FA | Callout backgrounds only |

Text colours: success and danger colour the label (the two ends of the scale); warning and info colour only the icon, so screens never look like a traffic light. All text tokens pass WCAG AA on the canvas.

Directions considered: *Site Ivory* (previous; green accent collided with "ready", no distinct status colours) and *Stone & Signal* (orange accent read as hi-vis cliché and competed with warnings). Details on `/design`.

## Typography — Inter (+ IBM Plex Mono for codes)

Inter, IBM Plex Sans, Geist and Manrope were evaluated (Plex was the previous choice). Inter was chosen for the clearest tabular figures in dense tables, strong legibility at small sizes and the widest language coverage for an international product. Self-hosted variable font; weights 400/500/600 only; `cv11` (single-storey a) and `ss03` features on.

| Role | Size / line height · weight |
|---|---|
| Page title | 28/34 · 500 |
| Section heading | 18/26 · 600 |
| Subheading | 16/25 · 600 |
| Body, table cell, form field | 15/24 · 400 |
| Supporting text | 14/22 · 400 |
| Label, button | 14/22 · 500 |
| Table heading, metadata | 13/19 · 500 / 400 |
| Metric | 32/32 · 400, tabular |

Users can raise text size (Standard → Largest) from the profile menu; everything scales from the root size.

## Tokens

- Spacing: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 72 px.
- Widths: content 1320, reading 768, drawer 576, dialog 512, portal 576.
- Breakpoints: 640 · 768 · 1024 (sidebar appears) · 1280.
- Radii: 4 controls · 6 panels/callouts · 8 dialogs.
- Borders: 1 px only. Shadows only on layers above the page (menus, drawers, dialogs).
- Heights: buttons 32/40/48; inputs 40 (48 in the portal); touch targets ≥ 44 px on mobile.
- Icons: 1.5 px outline on a 16 px grid; 13/15/16/20 px.
- Table density: 16 px vertical padding, 15 px text, header rule in `line-strong`.
- States: focus = 2 px accent outline, 2 px offset; hover = `raised` fill or `accent-hover`; disabled = 45 % opacity plus an explanation nearby.

## Components

Buttons (primary, secondary, ghost, quiet, danger; sm/md/lg), text input, search, select, native date picker, checkbox, radio, segmented control, tabs, sidebar navigation, breadcrumbs, menu, table + sort header, pagination, readiness badge, requirement status, document status, verification label, readiness bar, progress, callout (info/ok/warn/bad), tooltip and help tip, empty state, skeleton and spinner, dialog, confirm (optionally requiring a reason), drawer, toast, file drop area, document preview, activity timeline, notification item.
