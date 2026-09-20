# 610 Scouting Web

Next.js web platform for Team 610 scouting analysis. The Teams, Averages, and Box Plot pages read aggregate data from Couchbase through the server-only repository at `services/couchbase.ts`.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Couchbase configuration

Copy `.env.example` to `.env.local` and provide the Sync Gateway connection details:

```env
COUCHBASE_SYNC_GATEWAY_URL=https://your-sync-gateway-host:4984
COUCHBASE_DATABASE=scoutingapp2026
COUCHBASE_USERNAME=your-username
COUCHBASE_PASSWORD=your-password
COUCHBASE_SCOPE=_default
COUCHBASE_COLLECTION=_default
```

The repository reads `aggregate_data` documents and uses `pit` documents to enrich team names. No mock data is loaded when Couchbase is not configured; the data pages show an explicit empty state instead.

## Checks

```bash
npm run lint
npm run build
```
