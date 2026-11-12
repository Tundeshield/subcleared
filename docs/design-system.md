# SubCleared design system

The live reference is `/design` (rendered with the application's own components). Tokens live in `src/styles.css` (CSS variables) and `tailwind.config.cjs`; components in `src/ui/index.tsx`.

## Principles

1. Neutrals carry the interface. Colour is for meaning, never decoration.
2. One accent (deep cyan) marks what you can act on and where you are.
3. Status is always an icon **and** words. Colour is the third signal, not the first.
4. One primary action per view, labelled verb + object ("Request documents").
5. Show the summary first; reveal detail on demand (expand rows, side panels).
6. Side panels (drawers) for contextual editing; dialogs only for short decisions and confirmations.

## Colour — "Ink, White & Deep Teal"

Soft grey carries the page, white carries the work, ink carries the words. Teal is used sparingly — primary actions, where you are, links and focus — so it always means "act here".

| Token | HEX | Use |
|---|---|---|
| `canvas` | #F4F6F5 | Page background |
| `paper` | #FFFFFF | Sidebar, top bar, forms, panels, dialogs, preview panes |
| `raised` | #EDF1EF | Muted surfaces: hover, selected rows and navigation, skeletons |
| `ink` | #171C20 | Headings, body text, navigation labels, values |
| `muted` | #556068 | Secondary copy (same hue as `faint`, darker for long reading) |
| `faint` | #667078 | Metadata, timestamps, hints, labels |
| `line` | #E2E7E5 | Borders and dividers |
| `line-strong` | #C5CECB | Input borders, section rules, table header rule |
| `accent` | #087E80 | Primary buttons, active navigation indicator, focus ring (fills only) |
| `accent-hover` | #066B6D | Primary hover |
| `accent-ink` | #066B6D | Teal text and links (#087E80 is 4.49:1 on the canvas, just under AA for text) |
| `accent-tint` | #E6F2F1 | Rare quiet emphasis |
| `success` | #1E784A | Ready, approved, in date |
| `warning` | #9B5800 | Expiring soon, needs attention |
| `danger` | #B22218 | Not ready, expired, rejected, missing; destructive buttons |
| `info` | #295999 | Awaiting review, in progress |
| tints | #E9F4ED · #FBF2E4 · #FCECEA · #EBF1FA | Callout backgrounds only |

Selected navigation: ink label on the muted surface with a 3 px teal bar — clear without a coloured block. Borders separate; shadows are reserved for things that float (menus, dialogs, toasts).

Text colours: success and danger colour the label (the two ends of the scale); warning and info colour only the icon, so screens never look like a traffic light. All text tokens pass WCAG AA on the canvas.

Previous direction: *Graphite & Deep Cyan* (accent #155E75). Directions considered before that: *Site Ivory* (previous; green accent collided with "ready", no distinct status colours) and *Stone & Signal* (orange accent read as hi-vis cliché and competed with warnings). Details on `/design`.

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
