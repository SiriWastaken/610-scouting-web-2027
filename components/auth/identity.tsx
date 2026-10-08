// How a person is shown: the Google icon, the avatar (Google photo or
// initials), and role and account-status badges.
import type { SVGProps } from "react";
import { Ban, CircleCheck } from "lucide-react";
import { ROLE_LABELS, type AccountStatus, type Role } from "@/lib/auth/roles";

// ── Provider icon ──

export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>;
}

/** "Google"; an account that once used a provider that has been removed shows its name as saved. */
export const providerLabel = (provider: string | null | undefined) => provider ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : "Unknown";

export function ProviderIcon({ provider, className }: { provider: string | null | undefined; className?: string }) {
  return provider === "google" ? <GoogleIcon className={className} /> : null;
}

// ── Avatar ──

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Google profile photo when there is one, otherwise initials on a soft green circle. */
export function Avatar({ name, picture, size = 36 }: { name: string; picture?: string | null; size?: number }) {
  return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
    {picture
      // Profile photos are Google-hosted and vary per user, so next/image's allow-list does not fit; no-referrer is what Google expects.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" className="h-full w-full rounded-full border border-line object-cover" />
      : <span aria-hidden="true" className="flex h-full w-full items-center justify-center rounded-full bg-accent-muted font-bold text-accent-text" style={{ fontSize: Math.round(size * 0.36) }}>{initials(name)}</span>}
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
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${tone[role]}`}>{ROLE_LABELS[role]}</span>;
}

/** Active, or Denied (access turned off by a manager). Always an icon and a word. */
export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const active = status === "active";
  const Icon = active ? CircleCheck : Ban;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${active ? "text-good" : "text-bad"}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{active ? "Active" : "Denied"}</span>;
}
