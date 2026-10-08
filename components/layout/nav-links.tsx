"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChartCandlestick, ClipboardCheck, ShieldCheck, Sigma, Target, type LucideIcon } from "lucide-react";
import { useSession } from "@/components/auth/session";

type NavItem = { href: string; label: string; icon: LucideIcon };

// Each tab's icon names what the page is for: robots to look up, averages to rank,
// a target for match planning, candlesticks for spread, a checklist for coverage.
const navigation: NavItem[] = [
  { href: "/teams", label: "Teams", icon: Bot },
  { href: "/averages", label: "Averages", icon: Sigma },
  { href: "/strategy", label: "Strategy", icon: Target },
  { href: "/box-plot", label: "Box Plot", icon: ChartCandlestick },
  { href: "/coverage", label: "Coverage", icon: ClipboardCheck },
];
const admin: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck };

function isActive(pathname: string, href: string) {
  return href === "/admin" || href === "/teams" ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;
}

/** Vertical in the desktop sidebar, a scrollable tab strip under the header on tablets and phones. */
export function NavLinks({ layout = "sidebar" }: { layout?: "sidebar" | "tabs" }) {
  const pathname = usePathname();
  const { session } = useSession();
  // Shown only to roles that can use it; the admin pages and APIs enforce this themselves.
  const items = session.admin ? [...navigation, admin] : navigation;
  // One accent for every tab: the active item gets a soft green pill and a green icon; the rest are neutral.
  // The pill (and the bar under it in the phone tab strip) carries the state too, so it reads in grayscale.
  const transition = "transition-[background-color,color,opacity] duration-150 ease-out";
  if (layout === "tabs") {
    return <nav className="-mb-px flex gap-1 overflow-x-auto px-3 [scrollbar-width:none]" aria-label="Main navigation">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}
          className={`relative flex min-h-11 min-w-max items-center gap-2 rounded-md px-3 text-sm font-medium ${transition} ${active ? "bg-accent-muted text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"}`}>
          <Icon className={`h-4 w-4 ${transition} ${active ? "text-accent-text" : ""}`} aria-hidden="true" />{label}
          <span aria-hidden="true" className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-text ${transition} ${active ? "opacity-100" : "opacity-0"}`} />
        </Link>;
      })}
    </nav>;
  }
  return <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
    {items.map(({ href, label, icon: Icon }) => {
      const active = isActive(pathname, href);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}
        className={`group flex min-h-9 items-center gap-3 rounded-md px-3 text-sm font-medium ${transition} ${active ? "bg-accent-muted text-ink" : "text-ink-2 hover:bg-ink/5 hover:text-ink"}`}>
        <Icon className={`h-[18px] w-[18px] shrink-0 ${transition} ${active ? "text-accent-text" : "text-muted group-hover:text-ink"}`} aria-hidden="true" />{label}
      </Link>;
    })}
  </nav>;
}
