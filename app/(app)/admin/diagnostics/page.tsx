import { AccessDenied } from "@/components/auth/access-denied";
import { Diagnostics } from "@/components/admin/diagnostics";
import { requirePage } from "@/lib/auth/next";

export default async function AdminDiagnosticsPage() {
  if (!(await requirePage("ops:diagnose")).allowed) return <AccessDenied />;
  return <Diagnostics />;
}
