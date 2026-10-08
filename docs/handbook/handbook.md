---
title: The Team 610 scouting handbook
description: A book about how we scout, how the software works, and how we work together on it
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs
  - app.config.ts
  - lib/domain
---

# The Team 610 scouting handbook

This is the book of the scouting dashboard. The pages in [[index]] are a reference: you look something up and leave.
The handbook is different. It is meant to be read, in order, by a new student, a new mentor, or a returning member who
has forgotten why things are the way they are. It tells the story of a piece of data from a tablet to a strategist's
screen, explains the objects the software thinks in, says who is allowed to do what and why, and records the habits that
keep a team of changing hands from breaking its own tool.

Read it like a book. Every chapter ends with a pointer to the reference pages where the exact names, commands and settings
live, because a story should not also try to be a manual.

## The chapters

1. [[01-the-team-and-the-problem]]: why we scout, and what the dashboard is for.
2. [[02-a-match-travels]]: one match record, from a scout's tablet to a screen in the stands.
3. [[03-the-objects]]: the event, the teams, the matches, the alliances: the vocabulary in the code.
4. [[04-one-file-controls-the-app]]: `app.config.ts`, what it decides and what it deliberately does not.
5. [[05-who-is-allowed-in]]: sign-in, roles, and the trust boundaries.
6. [[06-staying-live]]: how pages update themselves, and what can go wrong.
7. [[07-event-day]]: running the system at a competition.
8. [[08-how-we-build]]: our working agreements: design first, tests first, small functions.
9. [[09-how-we-document]]: how this book and the code comments are kept honest.
10. [[10-ownership-and-license]]: whose work this is and what you may do with it.

Also: [[glossary]] (every term in one place) and [[decisions]] (the reasons behind the big choices, one short record each).

## How to use the book on a given day

- **First week on the team:** read chapters 1 to 3 and the glossary. Then open the app and click around with them in hand.
- **Before changing code:** chapters 3, 4 and 8, then the reference page for the area ([[architecture]] is the map).
- **At an event:** chapter 7, and keep [[operations]] open.
- **Before sharing anything outside the team:** chapter 10. The answer is almost always "ask a mentor first".

## A note on honesty

A book about software goes stale faster than a book about anything else. Two habits fight that: every page records the
commit it was last checked against (`verified_at`), and the rules for changing code say which pages to update with it
([[09-how-we-document]]). If you find something here that is wrong, fixing the page is a real contribution, not a chore.
