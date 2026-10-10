---
title: 14 - DESIGN SYSTEM
description: The look, colour tokens, and the shared UI kit
verified_at: b611a7f (2026-10-08)
sources:
  - app/globals.css
  - components/ui/kit.tsx
  - components/layout/nav-links.tsx
  - components/layout/app-shell.tsx
---

# 14 - DESIGN SYSTEM

**Previous:** [[13-pages]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[15-event-day]]

This part of the docs was written entirely by a human. 

The design lives in Figma first (see [`AGENTS.md`](../AGENTS.md#design-workflow-figma-first)): change the Figma file,
get it approved by your exec (so me, or, if this docs plan outlives me and you're still using it after I graduate, then the current assistant/head of Strat-Scouting), then make the code match. The Figma `Color` variables mirror the tokens below; each one's description
holds its CSS variable name.

**The look:** neutral surfaces, 1px hairline borders, no shadows, Inter for everything, sentence-case labels (never
uppercase), and one green accent for actions, selection and links.

## Tokens, not values

All colours come from CSS variables in `app/globals.css`, exposed to Tailwind as `bg-surface`, `text-muted`,
`border-line` and so on. Do not hard-code hex values in components. Light and dark themes redefine the same names.

| Group | Tokens | Meaning |
|---|---|---|
| Surfaces | `bg`, `surface`, `surface-2`, `sidebar`, `raised` | Page, panels, fills inside a panel, sidebar |
| Text and lines | `ink`, `ink-2`, `muted`, `line`, `line-strong` | |
| Accent | `accent` (green), `accent-muted`, `accent-text`, `accent-foreground` | Primary actions, links, selected items, focus |
| Match phases | `auto`, `teleop`, `endgame` (+ `-soft`) | Always the same colour for the same phase, everywhere |
| Alliances | `alliance-red`, `alliance-blue` | Always with a word or label, never colour alone |
| Status | `good`, `warn`, `bad` (+ `-soft`) | Health and outcomes |

Radii are `rounded-sm` 6, `rounded-md` 8 (controls), `rounded-lg` 12 (panels), `rounded-xl` 16 (sign-in card).

## Navigation

One accent for every page: the active sidebar item gets a soft green pill (`bg-accent-muted`) and a green icon; the phone
tab strip adds a 2px bar under it. There are no per-page colours. Adding a page means an entry in `navigation`
(`components/layout/nav-links.tsx`).

## The kit (`components/ui/kit.tsx`)

Server-safe (no hooks): `PageHeader` (title, description, optional right-hand slot; no icon tile), panels and fields,
`labelClass` / `selectClass` / `tableClass` / `theadClass` / `rowClass`, status pills, stat tiles, `FactGrid` (label/value cells for key facts), `EmptyState`,
`AccessDenied`, date formatting. Reuse these before writing new table or panel markup.

## Rules

- One typeface, Inter. Numbers use it too, with tabular figures (`tabular-nums`, applied to `.font-mono`, `td` and `th`).
- Labels and table headers are sentence case, 12px medium, muted. Panel titles have no icon.
- Icons come from `lucide-react`; give decorative ones `aria-hidden`.
- Colour never carries meaning alone: pair it with text or an icon.
- Every data screen has an empty state that says what to do next.
