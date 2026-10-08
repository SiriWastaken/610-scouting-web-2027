// /admin/api — request counts, latency and busiest routes. Needs `ops:read` (Mentor and above).
import { AccessDenied } from "@/components/ui/kit";
import { ApiMonitor } from "@/components/admin/health";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminApiPage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <ApiMonitor />;
}
