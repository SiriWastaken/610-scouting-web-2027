---
title: Docs rules
description: The kinds of page in docs/, how to write each, and what to update when code changes
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs
  - docs/handbook/09-how-we-document.md
---

# Docs rules

`docs/` is a wiki with a book inside it. Read [[index]] first; keep everything accurate when code changes. The full
reasoning behind these rules is in [[09-how-we-document]]; this page is the short version for whoever (or whatever)
is editing.

## Four kinds of page

| Kind | Where | Job | Length |
|---|---|---|---|
| **Reference** | `docs/*.md` | Answer one question about how the system is now. Look-up, not reading. | Short. Split a page that passes about 3,000 characters, unless it is a runbook or setup guide that reads top to bottom (`authentication`, `operations`) |
| **Handbook chapter** | `docs/handbook/NN-*.md` | Tell how and why we work the way we do, in prose, so a newcomer can read the book front to back. | As long as it needs. End with "Where to go next" |
| **Decision record** | `docs/handbook/decisions/NNNN-*.md` | Preserve why a choice was made and what it cost. Never edited once accepted; superseded by a new record. | One screen |
| **Log** | [[log]] | Append-only history of documentation changes. | One entry per change |

## Page format

Every page starts with frontmatter: `title`, `description`, `verified_at` (the commit and date the page was last checked
against the code), `sources` (repo-root paths the claims come from). Link pages with `[[page-name]]` (the file name without
`.md`); link code with repo-root paths in backticks.

## When you change code

| You changed | Update |
|---|---|
| A route, page or component's job | [[pages]] |
| Document handling, `TeamAggregate`, the privacy allow-list | [[data-model]], and [[realtime]] if the feed changed |
| `lib/domain/*` (Event, Team, Match, Alliance) | [[data-model]] and [[03-the-objects]] |
| `lib/realtime/*` | [[realtime]] |
| Colours, `components/ui/kit.tsx` | [[design-system]] |
| Roles, sessions, sign-in, env vars | [[authentication]] |
| Admin panel, health checks, metrics | [[operations]] |
| `app.config.ts`, `services/scouting-store.ts` | [[configuration]] |
| Commands, conventions, folder layout | [[development]] or [[architecture]] |
| A working agreement (how we build, review, ship) | [[08-how-we-build]] |
| A choice with real alternatives | a new decision record in `docs/handbook/decisions/` |
| The license or who owns what | [[10-ownership-and-license]] and `LICENSE` |

Bump `verified_at` on every page you re-check, add a line to [[log]], and keep the page list in [[index]] complete.

## Code comments are documentation too

Every source file starts with a comment saying what it is for; every exported function, class, type and constant has a
doc comment saying what it means to a caller. Comments explain *why* and *what for*, never narrate the line below.
Details and examples: [[09-how-we-document]].

## Security

Never put real secrets, tokens, team-private data or production URLs with credentials in docs. Use placeholders as
`.env.example` does.
