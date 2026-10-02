"use client";

// Admin → Users: the account list (search, filters, approve) and one account's
// page (names, note, role, status, sessions, history). The server decides what
// each viewer may change; this only hides what it would refuse.
import Link from "next/link";
import { ArrowLeft, Hourglass } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AccountStatusBadge, Avatar, ProviderIcon, providerLabel, RoleBadge } from "@/components/auth/identity";
import { useSession } from "@/components/auth/session";
import { buttonClass, dangerButtonClass, EmptyRow, Field, formatDate, inputClass, Panel, primaryButtonClass } from "@/components/ui/kit";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, roleRank, type AccountStatus, type Role } from "@/lib/auth/roles";
import type { AuditEntry } from "@/lib/auth/audit";

// ── Users table ──

export interface AdminUser {
  id: string; email: string; displayName: string; picture: string | null; role: Role; status: AccountStatus;
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
    {pending > 0 && <div className="flex items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-5 py-3 text-sm" role="status"><Hourglass className="h-4 w-4 text-warn" aria-hidden="true" />{pending} account{pending === 1 ? "" : "s"} waiting for approval.</div>}
    <Panel title={`Accounts${users ? ` (${users.length})` : ""}`} action={<button type="button" className={buttonClass} onClick={() => void load()}>Refresh</button>}>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search accounts</span><input className={inputClass} placeholder="Search name, email, or scout name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="sr-only" htmlFor="role-filter">Role</label>
        <select id="role-filter" value={role} onChange={(event) => setRole(event.target.value as "all" | Role)} className={`${inputClass} sm:w-40`}><option value="all">All roles</option>{ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
        <label className="sr-only" htmlFor="status-filter">Status</label>
        <select id="status-filter" value={status} onChange={(event) => setStatus(event.target.value as "all" | AccountStatus)} className={`${inputClass} sm:w-36`}><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="disabled">Disabled</option></select>
      </div>
      {error && <p role="alert" className="border-b border-line px-5 py-3 text-sm text-bad">{error}</p>}
      {users === null ? <EmptyRow>Loading accounts…</EmptyRow> : filtered.length === 0 ? <EmptyRow>{users.length === 0 ? "Nobody has signed in yet." : "No accounts match these filters."}</EmptyRow> :
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted"><tr><th className="px-5 py-3">Person</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last sign-in</th><th className="px-4 py-3">Scouting</th><th className="px-4 py-3">Sessions</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{filtered.map((user) => <tr key={user.id} className="border-t border-line hover:bg-surface-2" data-user-row={user.email}>
            <td className="px-5 py-3"><Link href={`/admin/users/${user.id}`} className="flex items-center gap-3">
              <Avatar name={user.displayName} picture={user.picture} provider={user.lastSignInProvider} size={32} />
              <span className="min-w-0"><span className="block truncate">{user.displayName}</span><span className="block truncate text-xs text-muted">{user.email}</span></span>
            </Link></td>
            <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
            <td className="px-4 py-3"><AccountStatusBadge status={user.status} /></td>
            <td className="px-4 py-3 text-xs text-muted">{user.lastSignInAt ? formatDate(user.lastSignInAt, { relative: true }) : "never"}</td>
            <td className="px-4 py-3 text-xs text-muted">{user.scoutName ? <>{user.scoutName}<span className="block font-mono">{user.scouting?.submissions ?? 0} matches</span></> : "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">{user.activeSessions}</td>
            <td className="px-4 py-3 text-right">{user.status === "pending" && user.manageable
              ? <button type="button" className={primaryButtonClass} disabled={approving === user.id} onClick={() => void approve(user)}>{approving === user.id ? "Approving…" : "Approve"}</button>
              : <Link href={`/admin/users/${user.id}`} className="text-xs text-accent-text hover:underline">{user.manageable ? "Manage" : "View"}</Link>}</td>
          </tr>)}</tbody>
        </table></div>}
    </Panel>
  </div>;
}

// ── User detail ──

interface Detail {
  user: Omit<AdminUser, "activeSessions" | "scouting" | "manageable" | "assignableRoles"> & { rev: string; providerName: string | null; approvedBy: string | null; approvedAt: string | null; updatedAt: string };
  sessions: Array<{ provider: string; device: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }>;
  scouting: { submissions: number; lastSubmittedAt: string | null } | null;
  history: AuditEntry[] | null;
  manageable: boolean;
  assignableRoles: Role[];
}

interface Pending { patch: Record<string, unknown>; summary: string }

/** Changes that grant or remove admin-level access, or lock someone out, need the target's email typed to confirm. */
function isSensitive(current: Detail["user"], patch: Record<string, unknown>) {
  const role = patch.role as Role | undefined;
  return patch.status === "disabled" || (role !== undefined && (roleRank(role) >= roleRank("MENTOR") || roleRank(current.role) >= roleRank("MENTOR")));
}

