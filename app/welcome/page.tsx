// The sign-in page. Signed-out visitors land here from any page and come back
// to it afterwards; signed-in accounts waiting for approval see their status.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand-mark";
import { SignInButtons } from "@/components/auth/sign-in";
import { enabledProviders, readAuthConfig } from "@/lib/auth/config";
import { getAuthentication } from "@/lib/auth/pages";
import { safeReturnTo } from "@/lib/auth/sign-in";

export const metadata: Metadata = { title: "Sign in · 610 Scouting" };

const ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled. Choose an account to continue.",
  state_mismatch: "That sign-in link expired or was opened in a different browser. Please try again.",
  expired: "The sign-in took too long to finish. Please try again.",
  token_invalid: "We couldn't verify the sign-in with your provider. Please try again.",
  exchange_failed: "Your provider didn't respond. Check your connection and try again.",
  email_unverified: "That account's email address isn't verified with the provider.",
  no_email: "Google didn't share an email address for that account. Choose a different Google account.",
  provider_unavailable: "That sign-in option isn't available right now.",
  store_unavailable: "Accounts are temporarily unavailable. Try again in a minute.",
  unavailable: "Sign-in isn't configured on this server yet (see docs/authentication.md).",
};

type Params = Awaited<PageProps<"/welcome">["searchParams"]>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What the page tells the visitor, from the query string and the state of authentication. */
function welcomeMessages(params: Params, auth: Awaited<ReturnType<typeof getAuthentication>>, configured: ReturnType<typeof readAuthConfig>) {
  const errorCode = first(params.error);
  const reason = first(params.reason);
  // "Unavailable" is either missing configuration or an unreachable account store; say which.
  const unavailable = configured.ok ? ERRORS.store_unavailable : ERRORS.unavailable;
  const error = errorCode ? ERRORS[errorCode] ?? "Sign-in failed. Please try again." : auth.status === "unavailable" || reason === "unavailable" ? unavailable : null;
  const notice = !error && reason === "expired" ? "Your session expired. Sign in again to pick up where you left off." : !error && first(params.signedOut) ? "You're signed out." : null;
  // A denied account has no session (turning access off ends every session), so it shows up as a refused sign-in or a signed-out visit with this reason.
  const accessOff = errorCode === "disabled" || reason === "disabled";
  // While developing, say exactly which settings are wrong (names only, never values). Production keeps the generic message.
  const setupProblems = !configured.ok && process.env.NODE_ENV !== "production" ? configured.problems : [];
  return { error, notice, accessOff, setupProblems, errorCode: errorCode ?? reason };
}

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const params = await searchParams;
  const next = safeReturnTo(first(params.next));
  const auth = await getAuthentication();
  if (auth.status === "signed-in" && auth.viewer.principal.status === "active") redirect(next === "/" ? "/teams" : next);

  const configured = readAuthConfig();
  const providers = enabledProviders(configured);
  const { error, notice, accessOff, setupProblems, errorCode } = welcomeMessages(params, auth, configured);

  return <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
    <section className="w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface" aria-labelledby="signin-title">
      <div className="px-6 pb-7 pt-7">
        <BrandMark />
        {accessOff ? <>
          <h1 id="signin-title" className="mt-7 text-[28px] font-semibold leading-9 tracking-[-0.01em]">Access turned off</h1>
          <p className="mt-1 text-sm leading-[22px] text-muted" data-account-status="disabled">A mentor or scout lead has turned off access for this account. If you think this is a mistake, contact them.</p>
        </> : <>
          <h1 id="signin-title" className="mt-7 text-[28px] font-semibold leading-9 tracking-[-0.01em]">Sign in</h1>
          <p className="mt-1 text-sm leading-[22px] text-muted">Sign in with your Google account to continue.</p>
          {error && <p role="alert" className="mt-5 rounded-md border-l-4 border-bad bg-bad-soft px-3 py-2 text-sm text-ink" data-welcome-error={errorCode}>{error}</p>}
          {notice && <p role="status" className="mt-5 rounded-md border-l-4 border-good bg-good-soft px-3 py-2 text-sm text-ink">{notice}</p>}
          {setupProblems.length > 0 && <SetupProblems problems={setupProblems} />}
        </>}
        <div className="mt-6"><SignInButtons providers={providers} next={next} /></div>
      </div>
    </section>
    <p className="mt-5 text-xs text-muted">FRC Team 610 · Crescent Coyotes</p>
  </main>;
}

function SetupProblems({ problems }: { problems: string[] }) {
  return <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs leading-5 text-muted" data-setup-problems>
    <div className="mb-1 text-xs font-semibold text-warn">Development: fix in .env.local, then restart</div>
    <ul className="list-disc pl-4">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
    <div className="mt-1">Run <code className="text-ink">npm run auth:check</code> for details.</div>
  </div>;
}
