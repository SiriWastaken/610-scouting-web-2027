import { AccessDenied } from "@/components/auth/access-denied";
import { SyncMonitor } from "@/components/admin/sync-monitor";
import { requirePage } from "@/lib/auth/next";

export default async function AdminSyncPage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <SyncMonitor />;
}
