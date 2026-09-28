// The single source of truth for what the test bench must execute.
//
// Every `*.test.ts` file under tests/ must be listed here, and every listed file
// must report at least `min` passing tests. A run where a file is missing,
// fails to load, reports fewer tests than its floor, or skips anything fails.
// Lowering a floor or removing a file is therefore a visible, reviewable change
// to this file rather than something that can happen by accident.

export const suites = {
  unit: {
    description: "Pure logic: protocol parsing, privacy projection, revision ordering, stores, aggregate normalisation, client state machine, properties",
    timeoutMs: 20_000,
    files: {
      "tests/testTemplate.test.ts": 3,
      "tests/unit/config/couchbase-config.test.ts": 3,
      "tests/unit/data/aggregate-normalization.test.ts": 18,
      "tests/unit/data/match-data-sanitizer.test.ts": 4,
      "tests/unit/data/sync-invariants.property.test.ts": 7,
      "tests/unit/realtime/bridge-store-longpoll.test.ts": 22,
      "tests/unit/realtime/client-connection-state.test.ts": 15,
      "tests/unit/realtime/protocol-and-privacy.test.ts": 15,
    },
  },
  integration: {
    description: "Real HTTP and WebSocket sockets against the fake Sync Gateway: REST API, persistence read-back, statistics, realtime sync, failure injection, concurrency",
    timeoutMs: 60_000,
    files: {
      "tests/integration/api/dashboard-documents-api.test.ts": 9,
      "tests/integration/data/scouting-statistics.test.ts": 3,
      "tests/integration/realtime/live-sync-over-sockets.test.ts": 12,
      "tests/integration/resilience/concurrent-writes.test.ts": 6,
      "tests/integration/resilience/failure-injection.test.ts": 13,
    },
  },
  security: {
    description: "Adversarial and fuzz inputs, trust boundaries (origin, read-only API, field privacy, credential handling)",
    timeoutMs: 60_000,
    files: {
      "tests/security/adversarial-inputs.test.ts": 11,
      "tests/security/trust-boundaries.test.ts": 8,
    },
  },
  contract: {
    description: "Sync Gateway behaviour the app relies on; runs against the fake and, in CI, a real Couchbase Server + Sync Gateway",
    timeoutMs: 120_000,
    files: {
      "tests/contract/sync-gateway.contract.test.ts": 13,
    },
  },
  stress: {
    description: "Realistic event-sized datasets, many simultaneous WebSocket clients, event bursts",
    timeoutMs: 180_000,
    serial: true,
    files: {
      "tests/stress/realtime-load.test.ts": 3,
    },
  },
  e2e: {
    description: "The built app (`npm start` server) driven over HTTP, WebSocket, and a real Chromium browser",
    timeoutMs: 180_000,
    serial: true,
    requires: ["build", "chromium"],
    files: {
      "tests/e2e/server-http-and-websocket.e2e.test.ts": 7,
      "tests/e2e/browser-scouting-workflows.e2e.test.ts": 8,
      "tests/e2e/browser-failure-recovery.e2e.test.ts": 3,
    },
  },
};

/**
 * Against a real Sync Gateway only target-agnostic files run: fault injection
 * needs the fake. These runs are additive to the fake runs, never a substitute.
 */
export const realTargetFiles = new Set([
  "tests/contract/sync-gateway.contract.test.ts",
  "tests/e2e/browser-scouting-workflows.e2e.test.ts",
]);

/** Suites measured for coverage (in one merged run). */
export const coverageSuites = ["unit", "integration", "security", "contract"];

/**
 * Per-file coverage floors for the code that decides what users see and what
 * leaves the server. Thresholds sit a few points under what the suites reach
 * today so refactors have room, but a change that stops exercising a whole
 * branch of this code fails. See tests/README.md ("Coverage") for the reasoning.
 */
export const coverage = {
  include: ["lib/**", "services/**", "app/api/**"],
  // React hook wrappers: exercised through the browser E2E suite, which runs in a separate process.
  exclude: ["lib/use-realtime.ts"],
  // [lines, branches, functions] %, set ~3-5 points under what the suites reach.
  files: {
    // What the browser may receive and trust: parsing, the privacy allow-list, revision order.
    "lib/realtime-protocol.ts": { lines: 97, branches: 94, functions: 95 },
    "lib/realtime-store.ts": { lines: 97, branches: 88, functions: 95 },
    // Every dashboard statistic and team row.
    "lib/normalize-aggregate.ts": { lines: 97, branches: 94, functions: 95 },
    "lib/match-data.ts": { lines: 97, branches: 94, functions: 95 },
    // The synchronisation path: server bridge, upstream long-poll, upgrade handler, browser client.
    "lib/realtime-bridge.ts": { lines: 97, branches: 90, functions: 95 },
    "lib/couchbase-longpoll.ts": { lines: 97, branches: 85, functions: 85 },
    // Branch floor is lower: several branches are defensive (malformed request URLs the ws server never produces).
    "lib/realtime-server.ts": { lines: 95, branches: 65, functions: 95 },
    // defaultUrl() needs a browser `location`; the rest of the state machine is covered.
    "lib/realtime-client.ts": { lines: 92, branches: 90, functions: 72 },
    "lib/couchbase-config.ts": { lines: 97, branches: 95, functions: 95 },
    // API input validation.
    "app/api/dashboard-documents/route.ts": { lines: 97, branches: 95, functions: 95 },
    // The upgrade itself runs only inside Vercel's runtime; its origin and configuration checks are covered.
    "app/api/realtime/route.ts": { lines: 70, branches: 75, functions: 45 },
    // Persistence reads. Four exported helpers are unused by the app (queryDocsByType,
    // listDocumentTypes, queryDocsByIdPrefix, fetchTeamAggregates), which caps line coverage.
    "services/couchbase.ts": { lines: 70, branches: 85, functions: 75 },
  },
};
