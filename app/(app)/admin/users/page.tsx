// /admin/users — every account, with search and filters. Needs `users:read` (Scout lead and above).
import { AccessDenied } from "@/components/ui/kit";
import { UsersTable } from "@/components/admin/users";
import { requirePage } from "@/lib/auth/pages";

export default async function AdminUsersPage() {
  if (!(await requirePage("users:read")).allowed) return <AccessDenied />;
  return <UsersTable />;
}
