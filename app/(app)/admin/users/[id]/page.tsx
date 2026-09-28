import { AccessDenied } from "@/components/ui/kit";
import { UserDetail } from "@/components/admin/users";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  if (!(await requirePage("users:read")).allowed) return <AccessDenied />;
  const { id } = await params;
  return <UserDetail id={id} />;
}
