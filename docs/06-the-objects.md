---
title: 06 - THE OBJECTS
description: The ScoutingEvent, Team, Match, PitInterview and Alliance classes, why they exist, and the rules they follow
verified_at: 6c13ac9 (2026-10-08)
sources:
  - lib/domain/scouting-event.ts
  - lib/domain/team.ts
  - lib/domain/match.ts
  - lib/domain/pit-interview.ts
  - lib/domain/alliance.ts
  - lib/data/team-stats.ts
  - tests/unit/domain/domain-model.test.ts
---

# 06 - THE OBJECTS

**Previous:** [[05-data-model]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[07-one-file-controls-the-app]]

## Why the code has a vocabulary

Ask a student on the team about the app and they will say things like "team 11270's last match", "our alliance", "the field
for auto points". Those are the nouns of the sport. For a long time the code used a different vocabulary: loose rows of
numbers and a bag of helper functions that each took a row and a statistic name and returned an answer. It worked, but every
screen that needed "does this team have enough data?" had to know which helper to call and which threshold to pass.

The domain model puts the nouns back. The code now has a `ScoutingEvent`, which has `Team`s, which have `Match`es. A screen
that wants to know whether a team's sample is too small asks the team: `team.isLowSample()`. The rule, and the threshold it
reads from configuration, live in one place, with the tests next to it.

```
ScoutingEvent                          one competition's scouted teams
 └─ Team            (many)             one robot team: averages, plus detail once loaded
     ├─ Match       (many)             one scouted appearance in one match
     ├─ PitInterview (0 or 1)          what the team told a scout in the pits
     └─ CardReport  (many)             a yellow or red card

Alliance                               up to three Teams from the same event, considered together
```

All of it is in `lib/domain/`. The classes have no React in them and no network: they are plain TypeScript that runs in the
browser, on the server and in the Node tests.

## The classes, one at a time

### ScoutingEvent: the root

A `ScoutingEvent` is built from the team rows the server sends: `ScoutingEvent.fromAggregates(rows)`. It keeps the teams in
the order given (the server sends them ranked) and can find one by number (`event.team(254)`). It also answers the
questions that only make sense about *all* the teams together:

- `fieldValues("autoPpg")`: every team's value for a statistic, teams with no data skipped. This is "the field" an outlier is
  judged against.
- `isOutlier(team, "autoPpg")`: does this team's value stand out from the field?
- `alliance("red", [2056, 1114, 4946])`: build an `Alliance` from team numbers.
- `observedMatches`, `completeTeams`, `coveragePercent`: the numbers on the Coverage page.

It is named `ScoutingEvent` and not `Event` because `Event` is already a name the browser owns (the thing click handlers
receive), and shadowing it would confuse readers and tools alike. As learned by experience - SG

### Team: the heart of it

A `Team` wraps one team's aggregate row (`team.aggregate`) and, once loaded, its matches, pit interview and cards. Its main
job is **reading statistics correctly**. The row stores a value that was never scouted as `0`, which looks exactly like a
team that really scored zero. `team.statValue("autoPpg")` is the safe way in: it returns `null` when the team has no matches,
or the underlying field is absent, blank, or not a number. Everything that compares or sums goes through it.

The rule has a name in this codebase: **missing is not zero**. A strategy tool that quietly treated "unknown" as 0 would tell
you a team with no auto data is the worst in the field when we simply do not know. So the Strategy page shows a dash, nobody
"wins" a comparison against a blank, and an alliance's score counts a robot with no data as contributing 0 *and says so*
("Low confidence: 3: no data").

Other questions a team answers: `totalPoints()` (auto + teleop + endgame, and only if all three exist), `isLowSample()`,
`hasCompleteRecord()`, `compareTo(other, stat)` (who leads and by how much), `bestClimb()` (from its loaded matches), and
`displayName(nickname)`.

### Match: a scouted appearance

A `Match` wraps the sanitized match document, the one in which every value has been checked to be of the expected type so
that a single malformed submission cannot crash a page. It has the same fields as that document (`start`, `auto`, `teleop`),
and adds the questions the screens kept asking: `climbLevel` (the highest rung hung from, or "-"), `attemptedClimb` (misses
count: trying is not the same as succeeding), `allianceColor`, `number`, `notes`.

### PitInterview: what the team said

A `PitInterview` wraps the pit document. Its job is the awkward bit of turning a stored robot photo (which may be a URL, or
base64 inside a blob, with or without a `data:` prefix) into something an image tag can show: `photoUri()`. It also knows
whether the team answered the older strategy questions the current form no longer asks (`hasLegacyAnswers()`).

### Alliance: what-if

An `Alliance` is a set of teams a strategist is thinking about. `score` is the plain sum of each robot's total points per
game; `compareTo(other)` says which side leads and by how much (nobody leads against an empty alliance); and
`confidenceReasons(totals)` lists why the score deserves caution: a robot with no data, a low sample, or an outlier total.

## Three rules the classes follow

**1. Immutable.** Nothing is changed after it is built. `team.withDetail({ matches })` returns a *new* `Team` with the matches
added and leaves the original untouched. This is not fussiness: React decides whether to redraw by asking whether a value is
the same object, and an object quietly changed in place would never be redrawn. The domain tests check it explicitly.

**2. Plain data crosses the boundary; objects stay inside it.** Next.js can send only plain data from the server to a browser,
so the server sends `TeamAggregate` rows and the browser builds the objects with `useScoutingEvent(initialTeams)` (in
`lib/realtime/hooks.ts`), rebuilding them whenever the live feed changes a row. If you find yourself wanting to pass a `Team`
from a server component to a client component, pass the `TeamAggregate` and construct the `Team` on the other side.

**3. Thin arithmetic, fat meaning.** Pure number crunching (medians, the outlier test, comparing two numbers, formatting a
value for display) stays in `lib/data/team-stats.ts` as small functions, because it has no nouns in it. The objects own
everything that has a *meaning* in the sport: what counts as a scouted value, what a complete record is, what a climb is.

## Adding to the model

- **A new question about a team** (say, "does it play defence?"): add a method to `Team` (or `Match` if it is about one match),
  with a test in `tests/unit/domain/domain-model.test.ts` whose expected value is worked out by hand in a comment.
- **A new scouted statistic**: map the raw field in `normalizeAggregateDocument`, add it to `TeamAggregate`, add its raw field
  names to `RAW_FIELDS` in `lib/domain/team.ts` so `statValue` handles missing data, and only if it is safe for everyone to
  see, to the allow-list in `lib/realtime/protocol.ts` ([[03-a-match-travels]], hop 3).
- **A new noun** (a scouting `Pick`, an `Event` schedule): it gets its own file in `lib/domain/`, an owner (which class holds
  it), and a section in this chapter. Resist adding a class for something with no behaviour: a plain interface is fine for
  plain data. `CardReport` is still one for that reason.

## What the model deliberately is not

It is not a database layer: it never fetches. Loading is the job of hooks like `useTeamDocuments`, which fetch a team's
documents and hand the results to `team.withDetail(...)`. And it is not a second source of truth: the aggregate row is the
truth for averages; a `Team` is the row plus the questions you can ask of it.

## Where to go next

How the single configuration file decides which of these rules are strict or loose: [[07-one-file-controls-the-app]]. The
exact shapes: [[05-data-model]]. The class files themselves are short and commented; read `lib/domain/team.ts` first.
