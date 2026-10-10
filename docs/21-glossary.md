---
title: 21 - GLOSSARY
description: Every term used in the code and docs, in plain words
verified_at: 6c13ac9 (2026-10-08)
sources:
  - lib/domain
  - lib/auth/roles.ts
  - lib/realtime/protocol.ts
  - types/scouting.ts
---

# 21 - GLOSSARY

**Previous:** [[20-ownership-and-license]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[22-decisions]]

Alphabetical. A term in *italics* inside a definition has its own entry.

**Aggregate.** A document `aggregate_<team>` holding one team's averages across all its scouted matches. Computed upstream of the
dashboard, not entered by hand. Becomes a *TeamAggregate* row.

**Alliance.** In the sport: three robots playing together against three others. In the code (`Alliance`): up to three *Team*s a
strategist is considering together; its *score* is the sum of their points per game.

**Allow-list (privacy).** The list of fields, per document type, that may leave the server. Anything not named is dropped. Lives in
`projectDashboardDocument`. See [[03-a-match-travels]].

**App config.** `app.config.ts`: the one file describing this deployment (team, pages, columns, thresholds, backend). See
[[07-one-file-controls-the-app]].

**Audit log.** The append-only record of security-relevant events, readable by Mentors.

**Auto / autonomous.** The first phase of a match, in which robots act without drivers. `autoPpg` is points per game in this phase.

**Bridge.** The server-side relay for one browser's live connection (`BridgeConnection`). See [[11-staying-live]].

**Bench (test bench).** The set of checks (`npm run validate`) that decide whether a change is finished. See [[17-how-we-build]].

**Card report.** A record of a yellow or red card shown to a team in a match, with the rule and notes.

**Climb level.** The highest rung (L1 to L3) a robot hung from in a match, or "-". Attempting and failing is recorded separately.

**Contract tests.** Tests that check our fake Sync Gateway behaves like the real one.

**Coverage (scouting).** How complete our data is for each team: has matches, a rank, and a fuel accuracy. Not the same as *code
coverage*.

**Coverage (code).** The share of a source file exercised by tests; each file has a minimum in the manifest.

**Cursor (`last_seq`).** A bookmark in the database's history. A page's snapshot carries one; the live feed starts from it.

**Decision record.** A short, never-edited note of why a choice was made. See [[22-decisions]].

**Deny / allow access.** What a manager does to an account. Denying sets its status to `disabled` and ends all its sessions.

**Document.** One JSON record in Couchbase, such as `scouting_254_31`.

**Domain model.** The classes in `lib/domain/`: *ScoutingEvent*, *Team*, *Match*, *PitInterview*, *Alliance*. See [[06-the-objects]].

**E2E.** End-to-end tests: the production app in a real browser.

**Endgame.** The final phase of a match, where climbing happens. `endgamePpg` is points per game in this phase.

**Field.** Two meanings. The playing surface (the auto path is drawn over a picture of it). And, in statistics, "the field" of a
statistic: every team's value for it, which an *outlier* is judged against.

**Figma-first.** The rule that a visual change is designed in Figma and approved before it is coded. [[0001-figma-first]].

**Floor.** The minimum a test file must run, or a source file must be covered, for the bench to pass. Never lowered to get green.

**Fuel.** The game piece of the 2026 game (REBUILT). Scored, passed, plowed and fed in the match statistics.

**Guard.** The first thing an API route does: checks the session, the permission and, for writes, the origin.

**Immutable.** Not changed after creation. The domain objects return new objects instead of changing themselves.

**Low sample.** A team with fewer scouted matches than `analysis.lowSampleThreshold` (3 by default): its averages are easily skewed.

**Match.** In the sport: one game. In the code (`Match`): one team's scouted appearance in one game.

**Member / Scout / Scout lead / Mentor / Owner.** The five roles, lowest to highest. See [[09-who-is-allowed-in]].

**Missing is not zero.** The rule that an unscouted value is `null`, never 0, in every comparison and sum. See [[06-the-objects]].

**Outlier.** A value unusually far from the rest of the field: more than 2.5 standard deviations from the mean, or over three times
the median (when there are at least five teams to judge against).

**Permission.** A named thing a role may do (`dashboard:read`, `users:manage`…). The only place they are decided is `lib/auth/roles.ts`.

**PKCE / state / nonce.** Three one-time values in the Google sign-in flow that stop forged or replayed sign-ins.

**Pit interview.** The answers a scout collects by asking a team in the pits about its robot. A `PitInterview`.

**Principal.** The part of an account that authorization needs: id, role and status. Always loaded on the server.

**Realtime.** The live connection that keeps pages current. See [[11-staying-live]].

**Resync.** The server telling a browser it cannot resume from its cursor, so the page must reload its snapshot.

**Revision (`rev`).** A document's version marker. The newest revision wins; Couchbase's own rule decides which is newer.

**Sanitizer.** Code that keeps only values of the expected type from an untrusted document, so one bad record cannot crash a page.

**Scouting store.** The interface the pages read scouting data through (`services/scouting-store.ts`).

**ScoutingEvent.** The root object: all the scouted teams of one competition.

**Seam.** A place where one part of the system can be swapped for another without changing the rest. The scouting store is one.

**Session.** A signed-in browser's proof of sign-in. The server keeps only a hash of its secret.

**Snapshot.** The server's cached, single read of all documents, with the cursor at that moment. Reused for about twenty seconds.

**Sync Gateway.** The service in front of Couchbase that lets many devices synchronise. Tablets write to it directly; the dashboard
reads from it.

**Teleop.** The driver-controlled phase of a match. `teleopPpg` is points per game in this phase.

**Team.** In the sport: a robot team. In the code (`Team`): one team's averages plus, once loaded, its matches, pit interview and cards.

**Tablet.** The device a scout records matches on. Its app is outside this repository.

**TeamAggregate.** The plain-data row for one team that the server sends to the browser. A *Team* wraps one.

**Total points.** Auto + teleop + endgame points per game; unknown unless all three exist.

**Verified at.** The commit and date a documentation page was last checked against the code.

**WebSocket.** The two-way connection the browser holds open to receive live changes.
