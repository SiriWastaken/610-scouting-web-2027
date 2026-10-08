import { experimental_upgradeWebSocket } from "@vercel/functions";
import { getCouchbaseChangesConfig } from "@/lib/data/couchbase-config";
import { startCouchbaseLongPoll } from "@/lib/realtime/couchbase-feed";
import { attachRealtimeBridge, isSameOriginUpgrade, type BridgeSocket } from "@/lib/realtime/bridge";
import { sessionBridgeOptions, upgradeDecision } from "@/lib/realtime/server";
import { authenticateCookieHeader } from "@/lib/auth/requests";
import { realtimeMetrics } from "@/lib/ops/metrics";

// Used only on Vercel, whose runtime can upgrade a Route Handler request.
// Locally and on self-hosted Node, scripts/server.mjs handles this path before
// the request reaches Next.js. Both make the same origin and session checks.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isSameOriginUpgrade(request.headers.get("origin"), new URL(request.url).host)) {
    realtimeMetrics.rejected("origin");
    return new Response("Origin not allowed", { status: 403 });
  }
  const config = getCouchbaseChangesConfig();
  if (!config) { realtimeMetrics.rejected("unconfigured"); return new Response("Realtime feed unavailable", { status: 503 }); }
  const cookie = request.headers.get("cookie");
  const decision = upgradeDecision(await authenticateCookieHeader(cookie));
  if (!decision.ok) { realtimeMetrics.rejected(decision.reason); return new Response(null, { status: decision.status }); }
  return experimental_upgradeWebSocket((client) => attachRealtimeBridge(client as unknown as BridgeSocket,
    (since, onFrame, onReady, onError) => startCouchbaseLongPoll(config, since, onFrame, onReady, onError),
    // Hand the client a clean reconnect before the function's time limit.
    { maxConnectionMs: (maxDuration - 20) * 1000, ...sessionBridgeOptions(decision.viewer, () => authenticateCookieHeader(cookie)) },
  ), { maxPayload: 8 * 1024 });
}
