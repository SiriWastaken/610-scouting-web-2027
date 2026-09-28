"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/auth/session-provider";

const navigation = [
  { href: "/teams", label: "Teams", number: "01" },
  { href: "/averages", label: "Averages", number: "02" },
  { href: "/strategy", label: "Strategy Tools", number: "03" },
  { href: "/box-plot", label: "Box Plot", number: "04" },
  { href: "/coverage", label: "Coverage", number: "05" },
];

export function NavLinks() {
  const pathname = usePathname();
  const { session } = useSession();
  // Shown only to roles that can use it; the admin pages and APIs enforce this themselves.
  const items = session.admin ? [...navigation, { href: "/admin", label: "Admin", number: "06" }] : navigation;
  return <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Main navigation">
    {items.map((item) => {
      const active = item.href === "/admin" ? pathname.startsWith("/admin") : pathname === item.href;
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`group flex min-w-max items-center gap-3 rounded-sm border-l-2 px-3 py-2.5 text-sm transition-colors ${active ? "border-[var(--green)] bg-[var(--panel-raised)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)]"}`}>
        <span className={`font-mono text-[10px] ${active ? "text-[var(--green)]" : "text-[#58665e] group-hover:text-[var(--green)]"}`}>{item.number}</span>
        <span>{item.label}</span>
      </Link>;
    })}
  </nav>;
}
