// Starts the real dashboard server (`scripts/server.mjs`: Next.js plus the
// realtime WebSocket endpoint) as a child process, the way `npm start` does.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { waitFor } from "./wait.ts";

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export interface AppServer { base: string; port: number; output(): string; stop(): Promise<void>; restart(): Promise<void> }

export async function startAppServer(env: Record<string, string>, port?: number): Promise<AppServer> {
  const mode = process.env.E2E_MODE === "dev" ? "development" : "production";
  // Never let a missing build turn into a confusing timeout or a silent pass.
  if (mode === "production" && !existsSync(".next/BUILD_ID")) throw new Error("No production build found. Run `npm run build` before the E2E suite (npm run test:e2e does this for you).");
  const listenPort = port ?? await freePort();
  let output = "";
  let child: ChildProcess;
  const launch = async () => {
    output += `\n--- starting server (${mode}) on ${listenPort} ---\n`;
    child = spawn(process.execPath, ["--experimental-strip-types", "scripts/server.mjs"], {
      env: { ...process.env, NODE_ENV: mode, PORT: String(listenPort), HOST: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    let exited: number | null = null;
    child.once("exit", (code) => { exited = code ?? -1; });
    const marker = output.length;
    await waitFor(() => {
      if (exited !== null) throw new Error(`Dashboard server exited with code ${exited} before it was ready:\n${output.slice(-3000)}`);
      return output.slice(marker).includes("dashboard ready");
    }, "dashboard server start", 90_000, () => output.slice(-3000));
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited; clearTimeout(timer);
  };
  await launch();
  return { base: `http://127.0.0.1:${listenPort}`, port: listenPort, output: () => output, stop, restart: async () => { await stop(); await launch(); } };
}
