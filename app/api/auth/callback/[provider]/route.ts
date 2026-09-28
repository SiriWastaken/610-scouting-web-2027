import { resolveSignIn } from "@/lib/auth/accounts";
import { recordAudit } from "@/lib/auth/audit";
import { isProviderId } from "@/lib/auth/config";
import { clearCookie, redirectTo, serializeCookie } from "@/lib/auth/http";
import { completeSignIn, SignInError, stateCookieName, type CallbackParams } from "@/lib/auth/oidc";
import { authRuntime } from "@/lib/auth/runtime";
import { createSession, pruneExpiredSessions, readCookie, revokeSession, sessionCookieName } from "@/lib/auth/sessions";
import { StoreUnavailableError } from "@/lib/auth/store";
import { authMetrics, recordError, scrub } from "@/lib/ops/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Google (GET) and Apple (form_post, a cross-site POST) send the browser
 * back. The provider code is exchanged here, the ID token is verified, and a
 * new session replaces any existing one (no session fixation).
 */
async function handle(request: Request, provider: string, params: CallbackParams): Promise<Response> {
  const auth = authRuntime();
  if (!auth.ok) return redirectTo("/welcome?error=unavailable");
  const { config, store } = auth;
  const cookieHeader = request.headers.get("cookie");
  const stateName = stateCookieName(config);
  const clearState = clearCookie(stateName, config.secureCookies);
  const fail = async (code: string, reason: string, actor?: { id: string; email?: string }) => {
    authMetrics.signInFailed(reason);
    await recordAudit(store, { action: "auth.signin", result: code === "disabled" ? "denied" : "failure", actor, reason, meta: { provider, error: code } });
    return redirectTo(`${config.baseUrl}/welcome?error=${encodeURIComponent(code)}`, [clearState]);
  };
  if (!isProviderId(provider)) return fail("provider_unavailable", "Unknown provider");

  try {
    const { identity, returnTo } = await completeSignIn(config, provider, params, readCookie(cookieHeader, stateName));
    const outcome = await resolveSignIn(store, config, identity);
    if (!outcome.ok) {
      if (outcome.reason === "disabled") authMetrics.disabledSignIn();
      return fail(outcome.reason, outcome.reason === "disabled" ? "Account is disabled" : outcome.reason === "no_email" ? "Provider did not share an email address" : "Email address is not verified", outcome.userId ? { id: outcome.userId, email: outcome.user?.email } : undefined);
    }
    // Rotate: whatever session this browser had before ends now.
    const sessionName = sessionCookieName(config);
    await revokeSession(store, readCookie(cookieHeader, sessionName)).catch(() => false);
    await pruneExpiredSessions(store, config, outcome.userId).catch(() => {});
    const session = await createSession(store, config, outcome.userId, provider, request.headers.get("user-agent"));
    authMetrics.signIn(outcome.user.status === "active" ? "active" : "pending");
    await recordAudit(store, {
      action: outcome.created ? "auth.signup" : "auth.signin", result: "success",
      actor: { id: outcome.userId, email: outcome.user.email, role: outcome.user.role },
      meta: { provider, status: outcome.user.status, linkedNewProvider: outcome.linked },
    });
    const sessionCookie = serializeCookie(sessionName, session.token, { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", expires: session.expiresAt });
    const destination = outcome.user.status === "active" ? returnTo : "/welcome";
    return redirectTo(`${config.baseUrl}${destination}`, [sessionCookie, clearState]);
  } catch (error) {
    if (error instanceof SignInError) {
      if (error.code === "exchange_failed" || error.code === "token_invalid") console.error(`Sign in with ${provider} failed: ${error.message}`);
      return fail(error.code, error.message);
    }
    // The browser only sees a generic message; the cause (e.g. the account database is missing) goes to the server log.
    console.error(`Sign in with ${provider} failed after the provider approved it: ${scrub(error)}`);
    recordError("auth-callback", error);
    return fail(error instanceof StoreUnavailableError ? "store_unavailable" : "exchange_failed", error instanceof Error ? error.message : "Sign-in failed");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const query = new URL(request.url).searchParams;
  return handle(request, (await params).provider, { code: query.get("code"), state: query.get("state"), error: query.get("error") });
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  let form: FormData | null = null;
  try { form = await request.formData(); } catch { form = null; }
  const field = (name: string) => { const value = form?.get(name); return typeof value === "string" ? value : null; };
  return handle(request, (await params).provider, { code: field("code"), state: field("state"), error: field("error"), user: field("user") });
}
