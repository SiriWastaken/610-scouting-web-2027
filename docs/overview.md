---
title: Overview
description: What the dashboard is for and what it shows
verified_at: 27726e0 (2026-10-02)
sources:
  - README.md
  - components/layout/nav-links.tsx
  - lib/auth/roles.ts
---

# Overview

The dashboard turns the scouting data the team collects at FRC events (match scouting, pit interviews,
card reports) into something strategy can use in the stands: rankings, averages, head-to-head
comparisons, and a per-team drill-down. Data lives in Couchbase and is read through Sync Gateway; the
app never writes scouting data.

## What each tab is for

| Tab | Use it to |
|---|---|
| Teams | Look one team up: averages, every scouted match, auto path replay, pit interview, cards |
| Averages | Rank every team on any statistic |
| Strategy | Compare two teams, or build two alliances and see projected scores |
| Box Plot | See the spread of a statistic across the event |
| Coverage | See which teams are under-scouted |
| Admin | System health, users, audit log (mentors and above) |

## Who can do what

Everyone signs in with Google or Apple. An account has one of five roles (Owner, Mentor, Scout lead,
Scout, Member) and the server enforces them. Any approved account can read the dashboard; only
Mentors and above see operations; scout leads manage users. See [[authentication]].

## Live by default

Pages update in place as scouts submit data, with no refresh. See [[realtime]].

## No fake data

If Couchbase is not configured, data pages show an explicit empty state. Nothing is mocked in the app;
tests use a fake Sync Gateway instead ([[development]]).
