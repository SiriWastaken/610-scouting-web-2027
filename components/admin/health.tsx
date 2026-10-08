"use client";

// Admin → Overview, Sync, API, and Diagnostics: system health from the shared
// overview data, plus the event-day checklist and on-demand checks.
import Link from "next/link";
import { useState } from "react";
import { SelfTestResult, useWebSocketSelfTest } from "@/components/admin/realtime";
import { FreshnessBar, useNow, useOps, type Check, type CheckName, type CheckStatus, type Overview } from "@/components/admin/shell";
import { buttonClass, EmptyRow, FactGrid, formatDate, formatDuration, Panel, primaryButtonClass, StatTile, StatusPill, statusText, TileGrid } from "@/components/ui/kit";

type Metrics = Overview["metrics"];

// ── Overview ──

const CARDS: Array<{ key: Exclude<CheckName, "persistence">; title: string; href?: string }> = [
  { key: "api", title: "API", href: "/admin/api" },
  { key: "syncGateway", title: "Sync Gateway", href: "/admin/sync" },
  { key: "couchbase", title: "Couchbase", href: "/admin/sync" },
  { key: "realtime", title: "WebSockets", href: "/admin/realtime" },
  { key: "accountStore", title: "Account store", href: "/admin/sync" },
  { key: "auth", title: "Authentication", href: "/admin/users" },
];

function CheckCard({ title, check, href }: { title: string; check: Check | undefined; href?: string }) {
  const body = <>
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{title}</span>
      {check ? <StatusPill status={check.status} /> : <span className="font-mono text-xs text-muted">…</span>}
    </div>
    <p className="mt-2 min-h-10 text-xs leading-5 text-muted">{check?.summary ?? "Checking…"}</p>
    <div className="mt-2 flex justify-between font-mono text-xs text-muted"><span>{check?.latencyMs != null ? `${check.latencyMs} ms` : ""}</span><span>{check ? `checked ${formatDate(check.checkedAt, { relative: true })}` : ""}</span></div>
  </>;
  const className = "block bg-surface px-4 py-4";
  return href ? <Link href={href} className={`${className} hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`} data-check={title}>{body}</Link> : <div className={className} data-check={title}>{body}</div>;
}

const RECENT_ERROR_MS = 15 * 60_000;

/**
 * Admin → Overview: overall status, one card per check, headline numbers, server facts and recent 
 * errors.
 */
export function Overview() {
  const { data, error, loading } = useOps();
  const now = useNow();
  if (loading && !data) return <Panel title="System"><EmptyRow>Running health checks…</EmptyRow></Panel>;
  const m = data?.metrics;
  const recentErrors = m?.errors.filter((entry) => now - entry.at < RECENT_ERROR_MS).length ?? 0;
  return <div className="space-y-5">
    <OverallBanner data={data} error={error} />
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((card) => <CheckCard key={card.key} title={card.title} check={data?.checks[card.key]} href={card.href} />)}
    </div>
    <OverviewTiles m={m} recentErrors={recentErrors} />
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <ServerPanel data={data} />
      <RecentErrorsPanel data={data} />
    </div>
    <p className="text-xs text-muted">Status legend: {(["ok", "degraded", "down", "idle", "unknown", "unconfigured"] as const).map((status) => statusText(status)).join(" · ")}. Health checks query Sync Gateway and the account store directly (cached 10 s); counters are measured by this server process.</p>
  </div>;
}

function bannerTone(data: Overview | null, error: string | null) {
  if (!data || error || data.overall === "down") return "border-bad/40 bg-bad-soft";
  return data.overall === "ok" ? "border-good/30 bg-good-soft" : "border-warn/40 bg-warn-soft";
}

function bannerText(data: Overview | null, error: string | null) {
  if (!data || error) return "The API is not answering this browser.";
  if (data.overall === "ok") return "All systems are working.";
  const failing = Object.entries(data.checks).filter(([, check]) => check.status !== "ok" && check.status !== "idle").map(([name]) => CARDS.find((card) => card.key === name)?.title ?? name);
  return `Something needs attention: ${failing.join(", ")}.`;
}

