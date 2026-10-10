---
title: 22 - DECISION LOG
description: Every recorded decision with its date and status, and how to add one
verified_at: 7c5884e (2026-10-08)
sources:
  - docs/decisions
---

# 22 - DECISION LOG

**Previous:** [[21-glossary]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[23-log]]

A decision record preserves *why*. It is never edited once accepted; a reversed decision gets a new record that supersedes it.
Write one when a choice has real alternatives and a future person might want to undo it. Start from `_template.md`. Records
marked **retrospective** were written on 2026-10-08 from the code, the docs and the maintainer's instructions, for decisions that
were made earlier; their alternatives are reasoned, not remembered.

| # | Decision | Status | Date |
|---|---|---|---|
| [[0001-figma-first]] | Visual changes are designed in Figma and approved before coding | accepted | 2026-10-03 |
| [[0002-google-only-open-access]] | Google is the only sign-in; anyone Google admits is in; managers deny afterwards | accepted | 2026-10-03 |
| [[0003-snapshot-plus-cursor-realtime]] | Pages are a snapshot plus a live feed from the snapshot's cursor | accepted (retrospective) | 2026-10-08 |
| [[0004-fake-gateway-not-mocks]] | Tests use a fake Sync Gateway over real HTTP, not mocks | accepted (retrospective) | 2026-10-08 |
| [[0005-config-file-and-domain-objects]] | One `app.config.ts`, and a domain model of classes | accepted | 2026-10-08 |
| [[0006-node-type-stripping]] | `lib/` and `scripts/` run directly in Node; no TypeScript-only runtime syntax there | accepted | 2026-10-08 |
| [[0007-proprietary-license]] | All rights reserved; read-only for learning; members may use for the team | accepted, needs legal review | 2026-10-08 |
| [[0008-thirty-line-functions]] | A function over thirty lines is a defect | accepted | 2026-10-08 |
| [[0009-separate-account-database]] | Accounts live apart from scouting data | accepted (retrospective) | 2026-10-08 |
