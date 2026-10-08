---
title: 0002 Google only, open access, deny afterwards
description: Google is the only sign-in; anyone Google admits is active at once; managers can deny and allow afterwards
verified_at: 6c13ac9 (2026-10-08)
sources:
  - AGENTS.md
  - docs/authentication.md
  - lib/auth/accounts.ts
---

# 0002. Google only, open access, deny afterwards

**Status:** accepted  **Date:** 2026-10-03  **Decided by:** the maintainer (recorded in `AGENTS.md` as "Access model (decided)")

## Context

At an event, a new student who cannot get in is a student who cannot help. An earlier design had Sign in with Apple as well and a
pending-approval step before anyone could see anything.

## Decision

Sign-in is Google only. Anyone who passes the Google OAuth client is approved automatically as an active Member. Mentors, scout
leads and the Owner can deny an account afterwards from Admin → Users, which ends all its sessions, and can allow it again.

## Alternatives considered

- **An approval queue.** Safer in principle, but puts a person in the loop at the worst time, and a pending account sees nothing.
- **An allow-list of emails in the app.** Another thing to keep in sync with the team roster; Google's consent screen can already
  restrict an audience to one organisation.
- **Several providers.** More surface to secure; the team's members all have Google accounts.

## Consequences

The app trusts Google's gate, so the consent screen's audience is a security setting and must be reviewed ([[05-who-is-allowed-in]]).
Denial must be fast, reversible and audited, and it is. Apple sign-in was removed; leftover `AUTH_APPLE_*` variables are ignored.

## Revisit when

The team has members without Google accounts, or an incident shows the consent-screen gate is not enough.
