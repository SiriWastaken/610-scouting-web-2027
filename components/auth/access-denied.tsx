import Link from "next/link";

/** Shown to a signed-in user whose role does not include a page. The server also refuses the page's APIs. */
export function AccessDenied({ title = "You don't have access to this page", message = "Your role doesn't include this area. If you need it, ask an admin or your scout lead to change your role." }: { title?: string; message?: string }) {
  return <div className="mx-auto max-w-lg py-16 text-center">
    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">403 / RESTRICTED</div>
    <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
    <Link href="/teams" className="mt-6 inline-flex rounded-sm border border-[var(--line)] px-4 py-2 text-sm text-[var(--foreground)] hover:border-[var(--green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">Back to the dashboard</Link>
  </div>;
}
