import { ProviderIcon, providerLabel } from "@/components/auth/provider-icons";

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
      ? <img src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" className="h-full w-full rounded-full border border-[var(--line)] object-cover" />
      : <span aria-hidden="true" className="flex h-full w-full items-center justify-center rounded-full border border-[rgba(120,192,145,0.35)] bg-[rgba(120,192,145,0.12)] font-mono font-bold text-[var(--green)]" style={{ fontSize: Math.round(size * 0.36) }}>{initials(name)}</span>}
    {provider && (provider === "google" || provider === "apple") && <span title={`Signed in with ${providerLabel(provider)}`} className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border border-[var(--line)] bg-[#0d1110] text-[var(--foreground)]" style={{ width: badge, height: badge }}>
      <ProviderIcon provider={provider} className="h-[60%] w-[60%]" />
    </span>}
  </span>;
}
