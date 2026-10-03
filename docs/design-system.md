---
title: Design system
description: Colour tokens, tab hues, and the shared UI kit
verified_at: 27726e0 (2026-10-02)
sources:
  - app/globals.css
  - components/ui/kit.tsx
  - lib/ui/tabs.ts
  - components/layout/nav-links.tsx
  - components/layout/app-shell.tsx
---

# Design system

## Tokens, not values

All colours come from CSS variables in `app/globals.css`, exposed to Tailwind as `bg-surface`, `text-muted`,
`border-line` and so on. Do not hard-code hex values in components. Light and dark themes redefine the same names.

| Group | Tokens | Meaning |
|---|---|---|
| Surfaces | `bg`, `surface`, `surface-2`, `sidebar`, `raised` | Page, panels, table heads, sidebar |
| Text and lines | `ink`, `ink-2`, `muted`, `line`, `line-strong` | |
| Brand accent | `accent` (green), `accent-muted`, `accent-text`, `accent-foreground` | Primary actions, rank highlights, focus |
| Match phases | `auto`, `teleop`, `endgame` (+ `-soft`) | Always the same colour for the same phase, everywhere |
| Alliances | `alliance-red`, `alliance-blue` | Always with a word or label, never colour alone |
| Status | `good`, `warn`, `bad` (+ `-soft`) | Health and outcomes |

## Tab hues

Each navigation tab has a pastel hue (`--tab-<name>`, `--tab-<name>-bg`). It appears **only** on the active
sidebar item and on the icon tile of that page's header, never in data. Set it with `tabVars(tab)` from
`lib/ui/tabs.ts`, or pass `tab` to `PageHeader`. Adding a tab means: a `TabName`, two CSS variables, an entry in `navigation`
(`components/layout/nav-links.tsx`).

## The kit (`components/ui/kit.tsx`)

Server-safe (no hooks): `PageHeader`, panels and fields, `labelClass` / `selectClass` / `tableClass` / `theadClass` /
`rowClass`, status pills, stat tiles, `EmptyState`, `AccessDenied`, date formatting. Reuse these before writing new
table or panel markup.

## Rules

- Icons come from `lucide-react`; give decorative ones `aria-hidden`.
- Colour never carries meaning alone: pair it with text or an icon.
- Every data screen has an empty state that says what to do next.
- Numbers use the mono font; headings use the display font.
