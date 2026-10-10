---
title: 15 - EVENT DAY
description: Running the dashboard at a competition: before, during, and after, and how to read the admin panel
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs/16-operations.md
  - services/health.ts
  - lib/ops/metrics.ts
  - components/admin/health.tsx
  - components/admin/realtime.tsx
---

# 15 - EVENT DAY

**Previous:** [[14-design-system]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[16-operations]]

Software gets its real test at an event, on a crowded network, with people waiting for it. This chapter is the human side of
running it. The exact checks and the troubleshooting table are in [[16-operations]]; here is how to think.

## Before you leave

- Run the full check (`npm run validate`) on the commit you will deploy, and keep its `✔ TEST BENCH PASSED` line.
- Confirm the deployment settings: the dashboard's public address (`AUTH_URL`), the Google sign-in client's redirect address for
  that same address, the Owner's email, and the Sync Gateway address and credentials. A wrong public address is the commonest
  cause of "sign-in loops" and "WebSocket refused: origin" ([[10-authentication]]).
- Sign in on the real address on a phone, not just a laptop. Open **Admin → Diagnostics** and press **Run full diagnostics**.
  Every row of the checklist should be green or an honest *idle* ("no clients yet" is not a failure).
- Decide who is the **Owner**, who are **Mentors** and who are **Scout leads**, and give those roles before the doors open
  ([[09-who-is-allowed-in]]). Giving them on the day, while someone is waiting, is how typos happen.

## When the doors open

Watch three things on **Admin → Overview**, in this order:

1. **The big banner.** Green says all checks pass. Amber or red names what needs attention. It reads "The API is not
   answering this browser" if your own connection is the problem, which is worth knowing before you debug the server.
2. **Live clients and changes delivered.** Live clients should rise as people open the dashboard. Changes delivered should
   tick up as scouts submit. If scouts are submitting and "changes delivered" is flat, the problem is between the tablets and
   Sync Gateway, not in the dashboard ([[03-a-match-travels]], hop 1).
3. **Errors (15 min).** A few are normal. A rising count deserves a look at *Recent errors*, which names the source and path.

## Reading the cards

Every health check is a measurement, not a guess. The cards say what was measured and how long ago.

- **Sync Gateway**: can we reach it, and does it answer to our credentials? Slow answers (over two seconds) show as degraded.
- **Couchbase**: what Sync Gateway reports about its database. *Online* means its bucket is connected. We cannot reach
  Couchbase Server directly, and the card never pretends to.
- **WebSockets**: open connections, and when the feed last answered. With **no clients** it says *idle*, which is honest: there
  is nothing to measure, so it does not claim to be healthy.
- **Account store** and **Authentication**: can we read accounts, and have recent sign-ins failed?

If a card is amber because of a check that fires only on demand (the persistence round trip), that is Diagnostics: it writes and
deletes one short-lived test document in the **account** store. It never touches scouting data.

## Common situations, with the thinking that solves them

**"The pages load but say Reconnecting."** The browser can reach the dashboard but the dashboard cannot reach Sync Gateway (or
Sync Gateway is refusing its credentials). Open *Sync*. The error text will say which. Nothing is lost; the page catches up from
its cursor when the line returns.

**"Everyone is reconnecting constantly."** Open *Realtime* and look at recent events. Repeated `disconnected` with code 1006 is
the network (venue Wi-Fi, a proxy that cuts idle connections). Code 1012 is a deliberate server restart. Code 4401 is a session
that ended (check the audit log for who).

**"Sign-in works for me but not for a new student."** Check the Google consent screen's audience first (is it limited to an
organisation, or in *Testing* with a list of allowed users?), then the audit log for the failure code.

**"A scout swears they submitted and I don't see it."** Is *changes delivered* moving at all? If it is, the record may be for a
different team number than they think. If it is not, their tablet is not syncing; that is a tablet and Sync Gateway question.

**"Someone should not have access any more."** **Admin → Users → their row → Deny access.** That ends all their sessions. Their
live feed closes within about a minute. Check the audit log shows it.

## After the event

If there was an incident, note the date and time range so the audit log can be searched later, and write down what surprised you in
[[23-log]] or a decision record ([[22-decisions]]) if it changed how we work. The next event's team will thank you; they will not
remember this one.

## Where to go next

How we change the software so the next event is smoother: [[17-how-we-build]]. The complete table of symptoms and likely causes
is the end of [[16-operations]].
