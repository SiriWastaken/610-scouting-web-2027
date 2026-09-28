"use client";

// The signed-in user in the browser: SessionProvider keeps their details
// current and notices when the session ends; AccountChip is the account and
// sign-out button in the sidebar's bottom corner.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "@/components/auth/identity";
import { realtime } from "@/lib/realtime/client";
import type { ClientViewer } from "@/lib/auth/requests";
import { ROLE_LABELS, type Permission } from "@/lib/auth/roles";

// ── from session-provider.tsx ────────────────────

export interface SessionState extends ClientViewer {
  permissions: Partial<Record<Permission, boolean>>;
  admin: boolean;
}

interface SessionContextValue {
  session: SessionState;
  signOut: () => Promise<void>;
  signingOut: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const RECHECK_MS = 5 * 60_000;
const FOCUS_THROTTLE_MS = 60_000;

/**
 * Keeps the signed-in user's details current and notices when the session
 * ends (expired, revoked, account disabled): on focus, every few minutes, and
 * when the realtime server closes the socket for that reason. The server is
 * the authority; this only decides what to show.
 */
export function SessionProvider({ initial, children }: { initial: SessionState; children: ReactNode }) {
  const [session, setSession] = useState(initial);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const lastCheck = useRef(0);
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);

  const refresh = useCallback(async () => {
    lastCheck.current = Date.now();
    let response: Response;
    try { response = await fetch("/api/auth/session", { cache: "no-store" }); } catch { return; } // offline: try again later
    if (response.status === 401) {
      router.replace(`/welcome?reason=expired&next=${encodeURIComponent(path.current)}`);
      return;
    }
    if (!response.ok) return;
    const body = await response.json() as SessionState & { authenticated: boolean };
    if (!body.authenticated) return;
    if (body.user.status !== "active") { router.replace("/welcome"); return; }
    setSession({ user: body.user, session: body.session, permissions: body.permissions, admin: body.admin });
  }, [router]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible" && Date.now() - lastCheck.current > FOCUS_THROTTLE_MS) void refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, RECHECK_MS);
    const unsubscribe = realtime.subscribeSessionEnded(() => void refresh());
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); clearInterval(timer); unsubscribe(); };
  }, [refresh]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* the cookie is cleared server-side; navigate anyway */ }
    realtime.disconnect();
    router.replace("/welcome?signedOut=1");
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ session, signOut, signingOut, refresh }), [session, signOut, signingOut, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

// ── from account-chip.tsx ────────────────────

function SignOutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" /><path d="M10.5 11.5 14 8l-3.5-3.5" /><path d="M14 8H6" /></svg>;
}

/** The signed-in account in the sidebar's bottom corner (full) or the mobile header (compact), with sign-out. */
export function AccountChip({ compact = false }: { compact?: boolean }) {
  const { session: { user, session }, signOut, signingOut } = useSession();
  const provider = session.provider ?? user.lastSignInProvider;
  if (compact) {
    return <div className="flex items-center gap-2" data-account-chip>
      <Link href="/account" aria-label={`Account: ${user.displayName}`} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green)]"><Avatar name={user.displayName} picture={user.picture} provider={provider} size={30} /></Link>
      <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" className="rounded-sm p-2 text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]"><SignOutIcon /></button>
    </div>;
  }
  return <div className="flex items-center gap-2 rounded-sm border border-[var(--line)] bg-[var(--panel)] p-2" data-account-chip>
    <Link href="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-sm p-1 hover:bg-[var(--panel-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">
      <Avatar name={user.displayName} picture={user.picture} provider={provider} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-[var(--foreground)]" data-account-name>{user.displayName}</span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]" data-account-role={user.role}>{ROLE_LABELS[user.role]}</span>
      </span>
    </Link>
    <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" title="Sign out" className="rounded-sm p-2 text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">
      {signingOut ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" /> : <SignOutIcon />}
    </button>
  </div>;
}
