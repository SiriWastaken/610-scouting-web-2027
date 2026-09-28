import { AccessDenied } from "@/components/auth/access-denied";
import { UsersTable } from "@/components/admin/users-table";
import { requirePage } from "@/lib/auth/next";

export default async function AdminUsersPage() {
  if (!(await requirePage("users:read")).allowed) return <AccessDenied />;
  return <UsersTable />;
}
