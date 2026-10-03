---
title: Data model
description: Couchbase document types and how they become the rows the UI renders
verified_at: 27726e0 (2026-10-02)
sources:
  - lib/data/aggregates.ts
  - lib/data/match-data.ts
  - lib/data/team-documents.ts
  - lib/data/team-stats.ts
  - lib/realtime/protocol.ts
  - types/scouting.ts
---

# Data model

## Documents

| Document id | Type | Holds |
|---|---|---|
| `aggregate_<team>` | `aggregate_data` | Per-team averages, computed upstream; the Teams, Averages, Strategy, Box Plot and Coverage rows |
| `scouting_<team>_<match>` | `scouting_data` (or none) | One scouted match: start, auto (markers, paths), teleop |
| `pit_<team>` | `pit` | The pit interview; also supplies the team's name |
| `report_card_<team>_<id>` | `report_card` | One card (yellow/red) with rule and notes |

Anything else is ignored by the dashboard and never relayed ([[realtime]]).

## From document to row

- **Aggregates** → `normalizeAggregateDocument` (`lib/data/aggregates.ts`) → `TeamAggregate` (`types/scouting.ts`). Rejects documents with no statistics, a non-positive team, or a body whose team disagrees with its id. Statistic names are mapped here (`autoPPG` → `autoPpg`, `standing` → `rank`, and so on).
- **Matches** → `sanitizeMatchData` (`lib/data/match-data.ts`) keeps only values of the expected type, so one malformed submission cannot crash a page. Its result type, `SanitizedMatch`, is the one match shape the UI uses (exported as `MatchData` from `lib/data/team-documents.ts`).
- **Pit and cards** → `PitData` and `CardReport` (`lib/data/team-documents.ts`). Only strings and finite numbers are rendered.
- **Merging live updates** → `mergeAggregates` applies feed changes on top of the server snapshot, newest revision wins.

## Missing is not zero

`TeamAggregate` stores unscouted values as 0. `statValue` in `lib/data/team-stats.ts` returns `null`
for those, and every comparison page shows "—" instead of a fake 0. Use it for any new statistic.

## Privacy

The realtime feed only forwards an allow-list of fields per document type
(`projectDashboardDocument` in `lib/realtime/protocol.ts`). Scout names, robot photos and free-text
notes are excluded from the feed. The REST route is for signed-in users with `dashboard:read`.
Do not add private fields to the allow-list.
