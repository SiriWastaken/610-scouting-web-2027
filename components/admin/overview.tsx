"use client";

import Link from "next/link";
import { FreshnessBar } from "@/components/admin/admin-tabs";
import { useOps } from "@/components/admin/ops-provider";
import { EmptyRow, StatTile, StatusPill, TileGrid, statusText } from "@/components/admin/status";
import type { Check, CheckName } from "@/components/admin/types";
import { formatDate, formatDuration, Panel } from "@/components/ui/panel";
import { useNow } from "@/components/ui/use-now";

const CARDS: Array<{ key: Exclude<CheckName, "persistence">; title: string; href?: string }> = [
  { key: "api", title: "API", href: "/admin/api" },
  { key: "syncGateway", title: "Sync Gateway", href: "/admin/sync" },
  { key: "couchbase", title: "Couchbase", href: "/admin/sync" },
  { key: "realtime", title: "WebSockets", href: "/admin/realtime" },
  { key: "accountStore", title: "Account store", href: "/admin/sync" },
  { key: "auth", title: "Authentication", href: "/admin/users" },
];

export function CheckCard({ title, check, href }: { title: string; check: Check | undefined; href?: string }) {
  const body = <>
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{title}</span>
      {check ? <StatusPill status={check.status} /> : <span className="font-mono text-[10px] text-[var(--muted)]">…</span>}
    </div>
    <p className="mt-2 min-h-10 text-xs leading-5 text-[var(--muted)]">{check?.summary ?? "Checking…"}</p>
    <div className="mt-2 flex justify-between font-mono text-[10px] text-[#64736a]"><span>{check?.latencyMs != null ? `${check.latencyMs} ms` : ""}</span><span>{check ? `checked ${formatDate(check.checkedAt, { relative: true })}` : ""}</span></div>
  </>;
  const className = "block bg-[var(--panel)] px-4 py-4";
  return href ? <Link href={href} className={`${className} hover:bg-[var(--panel-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--green)]`} data-check={title}>{body}</Link> : <div className={className} data-check={title}>{body}</div>;
}

export function Overview() {
  const { data, error, loading } = useOps();
  const now = useNow();
  if (loading && !data) return <Panel title="System"><EmptyRow>Running health checks…</EmptyRow></Panel>;
  const m = data?.metrics;
  const recentErrors = m?.errors.filter((entry) => now - entry.at < 15 * 60_000).length ?? 0;
  return <div className="space-y-5">
    <div className={`flex flex-wrap items-center justify-between gap-3 border px-5 py-4 ${!data || error ? "border-red-400/50 bg-red-400/5" : data.overall === "ok" ? "border-[rgba(120,192,145,0.4)] bg-[rgba(120,192,145,0.06)]" : data.overall === "down" ? "border-red-400/50 bg-red-400/5" : "border-amber-400/40 bg-amber-400/5"}`} data-overall={data?.overall ?? "down"}>
      <div className="flex items-center gap-3">
        {data && !error ? <StatusPill status={data.overall} /> : <StatusPill status="down" label="No answer" />}
        <span className="text-sm">{!data || error ? "The API is not answering this browser." : data.overall === "ok" ? "All systems are working." : `Something needs attention: ${Object.entries(data.checks).filter(([, check]) => check.status !== "ok" && check.status !== "idle").map(([name]) => CARDS.find((card) => card.key === name)?.title ?? name).join(", ")}.`}</span>
      </div>
      <FreshnessBar />
    </div>

    <div className="grid grid-cols-1 gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((card) => <CheckCard key={card.key} title={card.title} check={data?.checks[card.key]} href={card.href} />)}
    </div>

    <TileGrid>
      <StatTile label="Live clients" value={m?.realtime.activeConnections ?? "—"} hint="WebSocket connections now" />
      <StatTile label="Changes delivered" value={m?.realtime.changesSent ?? "—"} hint={m?.realtime.lastChangeAt ? `last ${formatDate(m.realtime.lastChangeAt, { relative: true })}` : "none yet"} />
      <StatTile label="Sign-ins" value={m?.auth.signIns ?? "—"} hint={m?.auth.signInFailures ? `${m.auth.signInFailures} failed` : "no failures"} tone={m?.auth.signInFailures ? "warn" : "normal"} />
      <StatTile label="Errors (15 min)" value={recentErrors} tone={recentErrors ? "bad" : "good"} hint={m?.errors[0] ? `latest ${formatDate(m.errors[0].at, { relative: true })}` : "none recorded"} />
    </TileGrid>

    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <Panel title="Server">
        {data ? <dl className="grid grid-cols-2 gap-px bg-[var(--line)] text-sm">
          {[
            ["Version", `${data.server.version}${data.server.commit ? ` · ${data.server.commit}` : ""}`],
            ["Built", formatDate(data.server.builtAt)],
            ["Environment", `${data.server.environment} (${data.server.platform})`],
            ["Uptime", formatDuration(data.server.uptimeMs)],
            ["Server time", new Date(data.server.serverTime).toLocaleTimeString()],
            ["Node.js", data.server.nodeVersion],
            ["Memory", `${data.server.memoryMb} MB`],
            ["Started", formatDate(data.server.startedAt)],
          ].map(([label, value]) => <div key={label} className="bg-[var(--panel)] px-4 py-3"><dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</dt><dd className="mt-1 truncate font-mono text-xs" title={String(value)}>{value}</dd></div>)}
        </dl> : <EmptyRow>No server information.</EmptyRow>}
        {data?.server.platform === "vercel" && <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]">Counters are per server instance. On Vercel each request may reach a different instance.</p>}
      </Panel>
      <Panel title="Recent errors" action={<span className="font-mono text-[10px] text-[var(--muted)]">last 50, this process</span>}>
        {!m || m.errors.length === 0 ? <EmptyRow>No errors recorded since the server started {data ? formatDate(data.server.startedAt, { relative: true }) : ""}.</EmptyRow> :
          <ul className="max-h-80 overflow-y-auto">{m.errors.slice(0, 20).map((entry, index) => <li key={index} className="border-t border-[var(--line)] px-5 py-2.5 first:border-t-0">
            <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-wider"><span className="text-red-300">{entry.source}</span><span className="text-[var(--muted)]">{formatDate(entry.at, { relative: true })}</span></div>
            <div className="mt-1 break-words text-xs text-[var(--foreground)]">{entry.message}{entry.path && <span className="text-[var(--muted)]"> · {entry.path}</span>}</div>
          </li>)}</ul>}
      </Panel>
    </div>
    <p className="text-xs text-[#64736a]">Status legend: {(["ok", "degraded", "down", "idle", "unknown", "unconfigured"] as const).map((status) => statusText(status)).join(" · ")}. Health checks query Sync Gateway and the account store directly (cached 10 s); counters are measured by this server process.</p>
  </div>;
}
