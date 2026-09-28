"use client";

import Link from "next/link";
import { Avatar } from "@/components/auth/avatar";
import { useSession } from "@/components/auth/session-provider";
import { ROLE_LABELS } from "@/lib/auth/roles";

function SignOutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" /><path d="M10.5 11.5 14 8l-3.5-3.5" /><path d="M14 8H6" /></svg>;
}

/** The signed-in account in the sidebar's bottom corner (full) or the mobile header (compact), with sign-out. */
export function AccountChip({ compact = false }: { compact?: boolean }) {
  const { session: { user, session }, signOut, signingOut } = useSession();
  const provider = session.provider ?? user.lastSignInProvider;
  if (compact) {
    return <div className="flex items-center gap-2" data-account-chip>
      <Link href="/account" aria-label={`Account: ${user.displayName}`} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green)]"><Avatar name={user.displayName} picture={user.picture} provider={provider} size={30} /></Link>
      <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" className="rounded-sm p-2 text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]"><SignOutIcon /></button>
    </div>;
  }
  return <div className="flex items-center gap-2 rounded-sm border border-[var(--line)] bg-[var(--panel)] p-2" data-account-chip>
    <Link href="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-sm p-1 hover:bg-[var(--panel-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">
      <Avatar name={user.displayName} picture={user.picture} provider={provider} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-[var(--foreground)]" data-account-name>{user.displayName}</span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]" data-account-role={user.role}>{ROLE_LABELS[user.role]}</span>
      </span>
    </Link>
    <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" title="Sign out" className="rounded-sm p-2 text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">
      {signingOut ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" /> : <SignOutIcon />}
    </button>
  </div>;
}
