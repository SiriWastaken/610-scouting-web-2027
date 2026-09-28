import type { SVGProps } from "react";

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
