---
title: App configuration
description: What app.config.ts controls, what it deliberately does not, and how to make common changes
verified_at: 70d836f (2026-10-08)
sources:
  - app.config.ts
  - services/scouting-store.ts
  - components/layout/nav-links.tsx
  - tests/unit/config/app-config.test.ts
---

# App configuration

`app.config.ts` (repo root) is the one file that describes this deployment. It is plain data: no React, no icons, no
environment, so server code, client code and the Node tests all import it.

## What it controls

| Section | Controls | Used by |
|---|---|---|
| `team` | Team number, name, season, game, product name, description | Browser title, sidebar, sign-in page, "vs <team>" in Strategy |
| `navigation`, `adminNavigation` | Pages in the sidebar and tab strip: URL, label, icon name | `components/layout/nav-links.tsx` |
| `analysis` | Rating scales, low-sample and outlier rules, robots per alliance | `lib/data/team-stats.ts`, Strategy, Teams |
| `averagesColumns` | Columns of the Averages table, in order | `components/dashboard/metric-board.tsx` |
| `storage` | Which scouting backend answers, and how long a snapshot is reused | `services/scouting-store.ts`, `services/couchbase.ts` |

## What it does not control, on purpose

- **Secrets and connection settings** (`AUTH_*`, `COUCHBASE_*`) stay in environment variables. A config file is committed; secrets must not be.
- **Who may do what** stays in `lib/auth/roles.ts`. It is a security rule with tests, not a preference.
- **Scouting field names** (fuel, hang, climb) come from the tablet app's documents; see [[data-model]]. Config can choose which fields to *show*, not invent fields the tablets do not record.
- **Colours and spacing** are design tokens: [[design-system]].

## Recipes

- **New season, same team:** edit `team.season` and `team.game`; adjust `averagesColumns` and the labels in the data types for the new game.
- **Add a page:** create the route under `app/(app)/`, add it to `navigation`. If it needs a new icon, add the name to `NavIcon` and map it in `nav-links.tsx`. `tests/unit/config/app-config.test.ts` fails if a navigation entry has no page.
- **Hide or reorder an Averages column:** edit `averagesColumns`.
- **Make low-sample warnings stricter:** change `analysis.lowSampleThreshold`; the warnings and hints follow.
- **A different scouting backend:** implement `ScoutingStore` (`services/scouting-store.ts`), register it there, add its name to `ScoutingBackend` in the config, and set `storage.scouting`. The compiler requires the registration. The seam covers the three data reads the pages use. The realtime feed (`lib/realtime`) and the Admin → Sync panels are still Sync Gateway-specific, so a real second backend also needs its own feed.
