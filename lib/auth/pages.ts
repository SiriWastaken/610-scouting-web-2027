// The access check for pages (server components). proxy.ts only redirects
// visitors without a session cookie; this loads the session and account for
// real and sends anyone not signed in and approved to the sign-in page.
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime, authenticateCookieHeader, clientViewer, type Authentication, type ClientViewer } from "./requests.ts";
import { can, type Permission } from "./roles.ts";
import type { Viewer } from "./sessions.ts";

/** Set by proxy.ts so pages know where a signed-out visitor was headed. */
export const PATH_HEADER = "x-610-path";

/** Who is making this request, resolved once per request (React cache) from the session cookie. */
export const getAuthentication = cache(async (): Promise<Authentication> => {
  const cookieStore = await cookies();
  return authenticateCookieHeader(cookieStore.toString());
});

async function currentPath() {
  const path = (await headers()).get(PATH_HEADER);
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Sends anyone who is not an active, signed-in user to the welcome screen; returns the viewer otherwise. */
export async function requireActiveViewer(): Promise<{ viewer: Viewer }> {
  const auth = await getAuthentication();
  if (auth.status !== "signed-in") {
    const params = new URLSearchParams({ next: await currentPath() });
    if (auth.status === "signed-out" && auth.reason === "expired") params.set("reason", "expired");
    if (auth.status === "unavailable") params.set("reason", "unavailable");
    redirect(`/welcome?${params}`);
  }
  if (auth.viewer.principal.status !== "active") redirect("/welcome");
  return { viewer: auth.viewer };
}

/**
 * The data-access check for pages (proxy.ts only makes an optimistic cookie
 * check). Signed-out visitors, pending accounts, and disabled accounts go to
 * the welcome screen, remembering where they were headed. Signed-in users
 * without `permission` get `allowed: false` so the page can say so.
 */
export async function requirePage(permission?: Permission): Promise<{ viewer: Viewer; allowed: boolean }> {
  const auth = await requireActiveViewer();
  return { viewer: auth.viewer, allowed: permission ? can(auth.viewer.principal, permission) : true };
}

/** The signed-in user and session as the browser may see them. */
export function viewerForClient(viewer: Viewer): ClientViewer {
  const runtime = authRuntime();
  if (!runtime.ok) throw new Error("Auth runtime unavailable");
  return clientViewer(runtime.config, viewer);
}
