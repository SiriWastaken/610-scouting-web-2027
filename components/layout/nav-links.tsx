"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/teams", label: "Teams", number: "01" },
  { href: "/averages", label: "Averages", number: "02" },
  { href: "/strategy", label: "Strategy Tools", number: "03" },
  { href: "/box-plot", label: "Box Plot", number: "04" },
  { href: "/coverage", label: "Coverage", number: "05" },
];

export function NavLinks() {
  const pathname = usePathname();
  return <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Main navigation">
    {navigation.map((item) => {
      const active = pathname === item.href;
      return <Link key={item.href} href={item.href} className={`group flex min-w-max items-center gap-3 rounded-sm border-l-2 px-3 py-2.5 text-sm transition-colors ${active ? "border-[var(--green)] bg-[var(--panel-raised)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)]"}`}>
        <span className={`font-mono text-[10px] ${active ? "text-[var(--green)]" : "text-[#58665e] group-hover:text-[var(--green)]"}`}>{item.number}</span>
        <span>{item.label}</span>
      </Link>;
    })}
  </nav>;
}