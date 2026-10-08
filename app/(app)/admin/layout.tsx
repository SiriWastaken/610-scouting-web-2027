import type { Metadata } from "next";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { AdminTabs } from "@/components/admin/shell";
import { OpsProvider } from "@/components/admin/shell";
import { requirePage } from "@/lib/auth/pages";
import { can, canOpenAdmin } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Admin · 610 Scouting" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { viewer } = await requirePage();
  if (!canOpenAdmin(viewer.principal)) return <AccessDenied title="Admin is for scout leads, mentors, and the Owner" />;
  return <div className="mx-auto max-w-[1180px]">
    <PageHeader title="Admin" description="Is everything working, who has access, and what changed. Every number here comes from the server." />
    <AdminTabs />
    <OpsProvider enabled={can(viewer.principal, "ops:read")}>{children}</OpsProvider>
  </div>;
}
