import { AccessDenied } from "@/components/auth/access-denied";
import { ApiMonitor } from "@/components/admin/api-monitor";
import { requirePage } from "@/lib/auth/next";

export default async function AdminApiPage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <ApiMonitor />;
}
