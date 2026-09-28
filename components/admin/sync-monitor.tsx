"use client";

import { FreshnessBar } from "@/components/admin/admin-tabs";
import { CheckCard } from "@/components/admin/overview";
import { useOps } from "@/components/admin/ops-provider";
import { EmptyRow, StatTile, TileGrid } from "@/components/admin/status";
import { formatDate, Panel } from "@/components/ui/panel";
import { useNow } from "@/components/ui/use-now";

const KIND_LABEL: Record<string, string> = { scouting: "Match records", aggregate: "Team aggregates", pit: "Pit records", report: "Card reports", other: "Other documents" };

export function SyncMonitor() {
  const { data, loading } = useOps();
  const now = useNow();
  if (loading && !data) return <Panel title="Synchronization"><EmptyRow>Loading…</EmptyRow></Panel>;
  const snapshot = data?.metrics.snapshot;
  const upstream = data?.metrics.upstream;
  const lastSync = Math.max(upstream?.lastPollOkAt ?? 0, snapshot?.lastOkAt ?? 0) || null;
  return <div className="space-y-5">
    <div className="flex justify-end"><FreshnessBar /></div>
    <div className="grid grid-cols-1 gap-px border border-[var(--line)] bg-[var(--line)] md:grid-cols-3">
      <CheckCard title="Sync Gateway" check={data?.checks.syncGateway} />
      <CheckCard title="Couchbase (via Sync Gateway)" check={data?.checks.couchbase} />
      <CheckCard title="Account store" check={data?.checks.accountStore} />
    </div>

    <TileGrid>
      <StatTile label="Last successful sync" value={lastSync ? formatDate(lastSync, { relative: true }) : "never"} hint="newest answer from Sync Gateway" tone={lastSync && now - lastSync < 120_000 ? "good" : "warn"} />
      <StatTile label="Database sequence" value={(data?.checks.syncGateway.details?.updateSeq as string | undefined) ?? "—"} hint="update_seq reported by Sync Gateway" />
      <StatTile label="Sync Gateway latency" value={data?.checks.syncGateway.latencyMs != null ? `${data.checks.syncGateway.latencyMs} ms` : "—"} hint="root + database request" />
      <StatTile label="Feed failures" value={upstream?.pollErrors ?? "—"} hint={upstream?.lastPollErrorAt ? `last ${formatDate(upstream.lastPollErrorAt, { relative: true })}` : "none"} tone={upstream?.pollErrors ? "warn" : "good"} />
    </TileGrid>

    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Server snapshot" action={<span className="font-mono text-[10px] text-[var(--muted)]">what pages render from</span>}>
        <dl className="grid grid-cols-2 gap-px bg-[var(--line)]">
          {[["Last fetched", formatDate(snapshot?.lastOkAt, { relative: true })], ["Fetch time", snapshot?.durationMs != null ? `${snapshot.durationMs} ms` : "—"], ["Documents", snapshot?.documents ?? "—"], ["Feed sequence", snapshot?.lastSeq ?? "—"], ["Fetches", snapshot?.fetches ?? 0], ["Failed fetches", snapshot?.failures ?? 0]].map(([label, value]) => <div key={String(label)} className="bg-[var(--panel)] px-4 py-3"><dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</dt><dd className="mt-1 font-mono text-sm">{value}</dd></div>)}
        </dl>
        {snapshot?.lastError && <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-red-300">Last failure {formatDate(snapshot.lastErrorAt, { relative: true })}: {snapshot.lastError}</p>}
      </Panel>
      <Panel title="Documents by type">
        {!snapshot?.byKind ? <EmptyRow>No snapshot has been fetched yet. Open a dashboard page to fetch one.</EmptyRow> :
          <table className="w-full text-left text-sm"><tbody>{Object.entries(snapshot.byKind).sort((a, b) => b[1] - a[1]).map(([kind, count]) => <tr key={kind} className="border-t border-[var(--line)] first:border-t-0"><td className="px-5 py-2.5">{KIND_LABEL[kind] ?? kind}</td><td className="px-5 py-2.5 text-right font-mono tabular-nums">{count}</td></tr>)}</tbody></table>}
      </Panel>
    </div>

    <Panel title="What this can and cannot see">
      <ul className="list-disc space-y-1.5 px-9 py-4 text-xs leading-5 text-[var(--muted)]">
        <li>Scouting tablets replicate straight to Sync Gateway, not through this server, so per-tablet replication status is not visible here. A new database sequence and &quot;changes delivered&quot; confirm that tablet writes are arriving.</li>
        <li>Couchbase Server is only reachable through Sync Gateway; its health is Sync Gateway&apos;s database state (&quot;Online&quot; means the bucket is connected).</li>
        <li>The snapshot is cached for 20 s and fetched on demand by page loads, so &quot;last fetched&quot; can be older when nobody is browsing.</li>
      </ul>
    </Panel>
  </div>;
}
