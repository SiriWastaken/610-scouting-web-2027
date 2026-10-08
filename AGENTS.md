<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design workflow: Figma first

The UI is designed in Figma before it is coded. File: https://www.figma.com/design/fQIqpLCiOv4lxWA2tsaMb3/610-Scouting-Website-2027---DESIGN (key `fQIqpLCiOv4lxWA2tsaMb3`), reached through the Figma MCP.

- **A UI change starts in Figma.** Make the change in the Figma file, then stop and show the maintainer what changed. Do not edit UI code (anything under `app/`, `components/`, or styling in `app/globals.css`) until they approve it.
- **After approval, make the code match Figma.** Use the design as written. Do not improvise the visuals.
- **Keep the two in sync.** If you change the code's look or behaviour with approval, update the Figma file in the same piece of work.
- **Read the live file before editing it.** The maintainer edits it too. Change only what the task needs, and never overwrite their edits.
- **Structure of the Figma file.** Pages: Foundations (tokens, type, icons), Components, Screens, Screens (Dark), Mobile. Colours are `Color` variables (Light and Dark modes; each variable's description holds the matching CSS variable). Screens use the shared components and text styles instead of hand-drawn pieces.
- **Access model (decided).** Anyone who signs in with Google and passes the Google OAuth client is approved automatically. Sign-in is Google only (no Apple). Mentors, scout leads and the Owner can deny an account's access afterwards from the admin Users page, and allow it again later.

# Validating changes

The test bench is documented in `tests/README.md`. Run `npm run validate:fast` before and after a change, and `npm run validate` before opening a PR. A change is done only when it ends with `✔ TEST BENCH PASSED`. Never skip, focus, or delete tests, lower a floor in `scripts/test-bench/manifest.mjs`, or edit a hand-computed expectation to get a green run. New behaviour needs a test: start from `tests/testTemplate.test.ts`.
