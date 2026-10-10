---
title: Docs rules
description: The kinds of page in docs/, how to write each, and what to update when code changes
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs
  - docs/19-how-we-document.md
---

# Docs rules

`docs/` is a numbered book that is also a wiki. Read [[00-preface]] first; keep everything accurate when code changes. The full
reasoning behind these rules is in [[19-how-we-document]]; this page is the short version for whoever (or whatever)
is editing.

## Four kinds of page

| Kind | Where | Job | Length |
|---|---|---|---|
| **Reference** | `docs/NN-*.md` (the look-up ones) | Answer one question about how the system is now. Look-up, not reading. | Short. Split a page that passes about 3,000 characters, unless it is a runbook or setup guide that reads top to bottom (`authentication`, `operations`) |
| **Chapter** | `docs/NN-*.md` (the narrative ones) | Tell how and why we work the way we do, in prose, so a newcomer can read the book front to back. | As long as it needs. End with "Where to go next" |
| **Decision record** | `docs/decisions/NNNN-*.md` | Preserve why a choice was made and what it cost. Never edited once accepted; superseded by a new record. | One screen |
| **Log** | [[23-log]] | Append-only history of documentation changes. | One entry per change |

## Numbering

Every page in `docs/` is `NN-name.md`, numbered from `00-preface` in reading order, with the title and heading `NN - NAME` and
a Previous / Contents / Next line under the heading. Only this file is unnumbered, because tools look for it by name. New pages
take the next free number; to insert one, rename the following files with `git mv` and fix their titles. `npm run test:docs` checks
the numbers, titles and links. The contents table in [[00-preface]] must list every page. Decision records live in `docs/decisions/`
with their own `NNNN` numbers.

## Page format

Every page starts with frontmatter: `title`, `description`, `verified_at` (the commit and date the page was last checked
against the code), `sources` (repo-root paths the claims come from). Link pages with `[[page-name]]` (the file name without
`.md`); link code with repo-root paths in backticks.

## When you change code

| You changed | Update |
|---|---|
| A route, page or component's job | [[13-pages]] |
| Document handling, `TeamAggregate`, the privacy allow-list | [[05-data-model]], and [[12-realtime]] if the feed changed |
| `lib/domain/*` (Event, Team, Match, Alliance) | [[05-data-model]] and [[06-the-objects]] |
| `lib/realtime/*` | [[12-realtime]] |
| Colours, `components/ui/kit.tsx` | [[14-design-system]] |
| Roles, sessions, sign-in, env vars | [[10-authentication]] |
| Admin panel, health checks, metrics | [[16-operations]] |
| `app.config.ts`, `services/scouting-store.ts` | [[08-configuration]] |
| Commands, conventions, folder layout | [[18-development]] or [[04-architecture]] |
| A working agreement (how we build, review, ship) | [[17-how-we-build]] |
| A choice with real alternatives | a new decision record in `docs/decisions/` |
| The license or who owns what | [[20-ownership-and-license]] and `LICENSE` |

Bump `verified_at` on every page you re-check, add a line to [[23-log]], and keep the contents table in [[00-preface]] complete.

## Code comments are documentation too

Every source file starts with a comment saying what it is for; every exported function, class, type and constant has a
doc comment saying what it means to a caller. Comments explain *why* and *what for*, never narrate the line below.
Details and examples: [[19-how-we-document]].

## Security

Never put real secrets, tokens, team-private data or production URLs with credentials in docs. Use placeholders as
`.env.example` does.
