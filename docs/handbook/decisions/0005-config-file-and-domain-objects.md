---
title: 0005 One config file and a domain model
description: Deployment facts live in app.config.ts; the sport's nouns are classes in lib/domain
verified_at: 6c13ac9 (2026-10-08)
sources:
  - app.config.ts
  - lib/domain
  - services/scouting-store.ts
---

# 0005. One config file and a domain model

**Status:** accepted  **Date:** 2026-10-08  **Decided by:** the maintainer's direction: "if I change one file I can change the app", with proper objects and classes

## Context

Team identity, the page list, thresholds and table columns were scattered through components, and the logic about teams was a bag of
functions over loose rows. A new season meant hunting through files; a new student had no vocabulary to hold on to.

## Decision

`app.config.ts` is plain data describing the deployment ([[04-one-file-controls-the-app]]). Behaviour with a noun in it lives on
immutable classes in `lib/domain/`: `ScoutingEvent` holds `Team`s, which hold `Match`es, a `PitInterview` and cards; `Alliance` groups
teams ([[03-the-objects]]). Pages read scouting data through `ScoutingStore`, a seam with one implementation.

## Alternatives considered

- **Everything in one config, including secrets, roles and colours.** Rejected: secrets cannot be committed; roles are a reviewed
  security rule; colours are decided in Figma ([[0001-figma-first]]).
- **A generic plug-in system for backends.** Rejected as speculative: there is one backend, so only the seam is built.
- **Keep functions over rows.** Rejected: every screen had to know which helper and which threshold; the rules were not discoverable.
- **Mutable objects.** Rejected: React needs new objects to notice change.
- **Naming the root class `Event`.** Rejected: it shadows the browser's own `Event`.

## Consequences

Seasonal and cosmetic changes are one-file edits, guarded by a test. The model has to be built in the browser from plain rows
because only plain data crosses from server to client. Switching database would still need a new live feed; the seam does not hide that.

## Revisit when

A second storage backend is actually needed, or the model grows nouns with no behaviour (then they should be interfaces).
