// GET /api/auth/callback/<provider> — where Google sends the browser back after sign-in. Exchanges the code,
// verifies the ID token, creates the session and redirects.
import { resolveSignIn } from "@/lib/auth/accounts";
import { recordAudit } from "@/lib/auth/audit";
import { isProviderId } from "@/lib/auth/config";
import { clearCookie, redirectTo, serializeCookie } from "@/lib/auth/requests";
import { completeSignIn, SignInError, stateCookieName, type CallbackParams } from "@/lib/auth/sign-in";
import { authRuntime } from "@/lib/auth/requests";
import { createSession, endPreviousSession, readCookie, sessionCookieName } from "@/lib/auth/sessions";
import { StoreUnavailableError } from "@/lib/auth/store";
import { authMetrics, recordError, scrub } from "@/lib/ops/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE_TEXT = {
  disabled: "Account is disabled",
  no_email: "Provider did not share an email address",
  email_unverified: "Email address is not verified",
} as const;

type SignedIn = Extract<Awaited<ReturnType<typeof resolveSignIn>>, { ok: true }>;

/**
 * Where Google sends the browser back. The code is exchanged here, the ID
 * token is verified, and a new session replaces any existing one (no session
 * fixation).
 */
async function handle(request: Request, provider: string, params: CallbackParams): Promise<Response> {
  const auth = authRuntime();
  if (!auth.ok) return redirectTo("/welcome?error=unavailable");
  const { config, store } = auth;
  const cookieHeader = request.headers.get("cookie");
  const stateName = stateCookieName(config);
  const clearState = clearCookie(stateName, config.secureCookies);
  const fail = (code: string, reason: string, actor?: { id: string; email?: string }) => failSignIn({ store, config, provider, clearState }, code, reason, actor);
  if (!isProviderId(provider)) return fail("provider_unavailable", "Unknown provider");

  try {
    const { identity, returnTo } = await completeSignIn(config, provider, params, readCookie(cookieHeader, stateName));
    const outcome = await resolveSignIn(store, config, identity);
    if (!outcome.ok) {
      if (outcome.reason === "disabled") authMetrics.disabledSignIn();
      return fail(outcome.reason, FAILURE_TEXT[outcome.reason], outcome.userId ? { id: outcome.userId, email: outcome.user?.email } : undefined);
    }
    // Rotate: whatever session this browser had before ends now.
    const sessionName = sessionCookieName(config);
    await endPreviousSession(store, config, outcome.userId, readCookie(cookieHeader, sessionName));
    const session = await createSession(store, config, outcome.userId, provider, request.headers.get("user-agent"));
    await recordSignedIn(store, provider, outcome);
    const sessionCookie = serializeCookie(sessionName, session.token, { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", expires: session.expiresAt });
    return redirectTo(`${config.baseUrl}${returnTo}`, [sessionCookie, clearState]);
  } catch (error) {
    const { code, message } = logSignInError(provider, error);
    return fail(code, message);
  }
}

interface FailContext { store: Parameters<typeof recordAudit>[0]; config: { baseUrl: string }; provider: string; clearState: string }

/** Audits the failed attempt, then sends the browser back to the welcome page with the reason code. */
async function failSignIn({ store, config, provider, clearState }: FailContext, code: string, reason: string, actor?: { id: string; email?: string }) {
  authMetrics.signInFailed(reason);
  await recordAudit(store, { action: "auth.signin", result: code === "disabled" ? "denied" : "failure", actor, reason, meta: { provider, error: code } });
  return redirectTo(`${config.baseUrl}/welcome?error=${encodeURIComponent(code)}`, [clearState]);
}

async function recordSignedIn(store: Parameters<typeof recordAudit>[0], provider: string, outcome: SignedIn) {
  authMetrics.signIn();
  await recordAudit(store, {
    action: outcome.created ? "auth.signup" : "auth.signin", result: "success",
    actor: { id: outcome.userId, email: outcome.user.email, role: outcome.user.role },
    meta: { provider, status: outcome.user.status, linkedNewProvider: outcome.linked },
  });
}

/** Logs what the server needs and returns what the browser may see. */
function logSignInError(provider: string, error: unknown): { code: string; message: string } {
  if (error instanceof SignInError) {
    if (error.code === "exchange_failed" || error.code === "token_invalid") console.error(`Sign in with ${provider} failed: ${error.message}`);
    return { code: error.code, message: error.message };
  }
  // The browser only sees a generic message; the cause (e.g. the account database is missing) goes to the server log.
  console.error(`Sign in with ${provider} failed after the provider approved it: ${scrub(error)}`);
  recordError("auth-callback", error);
  return { code: error instanceof StoreUnavailableError ? "store_unavailable" : "exchange_failed", message: error instanceof Error ? error.message : "Sign-in failed" };
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const query = new URL(request.url).searchParams;
  return handle(request, (await params).provider, { code: query.get("code"), state: query.get("state"), error: query.get("error") });
}

