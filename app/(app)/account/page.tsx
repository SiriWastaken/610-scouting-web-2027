import type { Metadata } from "next";
import { AccountPanel } from "@/components/auth/account-panel";
import { requirePage } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Account · 610 Scouting" };

export default async function AccountPage() {
  await requirePage();
  return <div className="mx-auto max-w-[900px]">
    <div className="mb-9 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">ACCOUNT</div><h1 className="text-3xl font-medium tracking-tight">Your account</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">How you appear to the team, your access, and where you&apos;re signed in.</p></div>
    <AccountPanel />
  </div>;
}
