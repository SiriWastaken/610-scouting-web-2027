---
title: 0009 Accounts live apart from scouting data
description: Accounts, sessions and the audit log are in their own collection, never replicated to tablets
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs/authentication.md
  - lib/auth/config.ts
  - lib/auth/store.ts
---

# 0009. Accounts live apart from scouting data

**Status:** accepted (retrospective)  **Date:** 2026-10-08  **Decided by:** recorded from `docs/authentication.md` and the configuration check

## Context

Scouting tablets replicate the scouting collection from Sync Gateway to their own storage. Accounts hold email addresses and hashed session
identifiers.

## Decision

Accounts, sessions and the audit log are kept in a separate Sync Gateway database or collection. The configuration check refuses to
enable sign-in if the account store points at the same place as the scouting data. Tablet users must not be given access to it.

## Alternatives considered

- **Same collection as scouting data, distinguished by document id.** One fewer thing to set up, but every tablet would carry everyone's
  email addresses.
- **A different database technology.** More to operate for one small dataset.

## Consequences

One more bucket and credentials to set up per environment ([[authentication]]). Privacy by construction: replication cannot leak what is
not in the replicated collection.

## Revisit when

The account store moves to something other than Sync Gateway.
