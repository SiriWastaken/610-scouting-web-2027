"use client";

// The sign-in screen's button (Google), with a loading state.
import { useState } from "react";
import { GoogleIcon } from "@/components/auth/identity";
import type { ProviderId } from "@/lib/auth/config";

// ── Welcome actions ──

const LABEL: Record<ProviderId, string> = { google: "Continue with Google" };

/**
 * One sign-in button per configured provider ('Continue with Google') for the welcome page; shows a 
 * redirecting state once clicked.
 */
export function SignInButtons({ providers, next }: { providers: ProviderId[]; next: string }) {
  const [busy, setBusy] = useState<ProviderId | null>(null);
  if (providers.length === 0) return <p className="text-sm text-muted">No sign-in method is configured on this server.</p>;
  return <div className="space-y-3">
    {providers.map((provider) => {
      const href = `/api/auth/signin/${provider}${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
      return <a key={provider} href={href} data-signin={provider}
        aria-disabled={busy !== null}
        onClick={(event) => { if (busy) { event.preventDefault(); return; } setBusy(provider); }}
        className={`flex h-12 w-full items-center justify-center gap-3 rounded-md border border-line-strong bg-surface text-sm font-semibold text-ink transition-colors hover:bg-surface-2 ${busy && busy !== provider ? "pointer-events-none opacity-40" : ""}`}>
        {busy === provider
          ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />Redirecting to Google…</>
          : <><GoogleIcon className="h-[18px] w-[18px]" />{LABEL[provider]}</>}
      </a>;
    })}
  </div>;
}
