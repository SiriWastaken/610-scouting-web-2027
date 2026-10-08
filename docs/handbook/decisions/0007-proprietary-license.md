---
title: 0007 Proprietary license
description: All rights reserved; reading for learning allowed; team members may use it for the team
verified_at: 6c13ac9 (2026-10-08)
sources:
  - LICENSE
  - docs/handbook/10-ownership-and-license.md
---

# 0007. Proprietary license

**Status:** accepted, **needs legal review**  **Date:** 2026-10-08  **Decided by:** the maintainer's direction: "no copy, education only, intellectual property of Team 610"

## Context

The code encodes the team's strategy tooling and design. The team wants it kept as the team's work.

## Decision

A custom all-rights-reserved license (`LICENSE`): members may use and change it for the team; anyone with lawful access may read it for
their own education; copying, forking, modifying, redistributing, hosting for others and training AI models on it are forbidden without
written permission; contributions are assigned to the team; third-party packages keep their own licenses; the team is not affiliated with
FIRST. `package.json` points at the file.

## Alternatives considered

- **An open-source license.** Contradicts the intent.
- **No license.** By default all rights are reserved, but without a written statement people assume otherwise and contributors have no
  assignment.
- **A standard source-available license (for example one that forbids commercial use).** Closer to a standard, but none expresses
  "learning only, members may use" exactly.

## Consequences

The text was written by an AI assistant and has not been reviewed by a lawyer. It cannot override GitHub's terms for a public repository,
which let anyone view and fork it. The effective protection is a **private repository**. Open items are listed in
[[10-ownership-and-license]].

## Revisit when

A lawyer or sponsor reviews it, or the team decides to share the code.
