import { enabledProviders, readAuthConfig } from "@/lib/auth/config";
import { json } from "@/lib/auth/requests";
import { authRuntime, authenticateCookieHeader, clientViewer } from "@/lib/auth/requests";
import { assignableRoles, can, canOpenAdmin, PERMISSIONS, type Permission } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The browser's view of who is signed in. `permissions` is computed here from
 * the stored account so the UI can hide what the server would refuse; the
 * server never reads it back.
 */
export async function GET(request: Request) {
  const auth = authRuntime();
  const providers = enabledProviders(readAuthConfig());
  if (!auth.ok) return json({ authenticated: false, available: false, providers }, { status: 503 });
  const result = await authenticateCookieHeader(request.headers.get("cookie"), auth);
  if (result.status === "unavailable") return json({ authenticated: false, available: false, providers, reason: result.reason }, { status: 503 });
  if (result.status === "signed-out") return json({ authenticated: false, available: true, providers, reason: result.reason }, { status: 401 });
  const { principal } = result.viewer;
  const permissions = Object.fromEntries((Object.keys(PERMISSIONS) as Permission[]).map((permission) => [permission, can(principal, permission)]));
  return json({ authenticated: true, available: true, providers, ...clientViewer(auth.config, result.viewer), permissions, admin: canOpenAdmin(principal), assignableRoles: assignableRoles(principal) });
}
