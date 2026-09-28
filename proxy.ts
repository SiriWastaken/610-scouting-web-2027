import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: sends visitors without a session cookie to the
// welcome screen before any page work happens, and tells pages which path was
// requested. The real check (is the session valid, is the account active, may
// this role see this page) runs in every page (lib/auth/next.ts) and every API
// route (lib/auth/requests.ts); nothing here is trusted for authorization.
const SESSION_COOKIES = ["__Host-610_session", "610_session"];
const PUBLIC_PAGES = new Set(["/welcome"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const headers = new Headers(request.headers);
  // Never let a client supply this header itself.
  headers.set("x-610-path", `${pathname}${search}`.slice(0, 512));
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!signedIn && !PUBLIC_PAGES.has(pathname) && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: static assets, images, and the favicon are public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
