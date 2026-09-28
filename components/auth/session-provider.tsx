"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { realtime } from "@/lib/realtime-client";
import type { ClientViewer } from "@/lib/auth/runtime";
import type { Permission } from "@/lib/auth/roles";

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
