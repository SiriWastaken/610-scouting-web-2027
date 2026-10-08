"use client";

import { useCallback, useEffect, useState } from "react";
import { buttonClass, EmptyRow, formatDate, inputClass, Panel, selectClass } from "@/components/ui/kit";
import type { AuditEntry } from "@/lib/auth/audit";

const ACTIONS = [["", "All actions"], ["auth", "Sign-in / sign-out"], ["users", "Account changes"], ["account", "Own-profile changes"], ["ops", "Operations"], ["dashboard", "Dashboard access"], ["audit", "Audit access"]] as const;

interface Filters { action: string; result: string; q: string }

/** Audit entries matching `filters` (refetched, debounced, when they change), newest first, with paging for older ones. */
function useAuditEntries(filters: Filters) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const loadMore = async () => {
    if (!next || !entries) return;
    setLoadingMore(true);
    try { const page = await fetchPage(next); setEntries([...entries, ...page.entries]); setNext(page.next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't load more"); }
    finally { setLoadingMore(false); }
  };

  return { entries, next, error, loadingMore, loadMore };
}

export function AuditLog() {
  const [filters, setFilters] = useState<Filters>({ action: "", result: "", q: "" });
  const { entries, next, error, loadingMore, loadMore } = useAuditEntries(filters);

  return <Panel title="Audit log" action={<span className="font-mono text-xs text-muted">append-only · newest first</span>}>
    <AuditFilters filters={filters} onChange={setFilters} />
    {error && <p role="alert" className="border-b border-line px-5 py-3 text-sm text-bad">{error}</p>}
    {entries === null ? <EmptyRow>Loading…</EmptyRow> : entries.length === 0 ? <EmptyRow>No entries match.</EmptyRow> : <>
      <AuditTable entries={entries} />
      {next && <div className="border-t border-line px-5 py-3"><button type="button" className={buttonClass} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load older entries"}</button></div>}
    </>}
  </Panel>;
}

function AuditFilters({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  return <div className="flex flex-col gap-3 border-b border-line px-5 py-3 sm:flex-row">
    <label className="flex-1"><span className="sr-only">Search</span><input className={inputClass} placeholder="Search email, account, reason" value={filters.q} onChange={(event) => onChange({ ...filters, q: event.target.value })} /></label>
    <select aria-label="Action" className={`${selectClass} sm:w-48`} value={filters.action} onChange={(event) => onChange({ ...filters, action: event.target.value })}>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <select aria-label="Result" className={`${selectClass} sm:w-36`} value={filters.result} onChange={(event) => onChange({ ...filters, result: event.target.value })}><option value="">Any result</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option></select>
  </div>;
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs">
    <thead className="border-b border-line text-xs font-medium text-muted"><tr><th className="px-5 py-3">When</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Details</th></tr></thead>
    <tbody>{entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)}</tbody>
  </table></div>;
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return <tr className="border-t border-line align-top" data-audit-action={entry.action}>
    <td className="whitespace-nowrap px-5 py-2.5 text-muted" title={entry.at}>{formatDate(entry.at)}</td>
    <td className="px-4 py-2.5 font-mono">{entry.action}</td>
    <td className={`px-4 py-2.5 font-mono capitalize ${entry.result === "success" ? "text-accent-text" : entry.result === "denied" ? "text-warn" : "text-bad"}`}><span aria-hidden="true">{entry.result === "success" ? "● " : entry.result === "denied" ? "⊘ " : "✕ "}</span>{entry.result}</td>
    <td className="px-4 py-2.5">{entry.actor ? <>{entry.actor.email ?? entry.actor.id}{entry.actor.role && <span className="block font-mono text-xs text-muted">{entry.actor.role}</span>}</> : <span className="text-muted">anonymous</span>}</td>
    <td className="px-4 py-2.5">{entry.target ? entry.target.label ?? entry.target.id ?? entry.target.type : "—"}</td>
    <td className="px-4 py-2.5 text-muted">{entry.reason && <span className="block text-ink">{entry.reason}</span>}{entry.meta && Object.entries(entry.meta).map(([key, value]) => <span key={key} className="mr-3 inline-block font-mono">{key}={String(value)}</span>)}</td>
  </tr>;
}
