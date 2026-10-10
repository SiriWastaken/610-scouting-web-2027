// /admin/realtime — WebSocket health, connections and recent events. Needs `ops:read`.
import { AccessDenied } from "@/components/ui/kit";
import { RealtimeMonitor } from "@/components/admin/realtime";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminRealtimePage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <RealtimeMonitor />;
}
