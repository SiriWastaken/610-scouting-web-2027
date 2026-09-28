"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/auth/session-provider";
import { useOps } from "@/components/admin/ops-provider";
import { formatDate } from "@/components/ui/panel";
import { ADMIN_SECTIONS } from "@/lib/auth/roles";

export function AdminTabs() {
  const pathname = usePathname();
  const { session } = useSession();
  const sections = ADMIN_SECTIONS.filter((section) => session.permissions[section.permission]);
  return <nav aria-label="Admin sections" className="mb-7 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
    {sections.map((section) => {
      const active = section.href === "/admin" ? pathname === "/admin" : pathname.startsWith(section.href);
      return <Link key={section.href} href={section.href} aria-current={active ? "page" : undefined}
        className={`-mb-px min-w-max border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)] ${active ? "border-[var(--green)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}>{section.label}</Link>;
    })}
  </nav>;
}

/** "Updated 5s ago · Refresh" with the error, if the last poll failed. */
export function FreshnessBar() {
  const { updatedAt, error, refresh, loading } = useOps();
  return <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]" aria-live="polite">
    {error ? <span className="text-red-300" data-ops-error>⚠ {error}</span> : updatedAt ? <span>Updated {formatDate(updatedAt, { relative: true })} · refreshes every 15 s</span> : loading ? <span>Loading…</span> : null}
    <button type="button" onClick={() => void refresh()} className="rounded-sm border border-[var(--line)] px-2 py-1 hover:border-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">Refresh</button>
  </div>;
}
