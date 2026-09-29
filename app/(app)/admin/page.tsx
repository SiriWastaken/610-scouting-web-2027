import { AccessDenied } from "@/components/ui/kit";
import { Overview } from "@/components/admin/health";
import { requirePage } from "@/lib/auth/pages";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/roles";

export default async function AdminOverviewPage() {
  const { viewer, allowed } = await requirePage("ops:read");
  // Scout leads manage people but do not see operations.
  if (!allowed) { if (can(viewer.principal, "users:read")) redirect("/admin/users"); return <AccessDenied />; }
  return <Overview />;
}
