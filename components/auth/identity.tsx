// How a person is shown: Google and Apple icons, the avatar (Google photo or
// initials, with a badge for the provider they signed in with), and role and
// account-status badges.
import type { SVGProps } from "react";
import { Ban, CircleCheck, Hourglass } from "lucide-react";
import { ROLE_LABELS, type AccountStatus, type Role } from "@/lib/auth/roles";

// ── Provider icons ──

export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>;
}

export function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 17 20" aria-hidden="true" fill="currentColor" {...props}>
    <path d="M14.12 10.63c-.02-2.33 1.9-3.45 1.99-3.5-1.08-1.59-2.77-1.8-3.37-1.83-1.43-.15-2.8.84-3.53.84-.73 0-1.85-.82-3.04-.8A4.5 4.5 0 0 0 2.4 7.66c-1.63 2.83-.42 7.01 1.17 9.3.78 1.12 1.7 2.38 2.91 2.34 1.17-.05 1.61-.76 3.03-.76 1.41 0 1.81.76 3.05.73 1.26-.02 2.06-1.14 2.83-2.27a10 10 0 0 0 1.28-2.64 4.08 4.08 0 0 1-2.55-3.73zM11.8 3.78A4.1 4.1 0 0 0 12.76.83a4.2 4.2 0 0 0-2.7 1.4 3.93 3.93 0 0 0-.99 2.87c1.03.08 2.07-.52 2.73-1.32z" />
  </svg>;
}

export const providerLabel = (provider: string | null | undefined) => provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Unknown";

export function ProviderIcon({ provider, className }: { provider: string | null | undefined; className?: string }) {
  if (provider === "google") return <GoogleIcon className={className} />;
  if (provider === "apple") return <AppleIcon className={className} />;
  return null;
}

// ── Avatar ──

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Google profile photo when there is one, otherwise initials. A small badge
 * shows which account (Google or Apple) the person signed in with.
 */
export function Avatar({ name, picture, provider, size = 36 }: { name: string; picture?: string | null; provider?: string | null; size?: number }) {
  const badge = Math.max(14, Math.round(size * 0.42));
  return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
    {picture
      // Profile photos are Google-hosted and vary per user, so next/image's allow-list does not fit; no-referrer is what Google expects.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" className="h-full w-full rounded-full border border-line object-cover" />
      : <span aria-hidden="true" className="flex h-full w-full items-center justify-center rounded-full bg-accent-muted font-display font-bold text-accent-text" style={{ fontSize: Math.round(size * 0.36) }}>{initials(name)}</span>}
    {provider && (provider === "google" || provider === "apple") && <span title={`Signed in with ${providerLabel(provider)}`} className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm" style={{ width: badge, height: badge }}>
      <ProviderIcon provider={provider} className="h-[60%] w-[60%]" />
    </span>}
  </span>;
}

// ── Role badge ──

const tone: Record<Role, string> = {
  MEMBER: "border-line text-muted",
  SCOUT: "border-line-strong text-ink",
  SCOUT_LEAD: "border-transparent bg-accent-muted text-accent-text",
  MENTOR: "border-transparent bg-surface-2 text-ink",
  OWNER: "border-transparent bg-warn-soft text-warn",
};

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] ${tone[role]}`}>{ROLE_LABELS[role]}</span>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const style = status === "active" ? "text-good" : status === "pending" ? "text-warn" : "text-bad";
  const Icon = status === "active" ? CircleCheck : status === "pending" ? Hourglass : Ban;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] ${style}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{status}</span>;
}
