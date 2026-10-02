---
title: Docs index
description: Where to start, and which page answers which question
verified_at: 27726e0 (2026-10-02)
sources:
  - README.md
---

# Docs index

Documentation for the Team 610 scouting dashboard. Pages are short and each answers one question;
follow the route that matches what you are doing.

## Reading order

- **New to the project:** [[overview]] → [[architecture]] → [[data-model]] → [[pages]]
- **Changing the UI:** [[design-system]] → [[pages]] → [[development]]
- **Touching live updates:** [[realtime]] → [[data-model]]
- **Setting up sign-in or managing users:** [[authentication]]
- **Running it at an event:** [[operations]]
- **Before you open a PR:** [[development]] (and [`tests/README.md`](../tests/README.md))

## All pages

| Page | Answers |
|---|---|
| [[overview]] | What is this app, who uses it, what does it show? |
| [[architecture]] | How do a page load and a live update flow through the code? Where does each kind of file live? |
| [[data-model]] | What documents does Couchbase hold, and how do they become the rows the UI shows? |
| [[realtime]] | How do pages stay live, and what stops a stale or duplicate update from winning? |
| [[pages]] | Every route: what it shows, who may open it, which files build it |
| [[design-system]] | Colours, tabs, shared building blocks, and the rules for using them |
| [[authentication]] | Sign-in setup, roles and permissions, sessions, audit log, security |
| [[operations]] | The admin panel: health, WebSocket and sync monitoring, event-day troubleshooting |
| [[development]] | Setup, commands, conventions, how to add a page or an API route |
| [[log]] | What changed in the docs and why |
