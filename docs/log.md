---
title: Docs log
description: Append-only record of documentation changes
verified_at: 70d836f (2026-10-08)
sources:
  - docs
---

# Docs log

Add a new entry; do not edit old ones. If a fact changes, write a correcting entry.

## 2026-10-02: wiki created, UI redesign cleanup

- Added `index`, `overview`, `architecture`, `data-model`, `realtime`, `pages`, `design-system`, `development` and this log. `authentication` and `operations` already existed; they now carry frontmatter and sit in the index.
- Code cleanup done alongside:
  - `components/dashboard/teams-view.tsx` (1,286 lines) split into `components/dashboard/teams/*` plus `lib/data/team-documents.ts`; the duplicated match types were replaced by `SanitizedMatch`.
  - Removed unused `components/dataTable.tsx` and `components/charts/box-plot-chart.tsx`, and the default create-next-app SVGs in `public/`.
  - The Teams page now fetches nicknames through `tba/blueAlliance.ts` instead of its own inline `fetch`; the client also survives network errors.
  - **Bug fixed:** the auto-path viewer requested `/field.png`, but the image lived in `app/assets/` and was never served. It now lives in `public/field.png`.
  - Replaced "from <old-file>.tsx" leftovers in section comments with plain labels.

## 2026-10-03: Figma-first workflow, Google-only open access, cleaner look

- Added the Figma-first rule to `AGENTS.md` (linked from `CLAUDE.md`) and to [[design-system]].
- [[authentication]]: Sign in with Apple removed; new accounts are `active` at once (no `pending`, no `AUTH_AUTO_APPROVE`); managers deny and allow access from Admin → Users; a denied account sees "Access turned off". Accounts saved as `pending` read as `active`.
- [[design-system]]: rewritten for the new look (Inter only, sentence-case labels, hairline borders, one green accent). The per-page tab colours and `lib/ui/tabs.ts` are gone.
- [[pages]], [[overview]], [[operations]], [[development]] updated to match.

## 2026-10-08: code cleanup (no behaviour change)

- Removed unused code: four helpers in `services/couchbase.ts`, three Blue Alliance fetchers, two types, and `export` on symbols used only in their own file.
- Long functions split into small ones (realtime bridge, long-poll, auth config, sign-in, sessions, callback route, admin and dashboard components). The realtime bridge and long-poll are now small classes in `lib/realtime/`.
- `useTeamDocuments` in `lib/realtime/hooks.ts` replaces the duplicated load-and-merge code in the Teams page and card reports; `FactGrid` joins the kit. Updated [[realtime]], [[pages]] and [[design-system]].
- **Bug fixed:** a document nested deeply enough to overflow `JSON.stringify` crashed the realtime feed; it is now dropped like an oversized one.
- The Teams page no longer logs a console warning when a team has no match documents.

## 2026-10-08: app.config.ts

- Added [[configuration]]: team identity, navigation, Averages columns, analysis thresholds and the scouting backend now live in `app.config.ts`. Pages read scouting data through `services/scouting-store.ts`. Updated [[architecture]] and [[index]].
