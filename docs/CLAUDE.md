---
title: Docs rules
description: How to write and update the pages in this folder
verified_at: 27726e0 (2026-10-02)
sources:
  - docs
---

# Docs rules

`docs/` is a wiki. Read [[index]] first; keep it accurate when code changes.

## Page format

Frontmatter: `title`, `description`, `verified_at` (the commit and date the page was last checked against the code), `sources`
(repo-root paths the claims come from). Link pages with `[[page-name]]`; link code with repo-root paths. One question per page;
if a page passes about 3,000 characters, split it.

## When you change code

| You changed | Update |
|---|---|
| A route, page or component's job | [[pages]] |
| Document handling, `TeamAggregate`, the privacy allow-list | [[data-model]], and [[realtime]] if the feed changed |
| `lib/realtime/*` | [[realtime]] |
| Colours, tab hues, `components/ui/kit.tsx` | [[design-system]] |
| Roles, sessions, sign-in, env vars | [[authentication]] |
| Admin panel, health checks, metrics | [[operations]] |
| `app.config.ts`, `services/scouting-store.ts` | [[configuration]] |
| Commands, conventions, folder layout | [[development]] or [[architecture]] |

Bump `verified_at` on every page you re-check, add a line to [[log]], and keep the page list in [[index]] complete.

## Security

Never put real secrets, tokens, team-private data or production URLs with credentials in docs. Use placeholders as `.env.example` does.
