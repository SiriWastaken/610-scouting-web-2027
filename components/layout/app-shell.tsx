import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/layout/nav-links";
import { AccountChip } from "@/components/auth/session";
import { BrandMark } from "@/components/layout/brand-mark";
import { appConfig } from "@/app.config";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <Sidebar />
      <MobileHeader />
      <main className="min-w-0">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}

/** Desktop navigation. */
function Sidebar() {
  return (
    <aside className="hidden border-r border-line bg-sidebar lg:block">
      <div className="sticky top-0 flex h-screen flex-col px-3 py-5">
        <Link href="/teams" className="mb-6 block rounded-md px-2">
          <BrandMark />
        </Link>
        <NavLinks />
        <div className="mt-auto space-y-3 border-t border-line pt-3">
          <div className="px-3 text-xs text-muted">
            <span className="font-semibold text-ink-2">{appConfig.team.season} season</span> · {appConfig.team.game}
          </div>
          <AccountChip />
        </div>
      </div>
    </aside>
  );
}

/** Tablet and phone: header with a tab strip. */
function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-sidebar/95 backdrop-blur-sm lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/teams" className="rounded-md"><BrandMark /></Link>
        <AccountChip compact />
      </div>
      <NavLinks layout="tabs" />
    </header>
  );
}
