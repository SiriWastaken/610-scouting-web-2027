"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/auth/identity";
import { providerLabel, ProviderIcon } from "@/components/auth/identity";
import { AccountStatusBadge, RoleBadge } from "@/components/auth/identity";
import { useSession } from "@/components/auth/session";
import { buttonClass, dangerButtonClass, Field, formatDate, inputClass, Panel, primaryButtonClass } from "@/components/ui/kit";
import { ROLE_DESCRIPTIONS } from "@/lib/auth/roles";

interface DeviceSession { current: boolean; provider: string; device: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }

/**
 * The signed-in user's account. Sections are independent panels, so user
 * preferences can be added later as another panel without touching these.
 */
export function AccountPanel() {
  const { session: { user, session, permissions }, refresh, signOut, signingOut } = useSession();
  // Only the Owner changes names (theirs and everyone else's); the server enforces the same rule.
  const canRename = permissions["users:rename"] === true;
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [scoutName, setScoutName] = useState(user.scoutName ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSessions(((await response.json()) as { sessions: DeviceSession[] }).sessions);
      setSessionsError(null);
    } catch { setSessionsError("Couldn't load your devices."); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void loadSessions(), 0); return () => clearTimeout(timer); }, [loadSessions]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, scoutName: scoutName.trim() || null }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      setMessage({ tone: "ok", text: "Saved." });
      await refresh();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save." }); }
    finally { setSaving(false); }
  };

  const others = sessions?.filter((entry) => !entry.current).length ?? 0;
  const provider = session.provider ?? user.lastSignInProvider;

  return <div className="space-y-5">
    <Panel title="Profile">
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <Avatar name={user.displayName} picture={user.picture} provider={provider} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-2xl font-semibold tracking-tight" data-profile-name>{user.displayName}</div>
          <div className="truncate text-sm text-muted">{user.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><span data-profile-role={user.role}><RoleBadge role={user.role} /></span><AccountStatusBadge status={user.status} /></div>
        </div>
      </div>
      {canRename ? <form onSubmit={save} className="grid gap-4 border-t border-line px-5 py-5 sm:grid-cols-2">
        <label className="text-xs text-muted">Display name
          <input className={`${inputClass} mt-1`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
        </label>
        <label className="text-xs text-muted">Scout name <span className="text-muted">(as typed on scouting tablets)</span>
          <input className={`${inputClass} mt-1`} value={scoutName} onChange={(event) => setScoutName(event.target.value)} maxLength={60} placeholder="e.g. Alex R." />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryButtonClass} disabled={saving || (displayName === user.displayName && scoutName === (user.scoutName ?? ""))}>{saving ? "Saving…" : "Save changes"}</button>
          {message && <span role="status" className={`text-sm ${message.tone === "ok" ? "text-accent-text" : "text-bad"}`}>{message.text}</span>}
        </div>
      </form> : <dl className="border-t border-line">
        <Field label="Display name">{user.displayName}</Field>
        <Field label="Scout name">{user.scoutName ?? "—"}</Field>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">Only the team&apos;s Owner can change names. Ask them if yours needs fixing.</p>
      </dl>}
    </Panel>

    <Panel title="Access">
      <dl>
        <Field label="Role"><div className="flex flex-wrap items-center gap-2"><RoleBadge role={user.role} /><span className="text-muted">{ROLE_DESCRIPTIONS[user.role]}</span></div></Field>
        {user.role === "OWNER" && <Field label="Owner">Set in the server configuration (AUTH_OWNER_EMAILS); it can&apos;t be changed from the app.</Field>}
        <Field label="Sign-in methods"><div className="flex flex-wrap gap-3">{user.providers.map((id) => <span key={id} className="inline-flex items-center gap-1.5"><ProviderIcon provider={id} className="h-3.5 w-3.5" />{providerLabel(id)}</span>)}</div></Field>
        <Field label="Member since">{formatDate(user.createdAt)}</Field>
        <Field label="Last sign-in">{formatDate(user.lastSignInAt)} {user.lastSignInProvider && <span className="text-muted">with {providerLabel(user.lastSignInProvider)}</span>}</Field>
      </dl>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Roles are assigned by scout leads, mentors, and the Owner. Nobody can change their own role.</p>
    </Panel>

    <Panel title="This session" action={<button type="button" className={dangerButtonClass} onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>}>
      <dl>
        <Field label="Signed in with"><span className="inline-flex items-center gap-1.5"><ProviderIcon provider={provider} className="h-3.5 w-3.5" />{providerLabel(provider)}</span></Field>
        <Field label="Device">{session.device ?? "Unknown device"}</Field>
        <Field label="Started">{formatDate(session.createdAt)}</Field>
        <Field label="Signs out after">{formatDate(session.idleExpiresAt)} if idle, and no later than {formatDate(session.expiresAt)}</Field>
      </dl>
    </Panel>

    <Panel title="Devices" action={<button type="button" className={buttonClass} disabled={revoking || others === 0} onClick={async () => {
      setRevoking(true);
      try { await fetch("/api/account/sessions", { method: "DELETE" }); await loadSessions(); } finally { setRevoking(false); }
    }}>{revoking ? "Signing out…" : "Sign out other devices"}</button>}>
      {sessionsError ? <p className="px-5 py-4 text-sm text-bad">{sessionsError}</p> : sessions === null ? <p className="px-5 py-4 text-sm text-muted">Loading…</p> :
        <ul>{sessions.map((entry, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm first:border-t-0">
          <span className="inline-flex items-center gap-2"><ProviderIcon provider={entry.provider} className="h-3.5 w-3.5" />{entry.device ?? "Unknown device"}{entry.current && <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-text">This device</span>}</span>
          <span className="text-xs text-muted">active {formatDate(entry.lastSeenAt, { relative: true })} · started {formatDate(entry.createdAt)}</span>
        </li>)}</ul>}
    </Panel>
  </div>;
}
