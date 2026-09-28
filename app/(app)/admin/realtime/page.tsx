import { AccessDenied } from "@/components/auth/access-denied";
import { RealtimeMonitor } from "@/components/admin/realtime-monitor";
import { requirePage } from "@/lib/auth/next";

export default async function AdminRealtimePage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <RealtimeMonitor />;
}
