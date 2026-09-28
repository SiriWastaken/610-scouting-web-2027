"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/auth/avatar";
import { AccountStatusBadge, RoleBadge } from "@/components/auth/role-badge";
import { EmptyRow } from "@/components/admin/status";
import { buttonClass, formatDate, inputClass, Panel, primaryButtonClass } from "@/components/ui/panel";
import { ROLE_LABELS, ROLES, type AccountStatus, type Role } from "@/lib/auth/roles";

export interface AdminUser {
  id: string; email: string; displayName: string; picture: string | null; role: Role; status: AccountStatus; rootLocked: boolean;
  providers: string[]; lastSignInProvider: string | null; scoutName: string | null; createdAt: string; lastSignInAt: string | null;
  adminNote: string | null; activeSessions: number; scouting: { submissions: number; lastSubmittedAt: string | null } | null;
  manageable: boolean; assignableRoles: Role[];
}

export function UsersTable() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | Role>("all");
  const [status, setStatus] = useState<"all" | AccountStatus>("all");
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await response.json() as { users?: AdminUser[]; message?: string };
      if (!response.ok || !body.users) throw new Error(body.message ?? `HTTP ${response.status}`);
      setUsers(body.users); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't load accounts"); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const approve = async (user: AdminUser) => {
    setApproving(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
      if (!response.ok) setError(((await response.json()) as { message?: string }).message ?? "Couldn't approve");
      await load();
    } finally { setApproving(null); }
  };

  const filtered = useMemo(() => (users ?? []).filter((user) => {
    const text = query.trim().toLowerCase();
    return (role === "all" || user.role === role) && (status === "all" || user.status === status)
      && (!text || [user.displayName, user.email, user.scoutName].some((value) => value?.toLowerCase().includes(text)));
  }), [users, query, role, status]);
  const pending = users?.filter((user) => user.status === "pending").length ?? 0;

  return <div className="space-y-5">
    {pending > 0 && <div className="flex items-center gap-3 border border-amber-400/40 bg-amber-400/5 px-5 py-3 text-sm" role="status"><span aria-hidden="true" className="text-amber-300">◐</span>{pending} account{pending === 1 ? "" : "s"} waiting for approval.</div>}
    <Panel title={`Accounts${users ? ` (${users.length})` : ""}`} action={<button type="button" className={buttonClass} onClick={() => void load()}>Refresh</button>}>
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-3 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search accounts</span><input className={inputClass} placeholder="Search name, email, or scout name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="sr-only" htmlFor="role-filter">Role</label>
        <select id="role-filter" value={role} onChange={(event) => setRole(event.target.value as "all" | Role)} className={`${inputClass} sm:w-40`}><option value="all">All roles</option>{ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
        <label className="sr-only" htmlFor="status-filter">Status</label>
        <select id="status-filter" value={status} onChange={(event) => setStatus(event.target.value as "all" | AccountStatus)} className={`${inputClass} sm:w-36`}><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="disabled">Disabled</option></select>
      </div>
      {error && <p role="alert" className="border-b border-[var(--line)] px-5 py-3 text-sm text-red-300">{error}</p>}
      {users === null ? <EmptyRow>Loading accounts…</EmptyRow> : filtered.length === 0 ? <EmptyRow>{users.length === 0 ? "Nobody has signed in yet." : "No accounts match these filters."}</EmptyRow> :
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-3 font-normal">Person</th><th className="px-4 py-3 font-normal">Role</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3 font-normal">Last sign-in</th><th className="px-4 py-3 font-normal">Scouting</th><th className="px-4 py-3 font-normal">Sessions</th><th className="px-4 py-3 font-normal"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{filtered.map((user) => <tr key={user.id} className="border-t border-[var(--line)] hover:bg-[var(--panel-raised)]" data-user-row={user.email}>
            <td className="px-5 py-3"><Link href={`/admin/users/${user.id}`} className="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">
              <Avatar name={user.displayName} picture={user.picture} provider={user.lastSignInProvider} size={32} />
              <span className="min-w-0"><span className="block truncate">{user.displayName}</span><span className="block truncate text-xs text-[var(--muted)]">{user.email}</span></span>
            </Link></td>
            <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
            <td className="px-4 py-3"><AccountStatusBadge status={user.status} /></td>
            <td className="px-4 py-3 text-xs text-[var(--muted)]">{user.lastSignInAt ? formatDate(user.lastSignInAt, { relative: true }) : "never"}</td>
            <td className="px-4 py-3 text-xs text-[var(--muted)]">{user.scoutName ? <>{user.scoutName}<span className="block font-mono">{user.scouting?.submissions ?? 0} matches</span></> : "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">{user.activeSessions}</td>
            <td className="px-4 py-3 text-right">{user.status === "pending" && user.manageable
              ? <button type="button" className={primaryButtonClass} disabled={approving === user.id} onClick={() => void approve(user)}>{approving === user.id ? "Approving…" : "Approve"}</button>
              : <Link href={`/admin/users/${user.id}`} className="text-xs text-[var(--green)] hover:underline">{user.manageable ? "Manage" : "View"}</Link>}</td>
          </tr>)}</tbody>
        </table></div>}
    </Panel>
  </div>;
}
