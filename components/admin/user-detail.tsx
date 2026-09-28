"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/auth/avatar";
import { ProviderIcon, providerLabel } from "@/components/auth/provider-icons";
import { AccountStatusBadge, RoleBadge } from "@/components/auth/role-badge";
import { EmptyRow } from "@/components/admin/status";
import type { AdminUser } from "@/components/admin/users-table";
import { buttonClass, dangerButtonClass, Field, formatDate, inputClass, Panel, primaryButtonClass } from "@/components/ui/panel";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, roleRank, type AccountStatus, type Role } from "@/lib/auth/roles";
import type { AuditEntry } from "@/lib/auth/audit";

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
  return patch.status === "disabled" || (role !== undefined && (roleRank(role) >= roleRank("ADMIN") || roleRank(current.role) >= roleRank("ADMIN")));
}

export function UserDetail({ id }: { id: string }) {
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

  if (error && !detail) return <Panel title="Account"><p role="alert" className="px-5 py-6 text-sm text-red-300">{error}</p></Panel>;
  if (!detail) return <Panel title="Account"><EmptyRow>Loading account…</EmptyRow></Panel>;
  const { user, manageable } = detail;
  const changed = form.displayName !== user.displayName || form.scoutName !== (user.scoutName ?? "") || form.adminNote !== (user.adminNote ?? "");
  const saveProfile = (event: FormEvent) => { event.preventDefault(); request({ displayName: form.displayName, scoutName: form.scoutName.trim() || null, adminNote: form.adminNote.trim() || null }, "Details saved."); };
  const setStatus = (status: AccountStatus, summary: string) => request({ status }, summary);

  return <div className="space-y-5">
    <Link href="/admin/users" className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">← All accounts</Link>
    <Panel title="Account">
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <Avatar name={user.displayName} picture={user.picture} provider={user.lastSignInProvider} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-medium tracking-tight">{user.displayName}</div>
          <div className="truncate text-sm text-[var(--muted)]">{user.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><RoleBadge role={user.role} /><AccountStatusBadge status={user.status} />{user.rootLocked && <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300">configured root</span>}</div>
        </div>
      </div>
      {!manageable && <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">{user.rootLocked ? "This root account comes from AUTH_ROOT_EMAILS and can only be changed in the server configuration." : "Read only: your role can't change this account (you can't change your own account here, and only roles above theirs can)."}</p>}
    </Panel>

    {(error || notice) && <p role={error ? "alert" : "status"} className={`border-l-2 px-3 py-2 text-sm ${error ? "border-red-400 bg-red-400/10 text-red-200" : "border-[var(--green)] bg-[rgba(120,192,145,0.08)]"}`}>{error ?? notice}</p>}

    {confirm && <div className="border border-amber-400/50 bg-amber-400/5 px-5 py-4" role="alertdialog" aria-labelledby="confirm-title">
      <h2 id="confirm-title" className="text-sm font-medium">Confirm: {confirm.summary}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">This changes admin-level access or locks the account. Type <span className="font-mono text-[var(--foreground)]">{user.email}</span> to continue.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Type the account's email to confirm" autoFocus />
        <button type="button" className={dangerButtonClass} disabled={busy || typed.trim().toLowerCase() !== user.email} onClick={() => void send(confirm.patch, confirm.summary)}>{busy ? "Applying…" : "Confirm"}</button>
        <button type="button" className={buttonClass} onClick={() => setConfirm(null)}>Cancel</button>
      </div>
    </div>}

    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Details">
        <form onSubmit={saveProfile} className="space-y-4 px-5 py-5">
          <label className="block text-xs text-[var(--muted)]">Display name<input className={`${inputClass} mt-1`} value={form.displayName} maxLength={80} required disabled={!manageable} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label className="block text-xs text-[var(--muted)]">Scout name <span className="text-[#58665e]">(links scouting submissions)</span><input className={`${inputClass} mt-1`} value={form.scoutName} maxLength={60} disabled={!manageable} onChange={(event) => setForm({ ...form, scoutName: event.target.value })} /></label>
          <label className="block text-xs text-[var(--muted)]">Admin note <span className="text-[#58665e]">(only account managers see this)</span><textarea className={`${inputClass} mt-1 h-20 py-2`} value={form.adminNote} maxLength={500} disabled={!manageable} onChange={(event) => setForm({ ...form, adminNote: event.target.value })} /></label>
          {manageable && <button type="submit" className={primaryButtonClass} disabled={busy || !changed}>Save details</button>}
        </form>
      </Panel>

      <Panel title="Access">
        <div className="space-y-4 px-5 py-5">
          <label className="block text-xs text-[var(--muted)]">Role
            <select className={`${inputClass} mt-1`} value={role} disabled={!manageable} onChange={(event) => setRole(event.target.value as Role)}>
              {[...new Set([user.role, ...detail.assignableRoles])].map((value) => <option key={value} value={value} disabled={value !== user.role && !detail.assignableRoles.includes(value)}>{ROLE_LABELS[value]}</option>)}
            </select>
          </label>
          <p className="text-xs text-[var(--muted)]">{ROLE_DESCRIPTIONS[role]}</p>
          {manageable && <button type="button" className={primaryButtonClass} disabled={busy || role === user.role} onClick={() => request({ role }, `Role changed from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[role]}.`)}>Change role</button>}
          {manageable && <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
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
      {detail.sessions.length === 0 ? <EmptyRow>Not signed in anywhere.</EmptyRow> : <ul>{detail.sessions.map((entry, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3 text-sm first:border-t-0">
        <span className="inline-flex items-center gap-2"><ProviderIcon provider={entry.provider} className="h-3.5 w-3.5" />{entry.device ?? "Unknown device"}</span>
        <span className="text-xs text-[var(--muted)]">active {formatDate(entry.lastSeenAt, { relative: true })} · expires {formatDate(entry.expiresAt)}</span>
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
      {detail.history.length === 0 ? <EmptyRow>No audit entries for this account.</EmptyRow> : <ul>{detail.history.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-t border-[var(--line)] px-5 py-2.5 text-xs first:border-t-0">
        <span><span className={`font-mono ${entry.result === "success" ? "text-[var(--foreground)]" : "text-amber-300"}`}>{entry.action}</span> <span className="text-[var(--muted)]">{entry.result}{entry.actor?.email ? ` · by ${entry.actor.email}` : ""}</span></span>
        <span className="text-[var(--muted)]">{formatDate(entry.at)}</span>
      </li>)}</ul>}
    </Panel>}
  </div>;
}