export function UserDetail({ id }: { id: string }) {
  const canRename = useSession().session.permissions["users:rename"] === true;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ displayName: "", scoutName: "", adminNote: "" });
  const [role, setRole] = useState<Role>("MEMBER");
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/users/${id}`, { cache: "no-store" });
    const body = await response.json() as Detail & { message?: string };
    if (!response.ok) { setError(body.message ?? `HTTP ${response.status}`); return; }
    setDetail(body); setError(null);
    setForm({ displayName: body.user.displayName, scoutName: body.user.scoutName ?? "", adminNote: body.user.adminNote ?? "" });
    setRole(body.user.role);
  }, [id]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const send = async (patch: Record<string, unknown>, done: string) => {
    if (!detail) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patch, expectedRev: detail.user.rev }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      setConfirm(null); setTyped("");
      // Reload first: it resets the form to the saved values, so confirming only afterwards means
      // nothing the admin selects next can be overwritten by this reload.
      await load();
      setNotice(done);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Change failed"); }
    finally { setBusy(false); }
  };
  const request = (patch: Record<string, unknown>, summary: string) => {
    if (detail && isSensitive(detail.user, patch)) { setConfirm({ patch, summary }); setTyped(""); return; }
    void send(patch, summary);
  };

  if (error && !detail) return <Panel title="Account"><p role="alert" className="px-5 py-6 text-sm text-bad">{error}</p></Panel>;
  if (!detail) return <Panel title="Account"><EmptyRow>Loading account…</EmptyRow></Panel>;
  const { user, manageable } = detail;
  // Names belong to the Owner alone; managers can still keep a note.
  const renameable = manageable && canRename;
  const namesChanged = form.displayName !== user.displayName || form.scoutName !== (user.scoutName ?? "");
  const changed = (renameable && namesChanged) || form.adminNote !== (user.adminNote ?? "");
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    request({ ...(renameable && namesChanged ? { displayName: form.displayName, scoutName: form.scoutName.trim() || null } : {}), adminNote: form.adminNote.trim() || null }, "Details saved.");
  };
  const setStatus = (status: AccountStatus, summary: string) => request({ status }, summary);

  return <div className="space-y-5">
    <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-accent-text"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All accounts</Link>
    <Panel title="Account">
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <Avatar name={user.displayName} picture={user.picture} provider={user.lastSignInProvider} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-2xl font-semibold tracking-tight">{user.displayName}</div>
          <div className="truncate text-sm text-muted">{user.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><RoleBadge role={user.role} /><AccountStatusBadge status={user.status} /></div>
        </div>
      </div>
      {!manageable && <p className="border-t border-line px-5 py-3 text-xs text-muted">{user.role === "OWNER" ? "The Owner is set in the server configuration (AUTH_OWNER_EMAILS) and can't be changed here." : "Read only: your role can't change this account (nobody changes their own account here, and only roles above theirs can)."}</p>}
    </Panel>

    {(error || notice) && <p role={error ? "alert" : "status"} className={`border-l-2 px-3 py-2 text-sm ${error ? "border-bad bg-bad-soft text-bad" : "border-good bg-good-soft text-ink"}`}>{error ?? notice}</p>}

    {confirm && <div className="border border-warn/40 bg-warn-soft px-5 py-4" role="alertdialog" aria-labelledby="confirm-title">
      <h2 id="confirm-title" className="text-sm font-medium">Confirm: {confirm.summary}</h2>
      <p className="mt-1 text-xs text-muted">This changes admin-level access or locks the account. Type <span className="font-mono text-ink">{user.email}</span> to continue.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Type the account's email to confirm" autoFocus />
        <button type="button" className={dangerButtonClass} disabled={busy || typed.trim().toLowerCase() !== user.email} onClick={() => void send(confirm.patch, confirm.summary)}>{busy ? "Applying…" : "Confirm"}</button>
        <button type="button" className={buttonClass} onClick={() => setConfirm(null)}>Cancel</button>
      </div>
    </div>}

    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Details">
        <form onSubmit={saveProfile} className="space-y-4 px-5 py-5">
          <label className="block text-xs text-muted">Display name<input className={`${inputClass} mt-1`} value={form.displayName} maxLength={80} required disabled={!renameable} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label className="block text-xs text-muted">Scout name <span className="text-muted">(links scouting submissions)</span><input className={`${inputClass} mt-1`} value={form.scoutName} maxLength={60} disabled={!renameable} onChange={(event) => setForm({ ...form, scoutName: event.target.value })} /></label>
          {manageable && !canRename && <p className="text-xs text-muted">Only the Owner can change names.</p>}
          <label className="block text-xs text-muted">Admin note <span className="text-muted">(only account managers see this)</span><textarea className={`${inputClass} mt-1 h-20 py-2`} value={form.adminNote} maxLength={500} disabled={!manageable} onChange={(event) => setForm({ ...form, adminNote: event.target.value })} /></label>
          {manageable && <button type="submit" className={primaryButtonClass} disabled={busy || !changed}>Save details</button>}
        </form>
      </Panel>

      <Panel title="Access">
        <div className="space-y-4 px-5 py-5">
          <label className="block text-xs text-muted">Role
            <select className={`${inputClass} mt-1`} value={role} disabled={!manageable} onChange={(event) => setRole(event.target.value as Role)}>
              {[...new Set([user.role, ...detail.assignableRoles])].map((value) => <option key={value} value={value} disabled={value !== user.role && !detail.assignableRoles.includes(value)}>{ROLE_LABELS[value]}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[role]}</p>
          {manageable && <button type="button" className={primaryButtonClass} disabled={busy || role === user.role} onClick={() => request({ role }, `Role changed from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[role]}.`)}>Change role</button>}
          {manageable && <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {user.status === "pending" && <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => setStatus("active", "Account approved.")}>Approve</button>}
            {user.status === "disabled" && <button type="button" className={buttonClass} disabled={busy} onClick={() => setStatus("active", "Account re-enabled.")}>Enable account</button>}
            {user.status !== "disabled" && <button type="button" className={dangerButtonClass} disabled={busy} onClick={() => setStatus("disabled", "Account disabled and signed out everywhere.")}>Disable account</button>}
          </div>}
        </div>
      </Panel>
    </div>

    <Panel title={`Sessions (${detail.sessions.length})`} action={manageable && detail.sessions.length > 0 ? <button type="button" className={dangerButtonClass} disabled={busy} onClick={async () => {
      setBusy(true);
      try { const response = await fetch(`/api/admin/users/${id}/sessions`, { method: "DELETE" }); const body = await response.json() as { revoked?: number; message?: string }; if (!response.ok) throw new Error(body.message); setNotice(`Signed out of ${body.revoked} session${body.revoked === 1 ? "" : "s"}.`); await load(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't revoke sessions"); } finally { setBusy(false); }
    }}>Sign out everywhere</button> : undefined}>
      {detail.sessions.length === 0 ? <EmptyRow>Not signed in anywhere.</EmptyRow> : <ul>{detail.sessions.map((entry, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm first:border-t-0">
        <span className="inline-flex items-center gap-2"><ProviderIcon provider={entry.provider} className="h-3.5 w-3.5" />{entry.device ?? "Unknown device"}</span>
        <span className="text-xs text-muted">active {formatDate(entry.lastSeenAt, { relative: true })} · expires {formatDate(entry.expiresAt)}</span>
      </li>)}</ul>}
    </Panel>

    <Panel title="Profile">
      <dl>
        <Field label="Sign-in methods"><div className="flex flex-wrap gap-3">{user.providers.map((provider) => <span key={provider} className="inline-flex items-center gap-1.5"><ProviderIcon provider={provider} className="h-3.5 w-3.5" />{providerLabel(provider)}</span>)}</div></Field>
        <Field label="Name from provider">{user.providerName ?? "—"}</Field>
        <Field label="Created">{formatDate(user.createdAt)}</Field>
        <Field label="Last sign-in">{formatDate(user.lastSignInAt)}</Field>
        <Field label="Approved">{user.approvedAt ? `${formatDate(user.approvedAt)} by ${user.approvedBy === "configuration" ? "configuration" : user.approvedBy}` : "—"}</Field>
        <Field label="Scouting activity">{detail.scouting ? `${detail.scouting.submissions} match records${detail.scouting.lastSubmittedAt ? `, latest ${formatDate(detail.scouting.lastSubmittedAt)}` : ""}` : user.scoutName ? "No match records under this scout name yet" : "Set a scout name to link submissions"}</Field>
      </dl>
    </Panel>

    {detail.history && <Panel title="Recent history">
      {detail.history.length === 0 ? <EmptyRow>No audit entries for this account.</EmptyRow> : <ul>{detail.history.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-t border-line px-5 py-2.5 text-xs first:border-t-0">
        <span><span className={`font-mono ${entry.result === "success" ? "text-ink" : "text-warn"}`}>{entry.action}</span> <span className="text-muted">{entry.result}{entry.actor?.email ? ` · by ${entry.actor.email}` : ""}</span></span>
        <span className="text-muted">{formatDate(entry.at)}</span>
      </li>)}</ul>}
    </Panel>}
  </div>;
}
