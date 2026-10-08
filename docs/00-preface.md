---
title: 00 - PREFACE
description: How to read these docs, how the numbering works, and the contents of everything
verified_at: 7c5884e (2026-10-08)
sources:
  - docs
  - app.config.ts
  - lib/domain
---

# 00 - PREFACE

**Start reading:** [[01-the-team-and-the-problem]]

This is the documentation of the Team 610 scouting dashboard, and it is meant to be read as a book. A new student, a new mentor, or
a returning member who has forgotten why things are the way they are can start here and read forward. It tells the story of a
piece of data from a tablet to a strategist's screen, explains the objects the software thinks in, says who is allowed to do what
and why, and records the habits that keep a team of changing hands from breaking its own tool.

It is also a reference. Look-up pages (data shapes, every environment variable, the health checks) sit in the same sequence, each
right after the chapter that leads into it, so that you can read for the story and then dig for the detail, or skip straight to
the detail.

## How the numbering works

Every page in `docs/` has a two-digit number, and the numbers are the reading order. The file is `NN-name.md`; the title and the
heading are `NN - NAME`.

- **Chapters** are prose: they explain how and why, with examples. They may be long. They end with "Where to go next".
- **Reference pages** answer one question about how things are now: exact names, settings and commands. They are short, or, for
  runbooks that are followed from top to bottom, as long as the procedure needs.
- A chapter is usually followed by the reference page it points at: *03 A match travels* is followed by *04 Architecture* and
  *05 Data model*.
- **`docs/decisions/`** holds the decision records, one short note per important choice, numbered separately (`0001`…). They are the
  appendix; [[22-decisions]] lists them.
- **`docs/CLAUDE.md`** is the one unnumbered file. Its name is fixed because tools that help edit this repository look for it by
  name. It holds the short rules for editing these docs.

The numbering is checked: `npm run test:docs` fails if a number is skipped or repeated, if a title does not start with its file's
number, or if a link points at a page that does not exist. When you add a page, take the next free number at the end; when you
must insert one in the middle, rename the files that follow with `git mv`, change their numbers in the title and heading, and
let the check find every link that needs updating ([[19-how-we-document]]).

## Contents

| # | Page | Kind | It answers |
|---|---|---|---|
| 00 | [[00-preface]] | Preface | How do I read this, and what is where? |
| 01 | [[01-the-team-and-the-problem]] | Chapter | Why do we scout, and what is the dashboard for? |
| 02 | [[02-overview]] | Reference | What does each tab do, and who can do what? |
| 03 | [[03-a-match-travels]] | Chapter | How does one match record get from a tablet to a screen? |
| 04 | [[04-architecture]] | Reference | Where does each kind of file live, and how does a page load? |
| 05 | [[05-data-model]] | Reference | What documents exist, and how do they become rows? |
| 06 | [[06-the-objects]] | Chapter | What are the event, team, match and alliance objects, and what rules do they follow? |
| 07 | [[07-one-file-controls-the-app]] | Chapter | What does `app.config.ts` decide, and what deliberately not? |
| 08 | [[08-configuration]] | Reference | How do I change the team, pages, columns, thresholds or storage backend? |
| 09 | [[09-who-is-allowed-in]] | Chapter | Why are sign-in and roles built the way they are? |
| 10 | [[10-authentication]] | Reference | How do I set up sign-in, and what are the exact roles, sessions and variables? |
| 11 | [[11-staying-live]] | Chapter | How do pages update themselves, and how can that fail? |
| 12 | [[12-realtime]] | Reference | What is the live protocol, and what happens on each failure? |
| 13 | [[13-pages]] | Reference | Which route is which, who may open it, and which files build it? |
| 14 | [[14-design-system]] | Reference | What are the colours, tokens and shared pieces? |
| 15 | [[15-event-day]] | Chapter | How do we run and read the system at a competition? |
| 16 | [[16-operations]] | Reference | What does every admin check measure, and what do I do when it fails? |
| 17 | [[17-how-we-build]] | Chapter | What are our working agreements for changing the software? |
| 18 | [[18-development]] | Reference | What are the setup steps, commands, conventions and recipes? |
| 19 | [[19-how-we-document]] | Chapter | How do the docs and code comments stay true? |
| 20 | [[20-ownership-and-license]] | Chapter | Whose work is this, and what may I do with it? |
| 21 | [[21-glossary]] | Reference | What does this term mean? |
| 22 | [[22-decisions]] | Reference | Why did we choose this? (nine decision records) |
| 23 | [[23-log]] | Log | What changed in the docs, and when? |

## Ways to read it

- **First week on the team:** 01, 03, 06, 21, then open the app and click around with them in hand.
- **Before changing code:** 06, 07, 17, then 04 (the map) and the reference page for the area.
- **Changing look or pages:** 14, 13, 08, and the Figma-first rule in 17.
- **Touching live updates:** 11, 12, 05.
- **Setting up sign-in or managing people:** 09, 10.
- **At an event:** 15, with 16 open next to it.
- **Before sharing anything outside the team:** 20. The answer is almost always "ask a mentor first".
- **Before a pull request:** 17, 18, and `tests/README.md`.

## A note on honesty

A book about software goes stale faster than a book about anything else. Two habits fight that: every page records the commit it was
last checked against (`verified_at`), and the rules for changing code say which pages to update with the change
([[19-how-we-document]]). If you find something here that is wrong, fixing the page is a real contribution, not a chore.
