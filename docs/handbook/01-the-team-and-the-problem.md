---
title: The team and the problem
description: Why Team 610 scouts, what a scouting dashboard is for, and what this one does and does not do
verified_at: 6c13ac9 (2026-10-08)
sources:
  - README.md
  - docs/overview.md
  - app.config.ts
---

# Chapter 1. The team and the problem

## A competition is a data problem

A FIRST Robotics Competition event is a few days in which dozens of teams play many short matches against changing
partners and opponents. Two alliances of three robots face off; the alliances are different every match. By the time
elimination rounds begin, a team has to choose its partners and plan against its opponents, and it has very little time and
a lot of noise: one lucky match, one broken robot, one hot-headed driver can make a weak team look strong or the reverse.

The remedy is to watch carefully and to write it down. Team 610 (the Crescent Coyotes) does this with scouts: members who
sit in the stands with tablets and record what each robot does in each match, and who walk the pits to ask each team how
their robot works. One scout's single match is not very informative. A hundred matches, averaged by robot, is a picture.

The scouting dashboard is what turns the pile of records into that picture.

## What the dashboard is for

The dashboard answers the questions a strategist actually asks, in the order they ask them:

- **Who is this team?** The *Teams* page shows one team at a time: its averages, every match we scouted, a replay of where
  its robot drove in autonomous, what the pit interview revealed, and any cards it was given.
- **Who is best at X?** The *Averages* page ranks every team on any statistic, and the *Box Plot* page shows how spread out
  a statistic is across the event, which tells you whether a value is ordinary or exceptional.
- **What happens if we pair these robots against those?** The *Strategy* page compares two teams side by side and projects
  a score for two alliances you assemble yourself. It is a transparent baseline: it adds up each robot's average points. It
  does not simulate a match, and it says so on the page.
- **Can we trust our own data?** The *Coverage* page shows which teams have been scouted enough that their averages mean
  something, so the scout lead knows where to send scouts.
- **Is the system working?** The *Admin* area, for mentors and scout leads, shows health, who has access, and what changed.

## What it does not do

It is as important to be clear about the edges.

- **It does not collect data.** Scouts record matches on separate scouting tablets. The dashboard only reads what those
  tablets produce. No page in the dashboard writes scouting data, and the code is arranged so that it could not by accident
  ([[05-who-is-allowed-in]] explains the access side; [[02-a-match-travels]] the data side).
- **It does not decide anything.** It shows numbers, flags the ones that look unreliable (a team scouted in fewer than three
  matches is marked "low sample"; a value far outside the field is marked "outlier"), and leaves the decision to people.
- **It does not invent data.** If the database is not configured, pages show an empty state that says so. Nothing is mocked.
  A statistic that was never scouted is shown as a dash, never as a zero, because a dash means "we don't know" and a zero
  means "we watched and it was zero", and strategy goes wrong when the two are confused. This idea (*missing is not zero*) comes
  back in [[03-the-objects]].

## Who uses it

Everyone who signs in can read the dashboard. What they can *change* depends on their role: scouts and members read; scout
leads can manage accounts; mentors can see how the system is running and manage more of the people; the Owner, a role
fixed in configuration rather than granted in the app, can do everything, including editing names. The reasoning, and the
exact rules, are in [[05-who-is-allowed-in]].

## What "good" looks like for this software

A tool like this is judged in a particular, unforgiving setting: a loud arena, a short break between matches, a tired
student who needs one number. That sets the priorities, and they explain choices you will meet later in the book:

1. **It must be right before it is clever.** Hence tests with hand-worked expected values, a bench that refuses to pass if a
   test silently did not run, and the "missing is not zero" rule.
2. **It must stay up and say so when it is not.** Hence the live connection badge, the admin health checks, and the event-day
   checklist ([[07-event-day]]).
3. **It must be readable by the next group of students.** The team changes every year. Hence small functions, one place for
   the settings that change each season, an object model that matches how people talk about the sport, and this book
   ([[08-how-we-build]]).
4. **It must keep the team's data and the team's work the team's.** Hence the privacy allow-list on what is sent live, the
   separate account database, and the license ([[10-ownership-and-license]]).

## Where to go next

The next chapter follows a single record on its way from a scout's finger to a strategist's screen: [[02-a-match-travels]].
For the one-page summary of every tab, see [[overview]].
