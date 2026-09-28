"use client";

// The sign-in screen's buttons: one per configured provider, with a loading
// state, and sign-out for accounts waiting for approval.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppleIcon, GoogleIcon } from "@/components/auth/identity";
import type { ProviderId } from "@/lib/auth/config";

// ── from welcome-actions.tsx ────────────────────

const LABEL: Record<ProviderId, string> = { google: "Continue with Google", apple: "Continue with Apple" };

export function SignInButtons({ providers, next }: { providers: ProviderId[]; next: string }) {
  const [busy, setBusy] = useState<ProviderId | null>(null);
  if (providers.length === 0) return <p className="text-sm text-[var(--muted)]">No sign-in method is configured on this server.</p>;
  return <div className="space-y-3">
    {providers.map((provider) => {
      const href = `/api/auth/signin/${provider}${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
      const primary = provider === "google";
      return <a key={provider} href={href} data-signin={provider}
        aria-disabled={busy !== null}
        onClick={(event) => { if (busy) { event.preventDefault(); return; } setBusy(provider); }}
        className={`flex h-12 w-full items-center justify-center gap-3 rounded-sm border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green)] ${busy && busy !== provider ? "pointer-events-none opacity-40" : ""} ${primary ? "border-[var(--green)] bg-[var(--green)] text-[#0d1110] hover:bg-[#8fd0a5]" : "border-[var(--line)] bg-[#0f1412] text-[var(--foreground)] hover:border-[var(--muted)]"}`}>
        {busy === provider
          ? <><span className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${primary ? "border-[#0d1110]" : "border-[var(--foreground)]"}`} />Redirecting to {provider === "google" ? "Google" : "Apple"}…</>
          : <>{provider === "google" ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><GoogleIcon className="h-4 w-4" /></span> : <AppleIcon className="h-5 w-5" />}{LABEL[provider]}</>}
      </a>;
    })}
  </div>;
}

export function WelcomeSignOut() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <button type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await fetch("/api/auth/signout", { method: "POST" }); } finally { router.replace("/welcome?signedOut=1"); router.refresh(); setBusy(false); }
  }} className="h-10 rounded-sm border border-[var(--line)] px-4 text-sm hover:border-[var(--muted)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">{busy ? "Signing out…" : "Sign out"}</button>;
}
