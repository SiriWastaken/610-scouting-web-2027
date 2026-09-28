import type { Metadata } from "next";
import { AccessDenied } from "@/components/auth/access-denied";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { OpsProvider } from "@/components/admin/ops-provider";
import { requirePage } from "@/lib/auth/next";
import { can, canOpenAdmin } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Admin · 610 Scouting" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { viewer } = await requirePage();
  if (!canOpenAdmin(viewer.principal)) return <AccessDenied title="Admin is for scout leads and admins" />;
  return <div className="mx-auto max-w-[1180px]">
    <div className="mb-6 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">06 / OPERATIONS</div><h1 className="text-3xl font-medium tracking-tight">Admin</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Is everything working, who has access, and what changed. Every number here comes from the server.</p></div>
    <AdminTabs />
    <OpsProvider enabled={can(viewer.principal, "ops:read")}>{children}</OpsProvider>
  </div>;
}
