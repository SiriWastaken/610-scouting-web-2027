// /admin/users/<id> — one account: details, access, sessions, history. Needs `users:read`; what can be changed
// depends on the viewer's role.
import { AccessDenied } from "@/components/ui/kit";
import { UserDetail } from "@/components/admin/users";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  if (!(await requirePage("users:read")).allowed) return <AccessDenied />;
  const { id } = await params;
  return <UserDetail id={id} />;
}
