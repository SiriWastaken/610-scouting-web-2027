// /admin/sync — Sync Gateway and Couchbase synchronisation health. Needs `ops:read`.
import { AccessDenied } from "@/components/ui/kit";
import { SyncMonitor } from "@/components/admin/health";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminSyncPage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <SyncMonitor />;
}
