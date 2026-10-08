---
title: 0008 Functions over thirty lines are defects
description: Every function stays within thirty lines and reads clearly to a human
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs/17-how-we-build.md
---

# 0008. Functions over thirty lines are defects

**Status:** accepted  **Date:** 2026-10-08  **Decided by:** the maintainer: "if a method is longer than 30 lines, bad; if I can't read it as a human, bad"

## Context

A team that changes every year inherits whatever it cannot read. Several functions were over a hundred lines, one a hundred and
twenty-six, and a component was two hundred and fifty; nobody dared change them.

## Decision

No function, nested or not, is longer than thirty lines, and none may be unreadable. `npm run test:size` measures every function with the
TypeScript compiler and fails the bench and CI on any over thirty lines; the codebase was brought to zero. Components split into hook plus panels, rules move to named functions or classes.

## Alternatives considered

- **A guideline, not a rule.** Guidelines erode.
- **A higher number.** Any number is arbitrary; thirty fits a screen and forces the question "what are the parts?"

## Consequences

More, smaller pieces and more total lines (the cleanup added a few hundred). Pieces are findable and testable. Naming matters more: a
vague name is the failure mode of splitting.

## Revisit when

The rule produces worse code than it prevents; then change the number by a new record, not by ignoring it.
