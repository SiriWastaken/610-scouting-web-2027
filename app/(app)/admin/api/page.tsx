import { AccessDenied } from "@/components/ui/kit";
import { ApiMonitor } from "@/components/admin/health";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminApiPage() {
  if (!(await requirePage("ops:read")).allowed) return <AccessDenied />;
  return <ApiMonitor />;
}
