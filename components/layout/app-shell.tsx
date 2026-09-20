import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/layout/nav-links";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[224px_1fr]">
      <aside className="border-b border-[var(--line)] bg-[#101614] lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-4 py-5 lg:sticky lg:top-0 lg:h-screen">
          <Link href="/teams" className="mb-8 block px-3">
            <div className="font-mono text-[11px] font-bold tracking-[0.24em] text-[var(--green)]">610 / SCOUTING</div>
            <div className="mt-2 text-xs text-[var(--muted)]">Crescent Coyotes</div>
          </Link>
          <NavLinks />
          <div className="mt-auto hidden border-t border-[var(--line)] px-3 pt-4 lg:block">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">2026 season</div>
            <div className="mt-1 text-xs text-[#64736a]">Data workspace / local mock</div>
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-[var(--line)] px-5 lg:px-8">
        </header>
        <div className="data-grid min-h-[calc(100vh-3.5rem)] px-5 py-7 lg:px-8 lg:py-9">{children}</div>
      </main>
    </div>
  );
}