// Serves the Next.js app and the realtime WebSocket endpoint from one Node
// process. `next dev` and `next start` cannot accept WebSocket upgrades on an
// app route (Next ends the socket), so both `npm run dev` and `npm start` use this.
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import next from "next";
import { createRealtimeUpgradeHandler } from "../lib/realtime/server.ts";
import { recordHttpRequest } from "../lib/ops/metrics.ts";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST;
const port = Number(process.env.PORT || 3000);

// Next attaches its own `upgrade` listener to `httpServer` on the first request.
// Give it a stand-in so it never sees realtime upgrades; everything else
// (such as dev hot reload) is forwarded to it explicitly below.
const nextUpgrades = new EventEmitter();
const app = next({ dev, hostname, port, httpServer: nextUpgrades });
await app.prepare();

const handle = app.getRequestHandler();
const handleRealtimeUpgrade = createRealtimeUpgradeHandler();
const server = createServer((request, response) => {
  // Request counts, status classes, and latency for the admin panel's API view.
  const started = performance.now();
  response.once("finish", () => recordHttpRequest(request.method ?? "GET", request.url ?? "/", response.statusCode, performance.now() - started));
  return handle(request, response);
});

server.on("upgrade", (request, socket, head) => {
  if (handleRealtimeUpgrade(request, socket, head)) return;
  // Only the dev server uses other upgrades (hot reload). In production Next.js
  // leaves them unanswered, so refuse them rather than hold the socket open.
  if (dev && nextUpgrades.listenerCount("upgrade") > 0) nextUpgrades.emit("upgrade", request, socket, head);
  else socket.destroy();
});

const onListening = () => console.log(`> 610 scouting dashboard ready at http://${hostname || "localhost"}:${port} (${dev ? "development" : "production"})`);
if (hostname) server.listen(port, hostname, onListening);
else server.listen(port, onListening);
