import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/layout/nav-links";
import { AccountChip } from "@/components/auth/session";
import { BrandMark } from "@/components/layout/brand-mark";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      {/* Desktop: sidebar. */}
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col px-3 py-5">
          <Link href="/teams" className="mb-7 block rounded-md px-2">
            <BrandMark />
          </Link>
          <NavLinks />
          <div className="mt-auto space-y-3">
            <div className="px-3 text-xs text-muted">
              <span className="font-semibold text-ink-2">2026 season</span> · REBUILT
            </div>
            <AccountChip />
          </div>
        </div>
      </aside>
      {/* Tablet and phone: header with a tab strip. */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-sm lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/teams" className="rounded-md"><BrandMark /></Link>
          <AccountChip compact />
        </div>
        <NavLinks layout="tabs" />
      </header>
      <main className="min-w-0">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
