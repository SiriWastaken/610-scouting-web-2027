import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/auth/session-provider";
import { requireActiveViewer, viewerForClient } from "@/lib/auth/next";
import { can, canOpenAdmin, PERMISSIONS, type Permission } from "@/lib/auth/roles";

/**
 * Everything behind sign-in. The account shown in the shell is for display;
 * each page still checks its own access (layouts are not re-run on navigation).
 */
export default async function SignedInLayout({ children }: LayoutProps<"/">) {
  const { viewer } = await requireActiveViewer();
  const { principal } = viewer;
  const permissions = Object.fromEntries((Object.keys(PERMISSIONS) as Permission[]).map((permission) => [permission, can(principal, permission)]));
  return <SessionProvider initial={{ ...viewerForClient(viewer), permissions, admin: canOpenAdmin(principal) }}>
    <AppShell>{children}</AppShell>
  </SessionProvider>;
}
