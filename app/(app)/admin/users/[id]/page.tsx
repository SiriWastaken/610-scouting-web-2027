import { AccessDenied } from "@/components/auth/access-denied";
import { UserDetail } from "@/components/admin/user-detail";
import { requirePage } from "@/lib/auth/next";

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  if (!(await requirePage("users:read")).allowed) return <AccessDenied />;
  const { id } = await params;
  return <UserDetail id={id} />;
}
