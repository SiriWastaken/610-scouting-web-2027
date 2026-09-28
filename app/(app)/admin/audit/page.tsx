import { AccessDenied } from "@/components/auth/access-denied";
import { AuditLog } from "@/components/admin/audit-log";
import { requirePage } from "@/lib/auth/next";

export default async function AdminAuditPage() {
  if (!(await requirePage("audit:read")).allowed) return <AccessDenied />;
  return <AuditLog />;
}
