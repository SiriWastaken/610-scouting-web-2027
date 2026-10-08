---
title: How we build
description: Our working agreements for changing the software: design first, tests first, small functions, honest reports
verified_at: 6c13ac9 (2026-10-08)
sources:
  - AGENTS.md
  - CLAUDE.md
  - tests/README.md
  - scripts/test-bench/manifest.mjs
  - .githooks/pre-push
  - docs/development.md
---

# Chapter 8. How we build

A team whose members change every year needs habits that survive turnover. These are ours. None is exotic; the discipline is in
doing them every time, and in the places where we wrote them down so that a tired person at midnight before an event does not
have to remember.

## Design comes first

The look of the dashboard is designed in Figma before it is coded ([[0001-figma-first]]). A change to what a screen looks like
starts in the Figma file; the maintainer sees it and approves it; only then does anyone edit anything under `app/`,
`components/` or the styling in `app/globals.css`. After approval, the code is made to match the design as written. If the code
later changes how something looks or behaves, with approval, the Figma file is updated in the same piece of work, so the two
never drift. The Figma file is also edited by the maintainer, so read it before you change it and touch only what the task needs.

Two things are *not* "UI changes" and do not need Figma: restructuring code with no visible difference (splitting a component
into smaller ones), and changing words and numbers in `app.config.ts`. If you are unsure whether a change will be visible,
treat it as visible.

## A change is done when the bench says so

The test bench (`tests/README.md`) is the definition of "works". Two commands:

- `npm run validate:fast` before and after you change something (about a minute).
- `npm run validate` before you open a pull request (about five). It also builds the production app and runs it in a real
  browser.

A change is finished when `npm run validate` ends with **`✔ TEST BENCH PASSED`**. The wording is exact on purpose: "I ran the
tests and they looked fine" is not a result. There is a pre-push hook that runs the fast version for you; enable it once with
`git config core.hooksPath .githooks`.

The bench is built to be hard to cheat, including by accident. A test that did not run never counts as a pass. Every test file must
be listed in `scripts/test-bench/manifest.mjs` with a minimum number of passing tests (its *floor*); a run that executes fewer
fails. Coverage has per-file floors too. The rules that follow from that are absolute:

- Never skip, focus (`.only`) or delete a test to get a green run.
- Never lower a floor in the manifest. If a floor must change, say why in the commit message; the diff will be seen.
- Never edit a hand-computed expectation to make a failure go away. If an expected value is wrong, work out the right value
  by hand, from the rule, and explain it.
- New behaviour needs a new test, in the matching folder, listed in the manifest. Start from `tests/testTemplate.test.ts`.

Tests use a **fake Sync Gateway**, a real HTTP server in `tests/helpers/` that behaves like the real one (changes feed, revision
conflicts, faults you can inject), rather than mocks. The app is therefore tested against something that talks HTTP, and the
contract suite checks the fake against the real thing in CI ([[0004-fake-gateway-not-mocks]]).

## Small functions, readable by a human

The maintainer's rule, set on 2026-10-08: **a function longer than thirty lines is a defect, and so is code a person cannot
read.** It is checked mechanically: `npm run test:size` measures every function, nested ones included, and fails the bench and CI on
any over thirty lines. The codebase was brought to zero over-length functions ([[0008-thirty-line-functions]]).

In practice this means:

- A React component is one idea. A component that renders a panel, loads its data and handles its form is three things; split
  them. Data and state go in a hook (`useUserDetail`), a panel is a component, a repeated cell is a component.
- Arithmetic and rules go in functions or classes with tests, not inline in JSX.
- A long `if / else if` chain is a lookup table or a set of named functions.
- Splitting is not an excuse for vagueness. A function named `handle` that does three things is worse than one long function.
  Name each piece for what it means.

The cost is real: more, smaller pieces means more lines in total. We accept that, because the pieces are findable and testable,
and the long ones were the ones nobody dared change.

## Objects for the sport, functions for the arithmetic

The rule of thumb from [[03-the-objects]]: if a piece of logic has a noun in it (a team, a match, an alliance, an event), it
belongs on that noun's class. If it is arithmetic on numbers (a median, a margin, a number format), it is a small function in
`lib/data/team-stats.ts`. Settings that a future student might reasonably change go in `app.config.ts`
([[04-one-file-controls-the-app]]); settings that are secrets go in the environment; rules about who may do what go in
`lib/auth/roles.ts`.

## Rules of the road for code

- **Routes stay thin.** A page or route file checks access, fetches, and renders a component. Logic goes in `lib/`, I/O in
  `services/`, UI in `components/`.
- **Untrusted documents go through the sanitizers** in `lib/data/`. Never render a raw value from a document.
- **Server-only modules** start with `import "server-only"`; client components start with `'use client'`.
- **Node runs some of our files directly.** Files in `lib/` and `scripts/` are loaded by plain Node (the dev server and the
  tests) with its type-stripping mode, which understands types but not TypeScript's extra runtime syntax. That means no
  constructor parameter properties (`constructor(private x: T)`) and no `enum`s in those folders; write the field and assign it
  ([[0006-node-type-stripping]]). `validate:fast` catches a mistake because the tests load these files.
- **Imports:** `@/` for app code; relative `.ts` imports for modules shared with plain Node.
- **Comments say why**, not what ([[09-how-we-document]]).
- **Next.js here is not the Next.js you know.** This version has breaking changes. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing framework code, and heed deprecation notices (`AGENTS.md`).

## Branches, commits, pull requests

Work happens on a branch (`feature/…`, `refactor/…`), is committed in logical pieces with a message that says what and why, and
reaches `main` by pull request. Do not rewrite history on a shared branch. Keep a pull request to one purpose: a refactor and a
feature in the same diff cannot be reviewed.

A pull request description should say: what changed, what did not (especially "no behaviour change" for refactors), the
`validate` result, and anything the reviewer must decide. Decisions with real alternatives get a decision record
([[decisions]]).

## Working with an AI coding assistant

We use AI assistants. They follow the same rules, written down in `AGENTS.md` and `CLAUDE.md` so they apply without anyone
remembering to say them: Figma first, run the bench before and after, never weaken a test, update the docs that the change
touches. Two further agreements:

- **An assistant's report must be literal.** "Tests pass" means the bench printed its pass line, and the report says which suite.
  If something was not run, the report says so.
- **The license applies** ([[10-ownership-and-license]]). Assistants work on the code for the team; they must not be used to copy
  it elsewhere or to train models on it.

## The honest report

Whoever finishes a piece of work ends with a short, factual report: what was changed, what was verified and how, what was
*not* done, and what risk remains. A report that only lists successes teaches the next reader to distrust all reports.

## Where to go next

How the book and the comments are kept true: [[09-how-we-document]]. The practical command list and recipes:
[[development]] and `tests/README.md`.
