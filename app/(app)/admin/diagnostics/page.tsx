import { AccessDenied } from "@/components/ui/kit";
import { Diagnostics } from "@/components/admin/health";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminDiagnosticsPage() {
  if (!(await requirePage("ops:diagnose")).allowed) return <AccessDenied />;
  return <Diagnostics />;
}
