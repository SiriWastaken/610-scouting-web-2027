import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/auth/avatar";
import { SignInButtons, WelcomeSignOut } from "@/components/auth/welcome-actions";
import { enabledProviders, readAuthConfig } from "@/lib/auth/config";
import { getAuthentication } from "@/lib/auth/next";
import { safeReturnTo } from "@/lib/auth/oidc";

export const metadata: Metadata = { title: "Welcome · 610 Scouting" };

const ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled. Choose an account to continue.",
  state_mismatch: "That sign-in link expired or was opened in a different browser. Please try again.",
  expired: "The sign-in took too long to finish. Please try again.",
  token_invalid: "We couldn't verify the sign-in with your provider. Please try again.",
  exchange_failed: "Your provider didn't respond. Check your connection and try again.",
  email_unverified: "That account's email address isn't verified with the provider.",
  no_email: "Your provider didn't share an email address. With Apple, choose \"Share My Email\" when signing in.",
  disabled: "This account has been disabled. Ask an admin if you think this is a mistake.",
  provider_unavailable: "That sign-in option isn't available right now.",
  store_unavailable: "Accounts are temporarily unavailable. Try again in a minute.",
  unavailable: "Sign-in isn't configured on this server yet. An admin needs to finish setup (see docs/authentication.md).",
};

const FEATURES = [
  ["01", "Teams", "Every team's matches, pit data, and card reports in one place."],
  ["02", "Averages", "Event-wide statistics you can sort in a click."],
  ["03", "Strategy", "Alliance estimates for the next match."],
  ["04", "Live", "Updates the moment a scout submits, on every open screen."],
];

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const next = safeReturnTo(first(params.next));
  const auth = await getAuthentication();
  if (auth.status === "signed-in" && auth.viewer.principal.status === "active") redirect(next === "/" ? "/teams" : next);

  const configured = readAuthConfig();
  const providers = enabledProviders(configured);
  const errorCode = first(params.error);
  const reason = first(params.reason);
  // "Unavailable" is either missing configuration or an unreachable account store; say which.
  const unavailable = configured.ok ? ERRORS.store_unavailable : ERRORS.unavailable;
  const error = errorCode ? ERRORS[errorCode] ?? "Sign-in failed. Please try again." : auth.status === "unavailable" || reason === "unavailable" ? unavailable : null;
  const notice = !error && reason === "expired" ? "Your session expired. Sign in again to pick up where you left off." : !error && first(params.signedOut) ? "You're signed out." : null;
  const pending = auth.status === "signed-in" ? auth.viewer : null;
  // While developing, say exactly which settings are wrong (names only, never values). Production keeps the generic message.
  const setupProblems = !configured.ok && process.env.NODE_ENV !== "production" ? configured.problems : [];

  return <div className="welcome-scan data-grid relative flex min-h-screen overflow-hidden">
    {/* On phones the sign-in card follows the introduction; on wide screens it sits beside it. */}
    <div className="relative mx-auto grid w-full max-w-6xl content-center gap-10 px-6 py-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-x-12 lg:px-10">
      <section className="rise-in lg:col-start-1 lg:row-start-1 lg:self-end">
        <div className="mb-8 flex items-center gap-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.24em] text-[var(--green)]">610 / SCOUTING</span>
          <span className="h-px w-10 bg-[var(--line)]" />
          <span className="text-xs text-[var(--muted)]">Crescent Coyotes</span>
        </div>
        <h1 className="max-w-xl text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl">Scouting data, <span className="text-[var(--green)]">live</span> from the stands to the drive team.</h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-[var(--muted)]">Team 610&apos;s workspace for the 2027 season. Every match our scouts record lands here in seconds, ready for pick lists and match strategy.</p>
      </section>

      <section className="rise-in [animation-delay:120ms] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center" aria-labelledby="signin-title">
        <div className="border border-[var(--line)] bg-[var(--panel)] shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{pending ? "Account status" : "Sign in"}</span>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--green)]" />2027 season</span>
          </div>
          <div className="px-6 py-7">
            {pending ? <>
              <div className="flex items-center gap-3">
                <Avatar name={pending.user.displayName} picture={pending.user.picture} provider={pending.session.provider} size={44} />
                <div className="min-w-0"><div className="truncate text-sm">{pending.user.displayName}</div><div className="truncate text-xs text-[var(--muted)]">{pending.user.email}</div></div>
              </div>
              <h2 id="signin-title" className="mt-6 text-xl font-medium tracking-tight">{pending.principal.status === "pending" ? "Waiting for approval" : "Account disabled"}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]" data-account-status={pending.principal.status}>{pending.principal.status === "pending" ? "You're signed in. A scout lead or admin needs to approve your account before you can see scouting data. Once you're approved, reload this page to open the dashboard." : ERRORS.disabled}</p>
              <div className="mt-6"><WelcomeSignOut /></div>
            </> : <>
              <h2 id="signin-title" className="text-xl font-medium tracking-tight">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Sign in with the account your team lead approved. New here? Sign in and a lead will approve you.</p>
              {error && <p role="alert" className="mt-5 border-l-2 border-red-400 bg-red-400/10 px-3 py-2 text-sm text-red-200" data-welcome-error={errorCode ?? reason}>{error}</p>}
              {setupProblems.length > 0 && <div className="mt-3 border border-[var(--line)] bg-[#0f1412] px-3 py-2 text-xs leading-5 text-[var(--muted)]" data-setup-problems>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">Development: fix in .env.local, then restart</div>
                <ul className="list-disc pl-4">{setupProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                <div className="mt-1">Run <code className="text-[var(--foreground)]">npm run auth:check</code> for details.</div>
              </div>}
              {notice && <p role="status" className="mt-5 border-l-2 border-[var(--green)] bg-[rgba(120,192,145,0.08)] px-3 py-2 text-sm text-[var(--foreground)]">{notice}</p>}
              <div className="mt-6"><SignInButtons providers={providers} next={next} /></div>
            </>}
          </div>
          <div className="border-t border-[var(--line)] px-6 py-3 text-[11px] leading-5 text-[#64736a]">Signing in shares your name, email, and (with Google) profile photo with the team&apos;s scouting admins.</div>
        </div>
      </section>

      <dl className="rise-in grid max-w-xl grid-cols-1 gap-px border border-[var(--line)] bg-[var(--line)] [animation-delay:200ms] sm:grid-cols-2 lg:col-start-1 lg:row-start-2 lg:self-start">
        {FEATURES.map(([number, title, text]) => <div key={number} className="bg-[var(--panel)] px-4 py-4">
          <dt className="flex items-center gap-2 text-sm"><span className="font-mono text-[10px] text-[var(--green)]">{number}</span>{title}</dt>
          <dd className="mt-1 text-xs leading-5 text-[var(--muted)]">{text}</dd>
        </div>)}
      </dl>
    </div>
  </div>;
}
