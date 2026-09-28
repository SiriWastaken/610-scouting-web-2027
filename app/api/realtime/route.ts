import { experimental_upgradeWebSocket } from "@vercel/functions";
import { getCouchbaseChangesConfig } from "@/services/couchbase";
import { startCouchbaseLongPoll } from "@/lib/couchbase-longpoll";
import { attachRealtimeBridge, isSameOriginUpgrade, type BridgeSocket } from "@/lib/realtime-bridge";

// Used only on Vercel, whose runtime can upgrade a Route Handler request.
// Locally and on self-hosted Node, scripts/server.mjs handles this path before
// the request reaches Next.js.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isSameOriginUpgrade(request.headers.get("origin"), new URL(request.url).host)) {
    return new Response("Origin not allowed", { status: 403 });
  }
  const config = getCouchbaseChangesConfig();
  if (!config) return new Response("Realtime feed unavailable", { status: 503 });
  return experimental_upgradeWebSocket((client) => {
    attachRealtimeBridge(client as unknown as BridgeSocket,
      (since, onFrame, onReady, onError) => startCouchbaseLongPoll(config, since, onFrame, onReady, onError),
      // Hand the client a clean reconnect before the function's time limit.
      { maxConnectionMs: (maxDuration - 20) * 1000 });
  }, { maxPayload: 8 * 1024 });
}
