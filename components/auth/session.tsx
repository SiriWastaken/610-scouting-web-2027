"use client";

// The signed-in user in the browser: SessionProvider keeps their details
// current and notices when the session ends; AccountChip is the account and
// sign-out button in the sidebar's bottom corner.
import Link from "next/link";
import { LogOut } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "@/components/auth/identity";
import { realtime } from "@/lib/realtime/client";
import type { ClientViewer } from "@/lib/auth/requests";
import { ROLE_LABELS, type Permission } from "@/lib/auth/roles";

// ── Session provider ──

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

/** Re-checks the session on focus (throttled), every few minutes, and when the realtime server ends it. */
function useRechecks(refresh: () => Promise<void>, lastCheck: RefObject<number>) {
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible" && Date.now() - lastCheck.current > FOCUS_THROTTLE_MS) void refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, RECHECK_MS);
    const unsubscribe = realtime.subscribeSessionEnded(() => void refresh());
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); clearInterval(timer); unsubscribe(); };
  }, [refresh, lastCheck]);
}

function useSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* the cookie is cleared server-side; navigate anyway */ }
    realtime.disconnect();
    router.replace("/welcome?signedOut=1");
    router.refresh();
  }, [router]);
  return { signOut, signingOut };
}

/**
 * Keeps the signed-in user's details current and notices when the session
 * ends (expired, revoked, account disabled): on focus, every few minutes, and
 * when the realtime server closes the socket for that reason. The server is
 * the authority; this only decides what to show.
 */
export function SessionProvider({ initial, children }: { initial: SessionState; children: ReactNode }) {
  const [session, setSession] = useState(initial);
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
  useRechecks(refresh, lastCheck);

  const { signOut, signingOut } = useSignOut();

  const value = useMemo(() => ({ session, signOut, signingOut, refresh }), [session, signOut, signingOut, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The signed-in user, their permissions, sign-out and refresh. Throws if used outside SessionProvider.
 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

// ── Account chip ──

function SignOutIcon() {
  return <LogOut className="h-4 w-4" aria-hidden="true" />;
}

/** The signed-in account in the sidebar's bottom corner (full) or the mobile header (compact), with sign-out. */
export function AccountChip({ compact = false }: { compact?: boolean }) {
  const { session: { user }, signOut, signingOut } = useSession();
  if (compact) {
    return <div className="flex items-center gap-2" data-account-chip>
      <Link href="/account" aria-label={`Account: ${user.displayName}`} className="rounded-full"><Avatar name={user.displayName} picture={user.picture} size={30} /></Link>
      <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" className="rounded-md p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50"><SignOutIcon /></button>
    </div>;
  }
  return <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-1.5" data-account-chip>
    <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 hover:bg-surface">
      <Avatar name={user.displayName} picture={user.picture} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink" data-account-name>{user.displayName}</span>
        <span className="block truncate text-xs font-medium text-muted" data-account-role={user.role}>{ROLE_LABELS[user.role]}</span>
      </span>
    </Link>
    <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" title="Sign out" className="rounded-md p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50">
      {signingOut ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" /> : <SignOutIcon />}
    </button>
  </div>;
}
