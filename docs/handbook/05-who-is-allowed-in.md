---
title: Who is allowed in
description: How sign-in, roles and the trust boundaries work, told as the reasoning behind the rules
verified_at: 6c13ac9 (2026-10-08)
sources:
  - lib/auth/roles.ts
  - lib/auth/sign-in.ts
  - lib/auth/sessions.ts
  - lib/auth/requests.ts
  - lib/auth/pages.ts
  - proxy.ts
  - docs/authentication.md
---

# Chapter 5. Who is allowed in

A scouting dashboard holds opinions about other teams. It should be readable by our team and not by the whole internet. It
also has to be easy to get into, because on competition day a new student who cannot sign in is a student who cannot help.
Those two pressures shaped everything in this chapter, and it is worth knowing which way each decision leaned.

## Getting in: one door, and it is Google's

Everyone signs in with Google. There is no password to forget or leak, because the app never sees one, and there is no
second sign-in method to keep secure. When someone signs in for the first time, the app creates an account for them
immediately as an active **Member**. There is no approval queue and no list of allowed emails in the app.

That last sentence is a decision, and a considered one ([[0002-google-only-open-access]]): the thing that decides who can finish
signing in is the **consent screen** configured in the team's Google Cloud project, which can restrict sign-in to one
organisation. The alternative, an approval queue, would put a human in the loop at the worst moment (a student standing in the
pit with a dead phone). The cost of open access is that the app trusts Google's gate, so the safety valve has to be strong:
managers can **deny** an account afterwards, which ends every session of that account at once and turns the sign-in page into
"Access turned off". Allowing it again undoes it. Denial is the lever; it is easy to use, audited, and reversible.

## What happens when you click *Continue with Google*

The sign-in is the standard OAuth/OpenID flow, written in plain Node crypto in `lib/auth/sign-in.ts` rather than with a
library, so that every check is visible and tested. In order: the app invents a one-time random **state** and **nonce** and a
**PKCE** secret, seals them in a short-lived encrypted cookie, and sends you to Google. When Google sends you back with a
one-time code, the app checks the state against the cookie (this stops someone else's sign-in being pushed onto your browser),
exchanges the code with Google server-to-server, and verifies the returned identity token: its signature against Google's
published keys, who issued it, who it was issued to, that it has not expired, that the nonce matches, and that the email is
verified. Only then does it find or create the account and start a session.

Each of those checks answers a specific attack. They are listed with their reasons in [[authentication]]; the reason to know
about them as a contributor is that **none of them is optional, and none may be loosened to make a test pass**. The test suite
includes forged tokens, wrong audiences and replayed nonces precisely so that nobody can.

## Staying in: sessions

After sign-in the browser holds a random token in a cookie. The server stores only a hash of it, so even someone who could read
the account database could not sign in as you. Every request, to a page or to an API, re-reads the session and the account, so
a change takes effect quickly: denying a person, changing their role, or signing them out everywhere does not wait for them to
come back. A session ends when it has been idle too long (a week by default) or when it reaches its maximum age (thirty days).
Signing in always starts a fresh session and ends the old one in that browser.

## Five roles, and a ladder

| Role | In one sentence |
|---|---|
| Member | Reads the dashboard. Everyone starts here. |
| Scout | Same as member; the role records who scouts. |
| Scout lead | Also sees the user list, denies or allows access, manages scouts and members. |
| Mentor | Also sees how the system is running and the audit log, and manages scout leads and below. |
| Owner | Everything, and the only one who manages mentors or changes names. |

The **Owner** is special: it is not stored as a role anyone can be given. It comes from the `AUTH_OWNER_EMAILS` setting on the
server, so there is always someone who can fix everything, and nobody can take that away (or hand it out) from inside the app.

The rules that keep a ladder honest are few and each has a reason:

- **You can only manage people strictly below you.** A scout lead cannot touch a mentor. Otherwise any promoted account could
  demote its superiors.
- **Nobody changes their own role or status.** No self-promotion, and no accidentally locking yourself out.
- **You can only give roles below your own.** Nobody can create an Owner.
- **Only the Owner changes names.** Names appear in the audit log and on records; changing them silently would defeat both.

Before a change that grants or removes mentor access, or that denies an account, the interface makes you type the person's email.
That is not a security feature (the server enforces the real rules); it is a seat belt against clicking the wrong row on a phone.

## Where checks happen, and what is only a convenience

1. `proxy.ts` sends visitors with no session cookie to the sign-in page before any work is done. It is **only a convenience**.
   It cannot tell a valid cookie from a forged one, and nothing trusts it.
2. Every **page** calls `requirePage(permission)`. This is the real check for what a person sees.
3. Every **API route** begins with `guard(request, { permission, action })`, which checks the session, the permission, and for
   anything that writes, that the request came from our own site. It audits refusals.
4. The **WebSocket** checks the same session before the connection upgrades, and again every minute while it stays open, so a
   person who is denied loses their live feed within a minute, not at their next page load.

Only the last three decide anything. The first exists so that the common case (not signed in at all) is cheap.

The browser is sent a `permissions` map, but only so it can hide buttons the server would refuse. The server never reads it back,
and a test sends forged role headers and permission maps to prove it. **If you add a feature, put its check on the server first
and hide the button second.**

## The account database is separate on purpose

Accounts, sessions and the audit log are stored in their own collection, away from the scouting data. The scouting tablets
replicate the scouting collection; if accounts lived there too, every tablet would carry everyone's email addresses and session
hashes. The app refuses to start sign-in if the two are configured to be the same place.

## The audit log

Security-relevant events (sign-ins and failures, denials, role changes, session revocations, diagnostics runs) are written to an
append-only log, and Mentors can read it. There is deliberately no way to edit or delete entries through the app. When
something odd happens at an event, the audit log is the first place to look.

## Where to go next

The live connection has to enforce all of this too: [[06-staying-live]]. Setup steps, every environment variable and the
troubleshooting table are in [[authentication]]; the reasoning for open access is [[0002-google-only-open-access]].