function OverallBanner({ data, error }: { data: Overview | null; error: string | null }) {
  return <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-4 ${bannerTone(data, error)}`} data-overall={data?.overall ?? "down"}>
    <div className="flex items-center gap-3">
      {data && !error ? <StatusPill status={data.overall} /> : <StatusPill status="down" label="No answer" />}
      <span className="text-sm">{bannerText(data, error)}</span>
    </div>
    <FreshnessBar />
  </div>;
}

function OverviewTiles({ m, recentErrors }: { m: Metrics | undefined; recentErrors: number }) {
  return <TileGrid>
    <StatTile label="Live clients" value={m?.realtime.activeConnections ?? "—"} hint="WebSocket connections now" />
    <StatTile label="Changes delivered" value={m?.realtime.changesSent ?? "—"} hint={m?.realtime.lastChangeAt ? `last ${formatDate(m.realtime.lastChangeAt, { relative: true })}` : "none yet"} />
    <StatTile label="Sign-ins" value={m?.auth.signIns ?? "—"} hint={m?.auth.signInFailures ? `${m.auth.signInFailures} failed` : "no failures"} tone={m?.auth.signInFailures ? "warn" : "normal"} />
    <StatTile label="Errors (15 min)" value={recentErrors} tone={recentErrors ? "bad" : "good"} hint={m?.errors[0] ? `latest ${formatDate(m.errors[0].at, { relative: true })}` : "none recorded"} />
  </TileGrid>;
}

function ServerPanel({ data }: { data: Overview | null }) {
  const server = data?.server;
  return <Panel title="Server">
    {server ? <FactGrid className="text-sm" valueClassName="mt-1 truncate font-mono text-xs" titled facts={[
      ["Version", `${server.version}${server.commit ? ` · ${server.commit}` : ""}`],
      ["Built", formatDate(server.builtAt)],
      ["Environment", `${server.environment} (${server.platform})`],
      ["Uptime", formatDuration(server.uptimeMs)],
      ["Server time", new Date(server.serverTime).toLocaleTimeString()],
      ["Node.js", server.nodeVersion],
      ["Memory", `${server.memoryMb} MB`],
      ["Started", formatDate(server.startedAt)],
    ]} /> : <EmptyRow>No server information.</EmptyRow>}
    {server?.platform === "vercel" && <p className="border-t border-line px-4 py-3 text-xs text-muted">Counters are per server instance. On Vercel each request may reach a different instance.</p>}
  </Panel>;
}

function RecentErrorsPanel({ data }: { data: Overview | null }) {
  const errors = data?.metrics.errors ?? [];
  return <Panel title="Recent errors" action={<span className="font-mono text-xs text-muted">last 50, this process</span>}>
    {errors.length === 0 ? <EmptyRow>No errors recorded since the server started {data ? formatDate(data.server.startedAt, { relative: true }) : ""}.</EmptyRow> :
      <ul className="max-h-80 overflow-y-auto">{errors.slice(0, 20).map((entry, index) => <li key={index} className="border-t border-line px-5 py-2.5 first:border-t-0">
        <div className="flex justify-between gap-3 text-xs font-semibold"><span className="text-bad">{entry.source}</span><span className="text-muted">{formatDate(entry.at, { relative: true })}</span></div>
        <div className="mt-1 break-words text-xs text-ink">{entry.message}{entry.path && <span className="text-muted"> · {entry.path}</span>}</div>
      </li>)}</ul>}
  </Panel>;
}

// ── Sync monitor ──

const KIND_LABEL: Record<string, string> = { scouting: "Match records", aggregate: "Team aggregates", pit: "Pit records", report: "Card reports", other: "Other documents" };

/** Admin → Sync: Sync Gateway and Couchbase health, the server snapshot, and document counts. */
export function SyncMonitor() {
  const { data, loading } = useOps();
  if (loading && !data) return <Panel title="Synchronization"><EmptyRow>Loading…</EmptyRow></Panel>;
  const snapshot = data?.metrics.snapshot;
  return <div className="space-y-5">
    <div className="flex justify-end"><FreshnessBar /></div>
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
      <CheckCard title="Sync Gateway" check={data?.checks.syncGateway} />
      <CheckCard title="Couchbase (via Sync Gateway)" check={data?.checks.couchbase} />
      <CheckCard title="Account store" check={data?.checks.accountStore} />
    </div>
    <SyncTiles data={data} />
    <div className="grid gap-5 lg:grid-cols-2">
      <SnapshotPanel snapshot={snapshot} />
      <KindsPanel byKind={snapshot?.byKind} />
    </div>
    <SyncLimits />
  </div>;
}

function SyncTiles({ data }: { data: Overview | null }) {
  const now = useNow();
  const snapshot = data?.metrics.snapshot;
  const upstream = data?.metrics.upstream;
  const lastSync = Math.max(upstream?.lastPollOkAt ?? 0, snapshot?.lastOkAt ?? 0) || null;
  return <TileGrid>
    <StatTile label="Last successful sync" value={lastSync ? formatDate(lastSync, { relative: true }) : "never"} hint="newest answer from Sync Gateway" tone={lastSync && now - lastSync < 120_000 ? "good" : "warn"} />
    <StatTile label="Database sequence" value={(data?.checks.syncGateway.details?.updateSeq as string | undefined) ?? "—"} hint="update_seq reported by Sync Gateway" />
    <StatTile label="Sync Gateway latency" value={data?.checks.syncGateway.latencyMs != null ? `${data.checks.syncGateway.latencyMs} ms` : "—"} hint="root + database request" />
    <StatTile label="Feed failures" value={upstream?.pollErrors ?? "—"} hint={upstream?.lastPollErrorAt ? `last ${formatDate(upstream.lastPollErrorAt, { relative: true })}` : "none"} tone={upstream?.pollErrors ? "warn" : "good"} />
  </TileGrid>;
}

function SnapshotPanel({ snapshot }: { snapshot: Metrics["snapshot"] | undefined }) {
  return <Panel title="Server snapshot" action={<span className="font-mono text-xs text-muted">what pages render from</span>}>
    <FactGrid facts={[["Last fetched", formatDate(snapshot?.lastOkAt, { relative: true })], ["Fetch time", snapshot?.durationMs != null ? `${snapshot.durationMs} ms` : "—"], ["Documents", snapshot?.documents ?? "—"], ["Feed sequence", snapshot?.lastSeq ?? "—"], ["Fetches", snapshot?.fetches ?? 0], ["Failed fetches", snapshot?.failures ?? 0]]} />
    {snapshot?.lastError && <p className="border-t border-line px-5 py-3 text-xs text-bad">Last failure {formatDate(snapshot.lastErrorAt, { relative: true })}: {snapshot.lastError}</p>}
  </Panel>;
}

function KindsPanel({ byKind }: { byKind: Record<string, number> | null | undefined }) {
  return <Panel title="Documents by type">
    {!byKind ? <EmptyRow>No snapshot has been fetched yet. Open a dashboard page to fetch one.</EmptyRow> :
      <table className="w-full text-left text-sm"><tbody>{Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([kind, count]) => <tr key={kind} className="border-t border-line first:border-t-0"><td className="px-5 py-2.5">{KIND_LABEL[kind] ?? kind}</td><td className="px-5 py-2.5 text-right font-mono tabular-nums">{count}</td></tr>)}</tbody></table>}
  </Panel>;
}

function SyncLimits() {
  return <Panel title="What this can and cannot see">
    <ul className="list-disc space-y-1.5 px-9 py-4 text-xs leading-5 text-muted">
      <li>Scouting tablets replicate straight to Sync Gateway, not through this server, so per-tablet replication status is not visible here. A new database sequence and &quot;changes delivered&quot; confirm that tablet writes are arriving.</li>
      <li>Couchbase Server is only reachable through Sync Gateway; its health is Sync Gateway&apos;s database state (&quot;Online&quot; means the bucket is connected).</li>
      <li>The snapshot is cached for 20 s and fetched on demand by page loads, so &quot;last fetched&quot; can be older when nobody is browsing.</li>
    </ul>
  </Panel>;
}

// ── Api monitor ──

export function ApiMonitor() {
  const { data, error, loading, clientLatencyMs } = useOps();
  if (loading && !data) return <Panel title="API"><EmptyRow>Loading…</EmptyRow></Panel>;
  const http = data?.metrics.http;
  return <div className="space-y-5">
    <Panel title="Availability" action={<FreshnessBar />}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
        {error ? <StatusPill status="down" label="Not answering" /> : data ? <StatusPill status={data.checks.api.status} /> : null}
        <span>{error ?? data?.checks.api.summary}</span>
        {clientLatencyMs !== null && <span className="font-mono text-xs text-muted">round trip from this browser {clientLatencyMs} ms</span>}
      </div>
    </Panel>
    {http && !http.measured ? <Panel title="Traffic"><EmptyRow>Request counts are recorded by the Node server (<code>npm start</code>). This deployment ({data?.server.platform}) does not run it, so traffic is not measured here; use the hosting platform&apos;s logs.</EmptyRow></Panel> : <TrafficPanels http={http} />}
    <ServicesPanel data={data} />
  </div>;
}

function TrafficPanels({ http }: { http: Metrics["http"] | undefined }) {
  const errorRate = http && http.requests ? (http.byClass["5xx"] / http.requests) * 100 : 0;
  return <>
    <TileGrid>
      <StatTile label="Requests" value={http?.requests ?? "—"} hint={http?.lastRequestAt ? `last ${formatDate(http.lastRequestAt, { relative: true })}` : undefined} />
      <StatTile label="Server errors (5xx)" value={http?.byClass["5xx"] ?? "—"} hint={`${errorRate.toFixed(2)}% of requests`} tone={http?.byClass["5xx"] ? "bad" : "good"} />
      <StatTile label="Client errors (4xx)" value={http?.byClass["4xx"] ?? "—"} hint="includes refused sign-ins and 404s" />
      <StatTile label="Latency p50 / p95" value={http?.latencyMs.p50 != null ? `${http.latencyMs.p50} / ${http.latencyMs.p95} ms` : "—"} hint={http?.latencyMs.samples ? `p99 ${http.latencyMs.p99} ms · last ${http.latencyMs.samples} requests` : undefined} />
    </TileGrid>
    <Panel title="Busiest routes">
      {!http || http.routes.length === 0 ? <EmptyRow>No requests yet.</EmptyRow> :
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs">
          <thead className="border-b border-line text-xs font-medium text-muted"><tr><th className="px-5 py-3">Route</th><th className="px-4 py-3 text-right">Requests</th><th className="px-4 py-3 text-right">5xx</th><th className="px-4 py-3 text-right">Avg ms</th></tr></thead>
          <tbody>{http.routes.map((route) => <tr key={route.route} className="border-t border-line"><td className="px-5 py-2.5 font-mono">{route.route}</td><td className="px-4 py-2.5 text-right font-mono tabular-nums">{route.count}</td><td className={`px-4 py-2.5 text-right font-mono tabular-nums ${route.errors ? "text-bad" : "text-muted"}`}>{route.errors}</td><td className="px-4 py-2.5 text-right font-mono tabular-nums">{route.avgMs}</td></tr>)}</tbody>
        </table></div>}
    </Panel>
  </>;
}

function ServicesPanel({ data }: { data: Overview | null }) {
  const services = data ? ([["Scouting data (Sync Gateway)", data.checks.syncGateway], ["Accounts and sessions", data.checks.accountStore], ["Realtime feed", data.checks.realtime], ["Sign-in", data.checks.auth]] as const) : [];
  return <Panel title="Services">
    <table className="w-full text-left text-sm"><tbody>
      {services.map(([name, check]) => <tr key={name} className="border-t border-line first:border-t-0"><td className="px-5 py-3">{name}</td><td className="px-4 py-3"><StatusPill status={check.status} /></td><td className="px-4 py-3 text-xs text-muted">{check.summary}</td></tr>)}
    </tbody></table>
  </Panel>;
}

// ── Diagnostics ──

interface Answer { question: string; status: CheckStatus; answer: string }

/** The questions an admin asks at an event, answered from measured server data only. */
function answers(data: Overview | null, apiError: string | null, clientLatencyMs: number | null, now: number): Answer[] {
  if (!data) return [{ question: "Is the API alive?", status: "down", answer: apiError ?? "No answer yet" }];
  const { checks } = data;
  return [
    { question: "Is the API alive?", status: apiError ? "down" : checks.api.status, answer: apiError ?? `Yes. ${checks.api.summary}${clientLatencyMs !== null ? ` Round trip ${clientLatencyMs} ms.` : ""}` },
    { question: "Is Sync Gateway healthy?", status: checks.syncGateway.status, answer: checks.syncGateway.summary },
    { question: "Is Couchbase reachable?", status: checks.couchbase.status, answer: checks.couchbase.summary },
    { question: "Are WebSockets connected?", status: checks.realtime.status, answer: checks.realtime.summary },
    ...trafficAnswers(data.metrics),
    ...healthAnswers(data, now),
  ];
}

function trafficAnswers({ realtime: r, upstream: up }: Metrics): Answer[] {
  const reconnectShare = r.opened ? r.reconnects / r.opened : 0;
  return [
    { question: "How many clients are connected?", status: r.activeConnections ? "ok" : "idle", answer: `${r.activeConnections} now; ${r.opened} connections since the server started.` },
    { question: "Are clients reconnecting repeatedly?", status: r.opened > 5 && reconnectShare > 0.5 ? "degraded" : "ok", answer: r.opened ? `${r.reconnects} of ${r.opened} connections (${Math.round(reconnectShare * 100)}%) were the same account back within a minute.` : "No connections yet." },
    { question: "Are events being generated?", status: up.uniqueChanges > 0 ? "ok" : "idle", answer: up.uniqueChanges > 0 ? `${up.uniqueChanges} new database sequences seen; latest ${up.lastUniqueSeq}.` : "No new database changes seen since the server started (normal before scouting begins)." },
    { question: "Are events being delivered?", status: r.changesSent > 0 ? "ok" : "idle", answer: r.changesSent > 0 ? `${r.changesSent} changes delivered to browsers; last ${r.lastChangeId} ${formatDate(r.lastChangeAt, { relative: true })}.` : "Nothing delivered yet." },
  ];
}

function healthAnswers({ checks, metrics }: Overview, now: number): Answer[] {
  const recentErrors = metrics.errors.filter((entry) => now - entry.at < RECENT_ERROR_MS);
  const olderErrors = metrics.errors.filter((entry) => now - entry.at >= RECENT_ERROR_MS && now - entry.at < 60 * 60_000);
  const lastSync = Math.max(metrics.upstream.lastPollOkAt ?? 0, metrics.snapshot.lastOkAt ?? 0);
  const latest = metrics.errors[0];
  return [
    { question: "Are errors increasing?", status: recentErrors.length ? "degraded" : "ok", answer: `${recentErrors.length} in the last 15 minutes, ${olderErrors.length} in the 45 minutes before.` },
    { question: "Is authentication working?", status: checks.auth.status, answer: `${checks.auth.summary}. ${metrics.auth.signIns} sign-ins, ${metrics.auth.signInFailures} failures since start.` },
    { question: "Is data actually being persisted?", status: checks.persistence?.status ?? "idle", answer: checks.persistence?.summary ?? "Run full diagnostics to write, read back, and delete a test document in the account store." },
    { question: "When was the last successful synchronization?", status: lastSync && now - lastSync < 120_000 ? "ok" : lastSync ? "degraded" : "idle", answer: lastSync ? formatDate(lastSync, { relative: true }) : "No sync has happened since the server started." },
    { question: "What failed most recently?", status: latest ? "degraded" : "ok", answer: latest ? `${latest.source}: ${latest.message} (${formatDate(latest.at, { relative: true })})` : "Nothing has failed since the server started." },
  ];
}

/** Runs every server check plus the WebSocket self-test, and shows the fresh result everywhere. */
function useFullDiagnostics(run: () => Promise<unknown>) {
  const { replace } = useOps();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const runAll = async () => {
    setRunning(true); setError(null);
    try {
      const [response] = await Promise.all([fetch("/api/admin/diagnostics", { method: "POST" }), run()]);
      const body = await response.json() as Overview & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      replace(body); setRanAt(Date.now());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnostics failed"); }
    finally { setRunning(false); }
  };
  return { running, error, ranAt, runAll };
}

/** Admin → Diagnostics: run the checks on demand and read the event-day checklist. */
export function Diagnostics() {
  const { data, error, clientLatencyMs } = useOps();
  const { result, run } = useWebSocketSelfTest();
  const { running, error: runError, ranAt, runAll } = useFullDiagnostics(run);
  const now = useNow();

  return <div className="space-y-5">
    <Panel title="Run checks" action={ranAt ? <span className="text-xs text-muted">last run {formatDate(ranAt, { relative: true })}</span> : undefined}>
      <div className="space-y-3 px-5 py-5">
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primaryButtonClass} onClick={() => void runAll()} disabled={running}>{running ? "Running…" : "Run full diagnostics"}</button>
          <button type="button" className={buttonClass} onClick={() => void run()} disabled={result?.status === "running"}>WebSocket self-test only</button>
        </div>
        <SelfTestResult result={result} />
        {runError && <p role="alert" className="text-sm text-bad">{runError}</p>}
        <p className="text-xs text-muted">Full diagnostics re-run every server check without the cache, write and delete one test document in the account store, and open a WebSocket from this browser. Scouting data is never written.</p>
      </div>
    </Panel>
    <Panel title="Event-day checklist">
      <ul>{answers(data, error, clientLatencyMs, now).map((item) => <li key={item.question} className="grid gap-2 border-t border-line px-5 py-3 first:border-t-0 sm:grid-cols-[260px_130px_1fr] sm:items-center" data-question={item.question}>
        <span className="text-sm">{item.question}</span>
        <span><StatusPill status={item.status} /></span>
        <span className="text-xs text-muted">{item.answer}</span>
      </li>)}</ul>
    </Panel>
  </div>;
}
