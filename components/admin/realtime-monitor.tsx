"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FreshnessBar } from "@/components/admin/admin-tabs";
import { useOps } from "@/components/admin/ops-provider";
import { EmptyRow, StatTile, StatusPill, TileGrid } from "@/components/admin/status";
import type { CheckStatus, Overview } from "@/components/admin/types";
import { buttonClass, formatDate, formatDuration, Panel } from "@/components/ui/panel";

interface SelfTest { status: "running" | "ok" | "failed"; openMs?: number; readyMs?: number; detail: string }

/** Where a self-test connection should start reading: the newest sequence the server knows, so it replays nothing. */
function currentCursor(data: Overview | null): string {
  return data?.metrics.realtime.lastSeq ?? data?.snapshot?.lastSeq ?? (data?.checks.syncGateway.details?.updateSeq as string | undefined) ?? "0";
}

/**
 * Opens a real WebSocket from this browser through the same endpoint the
 * dashboard uses (origin check, session check, upstream feed) and times it.
 */
export function useWebSocketSelfTest() {
  const { data } = useOps();
  const [result, setResult] = useState<SelfTest | null>(null);
  const run = () => new Promise<SelfTest>((resolve) => {
    setResult({ status: "running", detail: "Connecting…" });
    const started = performance.now();
    let openMs: number | undefined;
    let done = false;
    // Closing the socket after a result fires its close event; only the first outcome counts.
    const finish = (value: SelfTest) => { if (done) return; done = true; clearTimeout(timer); try { socket.close(1000, "Self-test done"); } catch { /* already closed */ } setResult(value); resolve(value); };
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/realtime`);
    const timer = setTimeout(() => finish({ status: "failed", openMs, detail: openMs === undefined ? "No connection after 15 s" : "Connected, but the feed did not become ready within 15 s" }), 15_000);
    socket.addEventListener("open", () => { openMs = Math.round(performance.now() - started); socket.send(JSON.stringify({ type: "subscribe", since: currentCursor(data) })); });
    socket.addEventListener("message", (event) => {
      let message: { type?: string } = {};
      try { message = JSON.parse(String(event.data)); } catch { /* ignored */ }
      if (message.type === "ready") finish({ status: "ok", openMs, readyMs: Math.round(performance.now() - started), detail: "Connected and receiving the live feed" });
      if (message.type === "error") finish({ status: "failed", openMs, detail: "The server could not start the database feed" });
    });
    socket.addEventListener("close", (event) => finish({ status: "failed", openMs, detail: event.code === 1006 ? "The server refused or dropped the connection (check sign-in, origin, and server logs)" : `Closed with code ${event.code}${event.reason ? ` (${event.reason})` : ""}` }));
  });
  return { result, run };
}

export function SelfTestResult({ result }: { result: SelfTest | null }) {
  if (!result) return null;
  const status: CheckStatus = result.status === "ok" ? "ok" : result.status === "failed" ? "down" : "idle";
  return <div className="flex flex-wrap items-center gap-3 text-sm" role="status" data-selftest={result.status}>
    <StatusPill status={status} label={result.status === "running" ? "Running" : result.status === "ok" ? "Passed" : "Failed"} />
    <span>{result.detail}</span>
    {result.openMs !== undefined && <span className="font-mono text-xs text-[var(--muted)]">open {result.openMs} ms{result.readyMs !== undefined ? ` · ready ${result.readyMs} ms` : ""}</span>}
  </div>;
}

export function RealtimeMonitor() {
  const { data, loading } = useOps();
  const { result, run } = useWebSocketSelfTest();
  const [filter, setFilter] = useState("all");
  const r = data?.metrics.realtime;
  const up = data?.metrics.upstream;
  const check = data?.checks.realtime;
  const eventTypes = useMemo(() => [...new Set(r?.events.map((event) => event.type) ?? [])].sort(), [r]);
  const events = (r?.events ?? []).filter((event) => filter === "all" || event.type === filter);
  if (loading && !data) return <Panel title="Realtime"><EmptyRow>Loading…</EmptyRow></Panel>;
  const rejected = r ? Object.values(r.rejected).reduce((sum, value) => sum + value, 0) : 0;

  return <div className="space-y-5">
    <Panel title="Are WebSockets working right now?" action={<FreshnessBar />}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">{check ? <StatusPill status={check.status} /> : null}<span className="text-sm">{check?.summary ?? "No data"}</span></div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass} onClick={() => void run()} disabled={result?.status === "running"}>Run WebSocket self-test</button>
          <SelfTestResult result={result} />
        </div>
        <p className="text-xs text-[var(--muted)]">The self-test opens a real connection from this browser through the dashboard&apos;s endpoint (origin and session checks, then the database feed) and closes it once the server reports ready.</p>
      </div>
    </Panel>

    <TileGrid>
      <StatTile label="Active connections" value={r?.activeConnections ?? "—"} tone={r?.activeConnections ? "good" : "normal"} />
      <StatTile label="Connected / closed" value={r ? `${r.opened} / ${r.closed}` : "—"} hint="since server start" />
      <StatTile label="Reconnects" value={r?.reconnects ?? "—"} hint="same user back within 60 s" tone={r && r.opened > 5 && r.reconnects / r.opened > 0.5 ? "warn" : "normal"} />
      <StatTile label="Connection length" value={r?.durationMs.p50 != null ? formatDuration(r.durationMs.p50) : "—"} hint={r?.durationMs.p95 != null ? `p95 ${formatDuration(r.durationMs.p95)} · ${r.durationMs.samples} closed` : "no closed connections"} />
      <StatTile label="Changes delivered" value={r?.changesSent ?? "—"} hint={r?.lastChangeAt ? `${r.lastChangeId} ${formatDate(r.lastChangeAt, { relative: true })}` : "none yet"} />
      <StatTile label="Frames sent" value={r?.framesSent ?? "—"} hint={r?.lastSeq ? `last sequence ${r.lastSeq}` : undefined} />
      <StatTile label="Refused upgrades" value={rejected} hint={r ? `origin ${r.rejected.origin} · sign-in ${r.rejected.auth} · full ${r.rejected.capacity} · unconfigured ${r.rejected.unconfigured}` : undefined} tone={r && r.rejected.origin + r.rejected.capacity > 0 ? "warn" : "normal"} />
      <StatTile label="Errors" value={r ? r.feedErrors + r.sendErrors : "—"} hint={r ? `feed ${r.feedErrors} · send ${r.sendErrors} · resync ${r.resyncs} · malformed ${r.invalidSubscriptions} · timeouts ${r.subscriptionTimeouts} · sessions ended ${r.sessionEnded}` : undefined} tone={r && r.feedErrors + r.sendErrors > 0 ? "bad" : "good"} />
    </TileGrid>

    <Panel title="Upstream changes feed" action={<span className="font-mono text-[10px] text-[var(--muted)]">Sync Gateway _changes</span>}>
      <dl className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
        {[["Responses", up?.polls ?? "—"], ["Failed requests", up?.pollErrors ?? "—"], ["Last answer", formatDate(up?.lastPollOkAt, { relative: true })], ["New database sequences seen", up?.uniqueChanges ?? "—"]].map(([label, value]) => <div key={String(label)} className="bg-[var(--panel)] px-4 py-3"><dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</dt><dd className="mt-1 font-mono text-sm">{value}</dd></div>)}
      </dl>
      {up?.lastPollError && <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-red-300">Last failure {formatDate(up.lastPollErrorAt, { relative: true })}: {up.lastPollError}</p>}
    </Panel>

    <Panel title={`Open connections (${r?.connections.length ?? 0})`}>
      {!r || r.connections.length === 0 ? <EmptyRow>No browsers are connected to this server right now.</EmptyRow> :
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-3 font-normal">#</th><th className="px-4 py-3 font-normal">Account</th><th className="px-4 py-3 font-normal">Connected for</th><th className="px-4 py-3 font-normal">From sequence</th><th className="px-4 py-3 font-normal">Frames / changes</th><th className="px-4 py-3 font-normal">Last frame</th></tr></thead>
          <tbody>{r.connections.map((connection) => <tr key={connection.id} className="border-t border-[var(--line)]">
            <td className="px-5 py-2.5 font-mono text-[var(--muted)]">{connection.id}</td>
            <td className="px-4 py-2.5">{connection.userId ? <Link className="text-[var(--green)] hover:underline" href={`/admin/users/${connection.userId}`}>{connection.role ?? "user"}</Link> : "—"}</td>
            <td className="px-4 py-2.5 font-mono">{formatDuration(connection.ageMs)}</td>
            <td className="px-4 py-2.5 font-mono text-[var(--muted)]">{connection.since ?? (connection.subscribedAt ? "—" : "not subscribed")}</td>
            <td className="px-4 py-2.5 font-mono">{connection.framesSent} / {connection.changesSent}</td>
            <td className="px-4 py-2.5 text-[var(--muted)]">{formatDate(connection.lastFrameAt, { relative: true })}</td>
          </tr>)}</tbody>
        </table></div>}
    </Panel>

    <Panel title="Recent events" action={<label className="flex items-center gap-2 text-xs text-[var(--muted)]">Type
      <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-8 rounded-sm border border-[var(--line)] bg-[#0f1412] px-2 text-xs text-[var(--foreground)]">
        <option value="all">All</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>}>
      {events.length === 0 ? <EmptyRow>No events recorded yet.</EmptyRow> :
        <div className="max-h-96 overflow-y-auto"><table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-2 font-normal">Time</th><th className="px-4 py-2 font-normal">Event</th><th className="px-4 py-2 font-normal">Conn.</th><th className="px-4 py-2 font-normal">Detail</th></tr></thead>
          <tbody>{events.slice(0, 100).map((event, index) => <tr key={index} className="border-t border-[var(--line)]">
            <td className="whitespace-nowrap px-5 py-2 font-mono text-[var(--muted)]">{new Date(event.at).toLocaleTimeString()}</td>
            <td className={`px-4 py-2 font-mono ${/error|rejected|malformed|timeout|resync/.test(event.type) ? "text-amber-300" : "text-[var(--foreground)]"}`}>{event.type}</td>
            <td className="px-4 py-2 font-mono text-[var(--muted)]">{event.connection ?? ""}</td>
            <td className="px-4 py-2 text-[var(--muted)]">{event.detail ?? ""}</td>
          </tr>)}</tbody>
        </table></div>}
    </Panel>
    <p className="text-xs text-[#64736a]">Counts cover this server process since it started. The server cannot see a browser&apos;s own retry attempts, so reconnects are counted when the same account connects again within a minute of disconnecting.</p>
  </div>;
}
