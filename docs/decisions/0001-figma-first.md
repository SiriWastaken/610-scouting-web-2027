---
title: 0001 Figma first
description: Visual changes are designed in Figma and approved before anyone codes them
verified_at: 6c13ac9 (2026-10-08)
sources:
  - AGENTS.md
  - docs/14-design-system.md
---

# 0001. Figma first

**Status:** accepted  **Date:** 2026-10-03  **Decided by:** the maintainer

## Context

The interface was redesigned (new tokens, icon navigation, consistent data screens). Design and code drifted whenever someone
adjusted a screen directly in code: the "real" design was whatever the code happened to look like.

## Decision

A change to how the interface looks starts in the Figma file. The change is shown to the maintainer and approved before any code
under `app/`, `components/` or the styling in `app/globals.css` is edited. After approval the code is made to match the design as
written. If the code's look or behaviour later changes with approval, the Figma file is updated in the same piece of work. The
maintainer also edits the file, so it is read before it is changed and only what the task needs is touched.

## Alternatives considered

- **Design in code, document later.** Fast, but the drawn design and the real one diverge within weeks, and the next student cannot
  tell which is right.
- **Design in Figma, code freely.** The design becomes a suggestion.

## Consequences

Visual work is slower at the start and faster to review. Refactors that cannot change appearance do not need Figma, which is why
[[0008-thirty-line-functions]] could be carried out without it. AI assistants are bound by the same rule (`AGENTS.md`).

## Revisit when

The design file is no longer maintained, or the team stops using Figma.
