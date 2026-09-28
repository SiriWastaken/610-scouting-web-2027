"use client";

import { FreshnessBar } from "@/components/admin/admin-tabs";
import { useOps } from "@/components/admin/ops-provider";
import { EmptyRow, StatTile, StatusPill, TileGrid } from "@/components/admin/status";
import { formatDate, Panel } from "@/components/ui/panel";

export function ApiMonitor() {
  const { data, error, loading, clientLatencyMs } = useOps();
  if (loading && !data) return <Panel title="API"><EmptyRow>Loading…</EmptyRow></Panel>;
  const http = data?.metrics.http;
  const errorRate = http && http.requests ? (http.byClass["5xx"] / http.requests) * 100 : 0;
  return <div className="space-y-5">
    <Panel title="Availability" action={<FreshnessBar />}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
        {error ? <StatusPill status="down" label="Not answering" /> : data ? <StatusPill status={data.checks.api.status} /> : null}
        <span>{error ?? data?.checks.api.summary}</span>
        {clientLatencyMs !== null && <span className="font-mono text-xs text-[var(--muted)]">round trip from this browser {clientLatencyMs} ms</span>}
      </div>
    </Panel>
    {http && !http.measured ? <Panel title="Traffic"><EmptyRow>Request counts are recorded by the Node server (<code>npm start</code>). This deployment ({data?.server.platform}) does not run it, so traffic is not measured here; use the hosting platform&apos;s logs.</EmptyRow></Panel> : <>
      <TileGrid>
        <StatTile label="Requests" value={http?.requests ?? "—"} hint={http?.lastRequestAt ? `last ${formatDate(http.lastRequestAt, { relative: true })}` : undefined} />
        <StatTile label="Server errors (5xx)" value={http?.byClass["5xx"] ?? "—"} hint={`${errorRate.toFixed(2)}% of requests`} tone={http?.byClass["5xx"] ? "bad" : "good"} />
        <StatTile label="Client errors (4xx)" value={http?.byClass["4xx"] ?? "—"} hint="includes refused sign-ins and 404s" />
        <StatTile label="Latency p50 / p95" value={http?.latencyMs.p50 != null ? `${http.latencyMs.p50} / ${http.latencyMs.p95} ms` : "—"} hint={http?.latencyMs.samples ? `p99 ${http.latencyMs.p99} ms · last ${http.latencyMs.samples} requests` : undefined} />
      </TileGrid>
      <Panel title="Busiest routes">
        {!http || http.routes.length === 0 ? <EmptyRow>No requests yet.</EmptyRow> :
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-3 font-normal">Route</th><th className="px-4 py-3 text-right font-normal">Requests</th><th className="px-4 py-3 text-right font-normal">5xx</th><th className="px-4 py-3 text-right font-normal">Avg ms</th></tr></thead>
            <tbody>{http.routes.map((route) => <tr key={route.route} className="border-t border-[var(--line)]"><td className="px-5 py-2.5 font-mono">{route.route}</td><td className="px-4 py-2.5 text-right font-mono tabular-nums">{route.count}</td><td className={`px-4 py-2.5 text-right font-mono tabular-nums ${route.errors ? "text-red-400" : "text-[var(--muted)]"}`}>{route.errors}</td><td className="px-4 py-2.5 text-right font-mono tabular-nums">{route.avgMs}</td></tr>)}</tbody>
          </table></div>}
      </Panel>
    </>}
    <Panel title="Services">
      <table className="w-full text-left text-sm"><tbody>
        {data && ([["Scouting data (Sync Gateway)", data.checks.syncGateway], ["Accounts and sessions", data.checks.accountStore], ["Realtime feed", data.checks.realtime], ["Sign-in", data.checks.auth]] as const).map(([name, check]) => <tr key={name} className="border-t border-[var(--line)] first:border-t-0"><td className="px-5 py-3">{name}</td><td className="px-4 py-3"><StatusPill status={check.status} /></td><td className="px-4 py-3 text-xs text-[var(--muted)]">{check.summary}</td></tr>)}
      </tbody></table>
    </Panel>
  </div>;
}
