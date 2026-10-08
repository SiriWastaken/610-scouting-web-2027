---
title: 12 - REALTIME UPDATES
description: How pages stay live and why stale or duplicate events cannot win
verified_at: b611a7f (2026-10-08)
sources:
  - lib/realtime/protocol.ts
  - lib/realtime/documents.ts
  - lib/realtime/client.ts
  - lib/realtime/hooks.ts
  - lib/realtime/bridge.ts
  - lib/realtime/couchbase-feed.ts
  - lib/realtime/server.ts
  - components/dashboard/live-status.tsx
---

# 12 - REALTIME UPDATES

**Previous:** [[11-staying-live]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[13-pages]]

Pages render from a snapshot plus that snapshot's `last_seq`, then follow changes from that point.

## The pipeline

1. **Server snapshot** carries `last_seq`.
2. **Browser** (`lib/realtime/client.ts`) opens `/api/realtime` and sends `{type:"subscribe", since}`.
3. **Server** (`server.ts` upgrade checks → `bridge.ts` per-connection relay → `couchbase-feed.ts` long-poll of Sync Gateway `_changes`) projects each relevant change through the privacy allow-list and sends it.
4. **Browser store** (`documents.ts`, `DocumentStore`) keeps the newest revision of every document, deletions included, and ignores duplicates and stale revisions (`compareRevs` follows Couchbase's winner rule).
5. **Hooks** (`hooks.ts`) expose it to components.

## Hooks you will use

| Hook | Use |
|---|---|
| `useAggregateRealtime(initialTeams)` | Team rows with live changes merged in |
| `useRealtimeDocuments(docs, idPattern)` | A list of REST-loaded documents with creates, updates and deletes applied |
| `useTeamDocuments(kind, team, idPattern)` | One team's `matches`, `pit` or `reports`: loads over REST (again after a resync), then applies live changes. Use this instead of fetching in a component |
| `useRealtimeResync(callback)` | Run `callback` when the feed cannot resume and REST data must be reloaded |

## Failure behaviour

- Disconnect: reconnect with backoff, resume from the last applied sequence, replay what was missed.
- Sync Gateway rejects the sequence: the server sends `resync`; pages reload their data in place.
- Session revoked or expired: the server closes with code **4401** and the browser does not retry. Sessions are re-checked every minute.

Message formats are in `lib/realtime/protocol.ts`, shared by server, browser and tests, so it must stay free of
framework imports and path aliases.
