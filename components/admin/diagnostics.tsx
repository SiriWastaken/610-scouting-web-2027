"use client";

import { useState } from "react";
import { useOps } from "@/components/admin/ops-provider";
import { SelfTestResult, useWebSocketSelfTest } from "@/components/admin/realtime-monitor";
import { StatusPill } from "@/components/admin/status";
import type { CheckStatus, Overview } from "@/components/admin/types";
import { formatDate, Panel, primaryButtonClass, buttonClass } from "@/components/ui/panel";
import { useNow } from "@/components/ui/use-now";

interface Answer { question: string; status: CheckStatus; answer: string }

/** The questions an admin asks at an event, answered from measured server data only. */
function answers(data: Overview | null, apiError: string | null, clientLatencyMs: number | null, now: number): Answer[] {
  if (!data) return [{ question: "Is the API alive?", status: "down", answer: apiError ?? "No answer yet" }];
  const { checks, metrics } = data;
  const r = metrics.realtime; const up = metrics.upstream;
  const recentErrors = metrics.errors.filter((entry) => now - entry.at < 15 * 60_000);
  const olderErrors = metrics.errors.filter((entry) => now - entry.at >= 15 * 60_000 && now - entry.at < 60 * 60_000);
  const lastSync = Math.max(up.lastPollOkAt ?? 0, metrics.snapshot.lastOkAt ?? 0);
  const reconnectShare = r.opened ? r.reconnects / r.opened : 0;
  return [
    { question: "Is the API alive?", status: apiError ? "down" : checks.api.status, answer: apiError ?? `Yes. ${checks.api.summary}${clientLatencyMs !== null ? ` Round trip ${clientLatencyMs} ms.` : ""}` },
    { question: "Is Sync Gateway healthy?", status: checks.syncGateway.status, answer: checks.syncGateway.summary },
    { question: "Is Couchbase reachable?", status: checks.couchbase.status, answer: checks.couchbase.summary },
    { question: "Are WebSockets connected?", status: checks.realtime.status, answer: checks.realtime.summary },
    { question: "How many clients are connected?", status: r.activeConnections ? "ok" : "idle", answer: `${r.activeConnections} now; ${r.opened} connections since the server started.` },
    { question: "Are clients reconnecting repeatedly?", status: r.opened > 5 && reconnectShare > 0.5 ? "degraded" : "ok", answer: r.opened ? `${r.reconnects} of ${r.opened} connections (${Math.round(reconnectShare * 100)}%) were the same account back within a minute.` : "No connections yet." },
    { question: "Are events being generated?", status: up.uniqueChanges > 0 ? "ok" : "idle", answer: up.uniqueChanges > 0 ? `${up.uniqueChanges} new database sequences seen; latest ${up.lastUniqueSeq}.` : "No new database changes seen since the server started (normal before scouting begins)." },
    { question: "Are events being delivered?", status: r.changesSent > 0 ? "ok" : "idle", answer: r.changesSent > 0 ? `${r.changesSent} changes delivered to browsers; last ${r.lastChangeId} ${formatDate(r.lastChangeAt, { relative: true })}.` : "Nothing delivered yet." },
    { question: "Are errors increasing?", status: recentErrors.length > olderErrors.length && recentErrors.length > 0 ? "degraded" : recentErrors.length ? "degraded" : "ok", answer: `${recentErrors.length} in the last 15 minutes, ${olderErrors.length} in the 45 minutes before.` },
    { question: "Is authentication working?", status: checks.auth.status, answer: `${checks.auth.summary}. ${metrics.auth.signIns} sign-ins, ${metrics.auth.signInFailures} failures since start.` },
    { question: "Is data actually being persisted?", status: checks.persistence?.status ?? "idle", answer: checks.persistence?.summary ?? "Run full diagnostics to write, read back, and delete a test document in the account store." },
    { question: "When was the last successful synchronization?", status: lastSync && now - lastSync < 120_000 ? "ok" : lastSync ? "degraded" : "idle", answer: lastSync ? formatDate(lastSync, { relative: true }) : "No sync has happened since the server started." },
    { question: "What failed most recently?", status: metrics.errors[0] ? "degraded" : "ok", answer: metrics.errors[0] ? `${metrics.errors[0].source}: ${metrics.errors[0].message} (${formatDate(metrics.errors[0].at, { relative: true })})` : "Nothing has failed since the server started." },
  ];
}

export function Diagnostics() {
  const { data, error, clientLatencyMs, replace } = useOps();
  const { result, run } = useWebSocketSelfTest();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const now = useNow();

  const runAll = async () => {
    setRunning(true); setRunError(null);
    try {
      const [response] = await Promise.all([fetch("/api/admin/diagnostics", { method: "POST" }), run()]);
      const body = await response.json() as Overview & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      replace(body); setRanAt(Date.now());
    } catch (reason) { setRunError(reason instanceof Error ? reason.message : "Diagnostics failed"); }
    finally { setRunning(false); }
  };

  return <div className="space-y-5">
    <Panel title="Run checks" action={ranAt ? <span className="text-xs text-[var(--muted)]">last run {formatDate(ranAt, { relative: true })}</span> : undefined}>
      <div className="space-y-3 px-5 py-5">
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primaryButtonClass} onClick={() => void runAll()} disabled={running}>{running ? "Running…" : "Run full diagnostics"}</button>
          <button type="button" className={buttonClass} onClick={() => void run()} disabled={result?.status === "running"}>WebSocket self-test only</button>
        </div>
        <SelfTestResult result={result} />
        {runError && <p role="alert" className="text-sm text-red-300">{runError}</p>}
        <p className="text-xs text-[var(--muted)]">Full diagnostics re-run every server check without the cache, write and delete one test document in the account store, and open a WebSocket from this browser. Scouting data is never written.</p>
      </div>
    </Panel>
    <Panel title="Event-day checklist">
      <ul>{answers(data, error, clientLatencyMs, now).map((item) => <li key={item.question} className="grid gap-2 border-t border-[var(--line)] px-5 py-3 first:border-t-0 sm:grid-cols-[260px_130px_1fr] sm:items-center" data-question={item.question}>
        <span className="text-sm">{item.question}</span>
        <span><StatusPill status={item.status} /></span>
        <span className="text-xs text-[var(--muted)]">{item.answer}</span>
      </li>)}</ul>
    </Panel>
  </div>;
}
