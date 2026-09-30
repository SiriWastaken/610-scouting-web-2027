"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChartCandlestick, ClipboardCheck, ShieldCheck, Sigma, Target, type LucideIcon } from "lucide-react";
import { useSession } from "@/components/auth/session";
import { tabVars, type TabName } from "@/lib/ui/tabs";

type NavItem = { href: string; label: string; icon: LucideIcon; tab: TabName };

// Each tab's icon names what the page is for: robots to look up, averages to rank,
// a target for match planning, candlesticks for spread, a checklist for coverage.
export const navigation: NavItem[] = [
  { href: "/teams", label: "Teams", icon: Bot, tab: "teams" },
  { href: "/averages", label: "Averages", icon: Sigma, tab: "averages" },
  { href: "/strategy", label: "Strategy", icon: Target, tab: "strategy" },
  { href: "/box-plot", label: "Box Plot", icon: ChartCandlestick, tab: "boxplot" },
  { href: "/coverage", label: "Coverage", icon: ClipboardCheck, tab: "coverage" },
];
const admin: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck, tab: "admin" };

function isActive(pathname: string, href: string) {
  return href === "/admin" || href === "/teams" ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;
}

/** Vertical in the desktop sidebar, a scrollable tab strip under the header on tablets and phones. */
export function NavLinks({ layout = "sidebar" }: { layout?: "sidebar" | "tabs" }) {
  const pathname = usePathname();
  const { session } = useSession();
  // Shown only to roles that can use it; the admin pages and APIs enforce this themselves.
  const items = session.admin ? [...navigation, admin] : navigation;
  // The tab's hue shows only while active: icon, a soft pill and a 2px indicator. Inactive tabs are neutral.
  // Shape carries the state too (pill + bar), so it reads in grayscale.
  const transition = "transition-[background-color,color,opacity] duration-150 ease-out";
  if (layout === "tabs") {
    return <nav className="-mb-px flex gap-1 overflow-x-auto px-3 [scrollbar-width:none]" aria-label="Main navigation">
      {items.map(({ href, label, icon: Icon, tab }) => {
        const active = isActive(pathname, href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} style={tabVars(tab)}
          className={`relative flex min-h-11 min-w-max items-center gap-2 rounded-t-md px-3 text-sm font-medium ${transition} ${active ? "bg-(--tab-bg) text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"}`}>
          <Icon className={`h-4 w-4 ${transition} ${active ? "text-(--tab)" : ""}`} aria-hidden="true" />{label}
          <span aria-hidden="true" className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-(--tab) ${transition} ${active ? "opacity-100" : "opacity-0"}`} />
        </Link>;
      })}
    </nav>;
  }
  return <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
    {items.map(({ href, label, icon: Icon, tab }) => {
      const active = isActive(pathname, href);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} style={tabVars(tab)}
        className={`group relative flex min-h-9 items-center gap-3 rounded-md px-3 text-sm font-medium ${transition} ${active ? "bg-(--tab-bg) text-ink" : "text-ink-2 hover:bg-ink/5 hover:text-ink"}`}>
        <span aria-hidden="true" className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-(--tab) ${transition} ${active ? "opacity-100" : "opacity-0"}`} />
        <Icon className={`h-[18px] w-[18px] shrink-0 ${transition} ${active ? "text-(--tab)" : "text-muted group-hover:text-ink"}`} aria-hidden="true" />{label}
      </Link>;
    })}
  </nav>;
}
