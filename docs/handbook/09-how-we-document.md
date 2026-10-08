---
title: How we document
description: The documentation system: four kinds of page, code comments, templates, review, and how it stays true
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs/CLAUDE.md
  - docs/index.md
  - docs/log.md
  - docs/handbook/decisions
---

# Chapter 9. How we document

Documentation has one enemy, which is time. A page that was true in October is false by March, and a false page is worse than
none, because it is believed. Everything in this chapter is a defence against that, and a way to make writing the right thing
the easy thing.

## Four places, four jobs

Information goes where its reader will look for it. Putting a fact in the wrong place is the commonest way it gets lost.

| Place | The reader is asking | Example |
|---|---|---|
| **A comment in the code** | "What is this for, and what must I not break?" | The header at the top of `lib/domain/team.ts`; the note on `projectDashboardDocument` that it is the privacy boundary |
| **A reference page** (`docs/*.md`) | "What exactly is true now?" | [[data-model]] lists the document types; [[authentication]] lists every environment variable |
| **A handbook chapter** (`docs/handbook/`) | "How do we work, and why?" | This book |
| **A decision record** (`docs/handbook/decisions/`) | "Why did we choose this over the alternative?" | [[0003-snapshot-plus-cursor-realtime]] |
| **The log** ([[log]]) | "What changed in the docs, and when?" | One dated line per change |

If you are not sure which, ask who will read it and when. Someone mid-edit in a file reads the comment. Someone planning a change
reads the reference. Someone joining the team reads the handbook. Someone about to undo a choice reads the decision record.

## Comments in code

Two obligations, both enforced by review and checked by a script when we remember to run it:

1. **Every source file starts with a comment saying what the file is for**, in a sentence or two, written for someone who has
   not seen the rest of the code. For a route or page, that means the URL, who may open it, and what it shows.
2. **Every exported function, class, type and constant has a doc comment** saying what it *means to a caller*: what it returns,
   what it assumes, what it refuses, and, when it is a rule of the sport or of security, why.

What makes a good comment, and what does not:

```ts
// Bad: says what the next line already says.
// Set loading to true
setLoading(true);

// Good: says why, which no amount of reading the code reveals.
/** Deeply nested input overflows the stack in JSON.stringify; a document we cannot measure is dropped. */
function fitsFrameBudget(doc: Record<string, unknown>): boolean { ... }
```

Rules of thumb:

- **Explain the why, the constraint and the trap.** The statement of a rule ("a value is a likely outlier beyond 2.5 standard
  deviations…") is worth more than a restatement of the loop.
- **Name the consequence of getting it wrong** when it is serious: "this is the privacy boundary", "do not retry on 4401".
- **Delete historical comments.** A comment about code that no longer exists is a lie with good intentions.
- **Do not document the obvious.** `/** The team number. */` on a property called `number` adds noise. A short comment that adds
  nothing makes the useful ones harder to find.
- **Keep them near the code.** A comment that must be updated in two files will be updated in one.

## Reference pages

A reference page answers **one question** and is short enough to read in a minute or two. When it grows past about three thousand
characters it is probably two pages. (Runbooks and setup guides that are meant to be followed top to bottom, such as
[[authentication]] and [[operations]], are allowed to be longer; they are read as procedures.)

Every page starts with this frontmatter:

```yaml
---
title: Short, specific
description: One sentence that says what question the page answers
verified_at: 6c13ac9 (2026-10-08)   # the commit and date you last checked it against the code
sources:                            # repo-root paths the claims come from
  - lib/domain/team.ts
---
```

`verified_at` is the honest heart of it. It does not claim the page is right; it says *when someone last checked*. If a source
file has changed since that commit, the page is suspect, and now you can see by how much. `git log <commit>..HEAD -- <source>` shows
what to re-read.

Link other pages with `[[page-name]]` (the file name without `.md`) and code with its repo-root path in backticks. Prefer a link to
repeating a fact: a fact stated in two places will eventually be stated two ways.

## Handbook chapters

Chapters are prose. They may be long. They tell a story and explain reasons, and they link to the reference pages for the exact
names and numbers so that the story does not have to carry them. A chapter has the same frontmatter, opens by saying what problem
it addresses, and ends with **Where to go next**.

Write them for a bright newcomer who was not there. Define a term the first time it appears, or link to the [[glossary]]. Prefer a
concrete example (team 254, match 31) to an abstraction. Say what something is *not* as clearly as what it is.

## Decision records

A decision record is one screen: the **context** (what forced a choice), the **decision**, the **alternatives** considered and why
each lost, and the **consequences**, good and bad. They are numbered and dated. Once accepted they are never edited; if a decision
is reversed, a new record supersedes the old one and the old one gains a "superseded by" line. That keeps the history honest: you
can see not only what we do, but what we used to do and why we stopped. Start from `decisions/_template.md`; the index is
[[decisions]].

Write one when a choice has real alternatives and a future person might reasonably want to undo it. Do not write one for choices
nobody would question.

## The log

[[log]] is append-only. Each entry is a dated heading and a few bullets: what documentation changed, and any correction ("the
previous entry said X; it is Y"). If a fact changes, write a correcting entry; do not rewrite history.

## When you change code, change the docs in the same pull request

The table in `docs/CLAUDE.md` says which page to update for which kind of change. It is short on purpose. The habit that keeps
documentation alive is making the update part of the change, reviewed with it, rather than a task for later (later does not come).
A reviewer should ask of any pull request: *what would a reader of the docs now believe that is no longer true?*

Concretely, with each change:

1. Update the reference page(s) the table names, and bump their `verified_at`.
2. If the way we work changed, update the chapter that describes it.
3. If you made a choice with real alternatives, add a decision record.
4. Add a line to the log.
5. Keep the page list in [[index]] complete.

## Checks

Some of this can be checked by a machine, and when it can, it should be. Today:

- `npm run test:docs` (`scripts/test-bench/doc-coverage.mjs`) fails when a source file has no header comment or an exported
  function, class, type or constant has no doc comment. Route, page and layout files need only the header, because their exports
  are settings and handlers fixed by Next.js. It runs in `validate:fast`, `validate` and CI, so an undocumented export cannot
  reach `main`.
- The test bench checks the config file against the pages that exist ([[04-one-file-controls-the-app]]).
- The test bench checks the test sources themselves (nothing disabled, everything listed).

The documentation check proves a comment *exists*, not that it is *good*. A comment like `/** The thing. */` passes and helps nobody.
That part is review's job. Things that a machine cannot check, such as whether a chapter is *clear*, are for review. When reviewing documentation, read it as a
newcomer: if you had to reread a sentence, it needs rewriting.

## Where to go next

The ownership of everything in this book, including the rules for sharing it: [[10-ownership-and-license]]. A list of terms used
throughout: [[glossary]].
