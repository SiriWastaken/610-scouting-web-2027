import { AccessDenied } from "@/components/ui/kit";
import { AuditLog } from "@/components/admin/audit-log";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminAuditPage() {
  if (!(await requirePage("audit:read")).allowed) return <AccessDenied />;
  return <AuditLog />;
}
