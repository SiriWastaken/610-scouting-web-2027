---
title: 23 - DOCS LOG
description: Append-only record of documentation changes
verified_at: 7c5884e (2026-10-08)
sources:
  - docs
---

# 23 - DOCS LOG

**Previous:** [[22-decisions]]  ·  **Contents:** [[00-preface]]

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

- Added the Figma-first rule to `AGENTS.md` (linked from `CLAUDE.md`) and to [[14-design-system]].
- [[10-authentication]]: Sign in with Apple removed; new accounts are `active` at once (no `pending`, no `AUTH_AUTO_APPROVE`); managers deny and allow access from Admin → Users; a denied account sees "Access turned off". Accounts saved as `pending` read as `active`.
- [[14-design-system]]: rewritten for the new look (Inter only, sentence-case labels, hairline borders, one green accent). The per-page tab colours and `lib/ui/tabs.ts` are gone.
- [[13-pages]], [[02-overview]], [[16-operations]], [[18-development]] updated to match.

## 2026-10-08: code cleanup (no behaviour change)

- Removed unused code: four helpers in `services/couchbase.ts`, three Blue Alliance fetchers, two types, and `export` on symbols used only in their own file.
- Long functions split into small ones (realtime bridge, long-poll, auth config, sign-in, sessions, callback route, admin and dashboard components). The realtime bridge and long-poll are now small classes in `lib/realtime/`.
- `useTeamDocuments` in `lib/realtime/hooks.ts` replaces the duplicated load-and-merge code in the Teams page and card reports; `FactGrid` joins the kit. Updated [[12-realtime]], [[13-pages]] and [[14-design-system]].
- **Bug fixed:** a document nested deeply enough to overflow `JSON.stringify` crashed the realtime feed; it is now dropped like an oversized one.
- The Teams page no longer logs a console warning when a team has no match documents.

## 2026-10-08: app.config.ts

- Added [[08-configuration]]: team identity, navigation, Averages columns, analysis thresholds and the scouting backend now live in `app.config.ts`. Pages read scouting data through `services/scouting-store.ts`. Updated [[04-architecture]] and [[00-preface]].
- `LivePage` replaces the access check, snapshot fetch and header repeated in the five dashboard pages; page titles and descriptions now come from `navigation` in `app.config.ts`. `MetricBoard` no longer takes a `header`.
- `tba/blueAlliance.ts` moved to `services/blue-alliance.ts`; `NativeSelect` moved into `selectors.tsx`, its only user.
- `lib/data/match-data.ts` stays separate from `team-documents.ts`: it is the input sanitizer, with its own tests and coverage floor.

## 2026-10-08: the handbook, the domain model, the license

- Added `docs/handbook/`: ten chapters ([[00-preface]]), the [[21-glossary]], and nine decision records ([[22-decisions]]). Rewrote the rules in `docs/CLAUDE.md` to define four kinds of page, so short reference pages and long narrative chapters can live side by side.
- Documented the object model ([[06-the-objects]]) and updated [[05-data-model]], [[04-architecture]], [[13-pages]] and [[18-development]] for `lib/domain`, `LivePage` and the new checks (`test:docs`, `test:size`).
- Every source file now has a header comment and every export a doc comment, enforced by `npm run test:docs`. Function length is enforced by `npm run test:size`.
- Added `LICENSE` (proprietary, all rights reserved) and [[20-ownership-and-license]]. The license text needs review by the team's sponsor or a lawyer before it is relied on.
- Correction: the earlier 2026-10-08 entry said `statValue` lives in `lib/data/team-stats.ts`; it is now `Team.statValue` in `lib/domain/team.ts`.

## 2026-10-08: numbered pages

- Every page is now `NN-name.md`, numbered from `00 - PREFACE` to `23 - DOCS LOG` in reading order, with a Previous / Contents / Next line. The old `index` and `handbook` pages are merged into [[00-preface]]; `docs/handbook/` is gone and the decision records moved to `docs/decisions/`. Earlier entries in this log use the old page names; their links now point at the renumbered pages.
- `npm run test:docs` now also checks the numbering, titles and the contents table.
- Correction: the previous entry says the handbook is in `docs/handbook/`; it is now the numbered chapters in `docs/`.
