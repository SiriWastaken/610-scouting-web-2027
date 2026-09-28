"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyRow } from "@/components/admin/status";
import { buttonClass, formatDate, inputClass, Panel } from "@/components/ui/panel";
import type { AuditEntry } from "@/lib/auth/audit";

const ACTIONS = [["", "All actions"], ["auth", "Sign-in / sign-out"], ["users", "Account changes"], ["account", "Own-profile changes"], ["ops", "Operations"], ["dashboard", "Dashboard access"], ["audit", "Audit access"]] as const;

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ action: "", result: "", q: "" });
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (filters.action) params.set("action", filters.action);
    if (filters.result) params.set("result", filters.result);
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (before) params.set("before", before);
    const response = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
    const body = await response.json() as { entries?: AuditEntry[]; next?: string | null; message?: string };
    if (!response.ok || !body.entries) throw new Error(body.message ?? `HTTP ${response.status}`);
    return { entries: body.entries, next: body.next ?? null };
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchPage().then((page) => { if (!cancelled) { setEntries(page.entries); setNext(page.next); setError(null); } }, (reason: Error) => { if (!cancelled) setError(reason.message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [fetchPage]);

  return <Panel title="Audit log" action={<span className="font-mono text-[10px] text-[var(--muted)]">append-only · newest first</span>}>
    <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-3 sm:flex-row">
      <label className="flex-1"><span className="sr-only">Search</span><input className={inputClass} placeholder="Search email, account, reason" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
      <select aria-label="Action" className={`${inputClass} sm:w-48`} value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Result" className={`${inputClass} sm:w-36`} value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}><option value="">Any result</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option></select>
    </div>
    {error && <p role="alert" className="border-b border-[var(--line)] px-5 py-3 text-sm text-red-300">{error}</p>}
    {entries === null ? <EmptyRow>Loading…</EmptyRow> : entries.length === 0 ? <EmptyRow>No entries match.</EmptyRow> : <>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs">
        <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-3 font-normal">When</th><th className="px-4 py-3 font-normal">Action</th><th className="px-4 py-3 font-normal">Result</th><th className="px-4 py-3 font-normal">Actor</th><th className="px-4 py-3 font-normal">Target</th><th className="px-4 py-3 font-normal">Details</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-t border-[var(--line)] align-top" data-audit-action={entry.action}>
          <td className="whitespace-nowrap px-5 py-2.5 text-[var(--muted)]" title={entry.at}>{formatDate(entry.at)}</td>
          <td className="px-4 py-2.5 font-mono">{entry.action}</td>
          <td className={`px-4 py-2.5 font-mono uppercase ${entry.result === "success" ? "text-[var(--green)]" : entry.result === "denied" ? "text-amber-300" : "text-red-400"}`}><span aria-hidden="true">{entry.result === "success" ? "● " : entry.result === "denied" ? "⊘ " : "✕ "}</span>{entry.result}</td>
          <td className="px-4 py-2.5">{entry.actor ? <>{entry.actor.email ?? entry.actor.id}{entry.actor.role && <span className="block font-mono text-[10px] text-[var(--muted)]">{entry.actor.role}</span>}</> : <span className="text-[var(--muted)]">anonymous</span>}</td>
          <td className="px-4 py-2.5">{entry.target ? entry.target.label ?? entry.target.id ?? entry.target.type : "—"}</td>
          <td className="px-4 py-2.5 text-[var(--muted)]">{entry.reason && <span className="block text-[var(--foreground)]">{entry.reason}</span>}{entry.meta && Object.entries(entry.meta).map(([key, value]) => <span key={key} className="mr-3 inline-block font-mono">{key}={String(value)}</span>)}</td>
        </tr>)}</tbody>
      </table></div>
      {next && <div className="border-t border-[var(--line)] px-5 py-3"><button type="button" className={buttonClass} disabled={loadingMore} onClick={async () => {
        setLoadingMore(true);
        try { const page = await fetchPage(next); setEntries([...entries, ...page.entries]); setNext(page.next); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't load more"); } finally { setLoadingMore(false); }
      }}>{loadingMore ? "Loading…" : "Load older entries"}</button></div>}
    </>}
  </Panel>;
}
