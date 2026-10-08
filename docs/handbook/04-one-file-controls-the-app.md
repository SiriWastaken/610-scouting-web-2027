---
title: One file controls the app
description: What app.config.ts decides, why some things are deliberately not in it, and how to make common changes
verified_at: 6c13ac9 (2026-10-08)
sources:
  - app.config.ts
  - services/scouting-store.ts
  - components/layout/nav-links.tsx
  - components/dashboard/live-page.tsx
  - tests/unit/config/app-config.test.ts
---

# Chapter 4. One file controls the app

## The idea

Next season will have a different game, a different set of statistics, possibly different pages. Next year's students will not
be the ones who wrote this. The question this chapter answers is: *what is the smallest place a newcomer has to look to
change what the app is about?*

The answer is `app.config.ts`, at the root of the repository. It is plain data, about a hundred lines, and it describes
this deployment:

| Section | What it decides |
|---|---|
| `team` | The team number, name, season, game, product name and description. These appear in the browser tab, the sidebar, the sign-in page and the "vs 610" shortcut on the Strategy page |
| `navigation` | The main pages, in order: URL, label, icon name and the one-line description under each page's title |
| `adminNavigation` | The Admin entry, shown only to accounts that can open it |
| `analysis` | The rating scales; how few matches count as a "low sample"; how far from the field counts as an "outlier"; how many robots make an alliance |
| `averagesColumns` | The columns of the Averages table, left to right, with their headings and units |
| `storage` | Which scouting backend answers, and how long a snapshot is reused |

Change a number in this file and the app changes everywhere that number was used, because there is no other copy. Rename a page
here and the sidebar, the page title and its subtitle all follow. This is why `LivePage`
(`components/dashboard/live-page.tsx`) takes only an `href`: it looks up the title and description in the config instead of
having them typed into each page.

## Why it is plain data

The file imports nothing from React and nothing from Next.js. Icons are written as names (`"bot"`, `"target"`), and a small map in
`components/layout/nav-links.tsx` turns a name into a drawing. That looks like a detour, and it is deliberate: the same file is
read by server code, by browser code and by the Node test runner. A config that imported an icon library could not be loaded by
a unit test without dragging a user interface along with it. Keeping it dumb also means anyone can edit it without understanding
React.

A test (`tests/unit/config/app-config.test.ts`) guards it: every navigation entry must open a page that exists, no two entries
may share a URL, every page has a description, every column is unique and labelled, and the thresholds are values that can
actually be met. A typo in the config fails the bench rather than the event.

## What is deliberately *not* in it

A tempting simplification is to put everything in one file. We did not, and the reasons are the useful part of this chapter.

**Secrets and connection settings stay in environment variables.** The file is committed to the repository. A password in it
would be published to everyone who can read the repository. Environment variables are set per machine and never committed
(`.env.example` shows the names with placeholders; [[authentication]] explains each).

**Who may do what stays in `lib/auth/roles.ts`.** Roles and permissions are a security rule, not a preference. They have their
own tests (a full matrix of every role against every action), and they must be read by the server on every request. Moving them
into a general-purpose config would make "change the app's look" and "change who can delete accounts" the same kind of edit, and
the second deserves a heavier review.

**Scouting field names stay in the data types.** "Fuel", "hang", "L3" come from the tablet app's documents. The config can say
which fields to *show* (`averagesColumns`), but it cannot invent a field the tablets do not record, and the code that reads
documents has to know their shape to reject malformed ones. When the game changes, the tablet app changes first, then the
sanitizers in `lib/data/`, then this file.

**Colours and spacing stay as design tokens.** They are decided in Figma and mirrored as CSS variables
([[design-system]]); the rule that design changes start in Figma ([[08-how-we-build]]) would be bypassed by a config switch.

## The storage seam

`storage.scouting` names where the scouting data comes from. Today the only answer is `"syncGateway"`. The pages do not import
the Sync Gateway code; they import `scoutingStore` from `services/scouting-store.ts`, which is a small interface
(`fetchTeamAggregatesSnapshot`, `queryDashboardDocuments`, `scoutActivity`) with a registry mapping each backend name to an
implementation. TypeScript requires every name allowed in the config to have an entry in the registry, so adding a backend is a
compile-checked three-step: write the implementation, register it, name it in the config.

Be clear-eyed about what that buys. There is one backend. The seam is real for the three reads the pages use, and it makes the
dependency explicit and testable. But the live feed (`lib/realtime`) and the Admin → Sync panels know Sync Gateway
specifically, so switching to a different database would also mean providing a different feed. We built the seam because the
cost was low and it keeps the pages honest; we did not build a second backend, because nobody needs one, and an unused
abstraction is a liability.

## Recipes

- **New season, same team.** Set `team.season` and `team.game`. Update `averagesColumns` to the statistics of the new game
  (after the aggregate documents carry them), and the labels in the data types.
- **Add a page.** Create `app/(app)/<name>/page.tsx` (copy `coverage/page.tsx`, which is only a few lines because `LivePage` does the
  rest), then add it to `navigation` with a label, icon name and description. If the icon is new, add the name to `NavIcon` and
  to the map in `nav-links.tsx`.
- **Make low-sample warnings stricter.** Raise `analysis.lowSampleThreshold`. The chip text, the alliance confidence notes and
  the tests that assert the default all follow from that one number.
- **Reorder or hide an Averages column.** Edit `averagesColumns`.

## Where to go next

The people who are allowed to see all this: [[05-who-is-allowed-in]]. The reference version of this chapter is
[[configuration]].
