import { isProviderId } from "@/lib/auth/config";
import { redirectTo, serializeCookie } from "@/lib/auth/http";
import { beginSignIn, SignInError } from "@/lib/auth/oidc";
import { authRuntime } from "@/lib/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts Sign in with Google/Apple: sets the encrypted state cookie and sends the browser to the provider. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const auth = authRuntime();
  if (!auth.ok) return redirectTo("/welcome?error=unavailable");
  if (!isProviderId(provider)) return redirectTo(`${auth.config.baseUrl}/welcome?error=provider_unavailable`);
  try {
    const { url, cookie } = beginSignIn(auth.config, provider, new URL(request.url).searchParams.get("next"));
    return redirectTo(url, [serializeCookie(cookie.name, cookie.value, cookie.options)]);
  } catch (error) {
    const code = error instanceof SignInError ? error.code : "provider_unavailable";
    return redirectTo(`${auth.config.baseUrl}/welcome?error=${code}`);
  }
}
