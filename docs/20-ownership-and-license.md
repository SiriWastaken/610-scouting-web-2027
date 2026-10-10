---
title: 20 - OWNERSHIP AND LICENSE
description: Whose work this is, what team members and outsiders may do with it, and what to ask a mentor before sharing
verified_at: 6c13ac9 (2026-10-08)
sources:
  - LICENSE
  - package.json
  - README.md
---

# 20 - OWNERSHIP AND LICENSE

**Previous:** [[19-how-we-document]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[21-glossary]]

> This chapter explains the license in plain language. It is a guide, not legal advice. If the two ever disagree, the
> `LICENSE` file wins. The license text itself was drafted by an AI assistant to express the team's intent; **the team's sponsor
> or a lawyer should review it before anyone relies on it.**

## The short version

This software is the work of Team 610's members and belongs to the team. It is **not open source**. You may read it to learn from
it. Members of the team may use and change it for the team's own scouting and training. Nobody may copy it, change it for another
purpose, publish it, host it for someone else, or use it to train an AI model without written permission from a mentor or officer.

## Who owns it, and who does not

The owner is **Team 610** (copyright holder: FIRST Robotics Competition Team 610). Two clarifications matter because the names are
easy to confuse:

- **Not FIRST.** "FIRST" and "FIRST Robotics Competition" are trademarks of the organisation that runs the competition. We
  take part in their competition; they do not own, endorse or sponsor this software, and we do not claim any of their property.
  The license says so.
- **Not the packages we use.** The dashboard stands on other people's open-source work (Next.js, React, Tailwind CSS and others,
  listed in `package.json`). Those remain under their own licenses and are not covered by ours. Our license applies only to what
  the team wrote.
- **Not the scouting data.** The data belongs to the people who collected it and falls under the team's data practices. The license
  does not grant any right to it.

## What you may do

| You are | You may |
|---|---|
| A **current member or mentor** | Run it and change it on devices and accounts the team controls, for scouting, strategy and training |
| **Anyone who can see the code** | Read it, in place, for your own education |

## What you may not do (without written permission)

Copy or mirror it. Fork it, clone it to keep, or archive it. Modify it or make anything derived from it, including a "rewrite that
follows the same design". Share, publish, sell, rent or host it, or run it for another team or event. Use it to train, fine-tune or
evaluate an AI model, or to build a dataset for one. Remove the notices. Use the team's name to suggest endorsement. Dig for secrets
or private data.

One carve-out for AI assistants: members may use a coding assistant *on the code while working on it for the team*; that does not
let the assistant's provider keep or train on it beyond whatever agreement the team already has. We reccomend that you have
your agent's toggles regarding model training to be off while you're working on these repos, but it's not
required. 

## Contributing

If you write code, text or design for this repository, you are doing it as a member of Team 610, and by contributing you assign your
copyright in that contribution to the team (or, where the law will not allow that, give the team an exclusive, permanent,
irrevocable license). You keep the right to say that you wrote it and to describe your skills. For members who are minors, a parent
or guardian should agree to this where the law requires it; a mentor will arrange it.

Why this matters: a team of students graduates every year. If the code belonged to whoever typed it, the team would be unable to
keep or change its own tool once they left. Assigning to the team solves that for everyone, including you.

## A public repository is not a public license

Seeing code on a website does not give you permission to use it. A repository can be visible (to teammates, to colleagues, to
anyone) and still have every right reserved. That is what `LICENSE` says. Two practical consequences:

1. **A truly private repository is the stronger protection.** On a public GitHub repository, GitHub's own terms of service let
   anyone view and fork it, which no license can switch off. If the intent is "no copying", keep the repository **private** and
   add collaborators by invitation. This is the single most effective thing the team can do, and it costs nothing.
2. **Do not paste the code or the docs into public places** (forums, public chat, AI services with public sharing) without
   permission. If you need help with a problem, describe it, or ask a mentor how to share a small excerpt safely.

## Questions you will actually have

**"Can I show this at my college interview?"** Showing it on your own screen, describing your role, and linking to what the team
publishes about it is fine. Sending someone the source code, ANY part of it whatsoever is not, without permission.

**"Can I reuse an idea or a technique I learned here in my own project?"** General skills and knowledge are yours. If we tried to
copyright that or claim that your knowledge belonged to us, that would be wrong. The license
restricts copying and adapting *the expression* in this repository, not what you have learned. If you are not sure whether
something is a general technique or this code's particular design, ask.

**"Can another team use it?"** Only with written permission from a mentor. Not even a student exec can approve this decision.

**"Can I share a screenshot?"** Screenshots of the running app without private data are ordinary team communication. Screenshots
that include credentials, user lists or scouting data about other teams are not. We're working on a
function where the app goes in to a "display" mode, triggered
by an NPM script, so that you can take screenshots of the app for a portfolio or resume.

**"Who do I ask?"** The contact address in `LICENSE` (the team fills it in), or a mentor.

## Where to go next

The working agreements that apply to everyone who contributes: [[17-how-we-build]]. The decision behind this license:
[[0007-proprietary-license]].
