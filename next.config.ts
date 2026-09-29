import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import packageJson from "./package.json" with { type: "json" };

function gitCommit(): string {
  try { return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

const nextConfig: NextConfig = {
  // Shown in the admin panel's system overview. Inlined at build time; none of these are secret.
  env: {
    APP_VERSION: packageJson.version,
    APP_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || gitCommit(),
    APP_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // The dashboard is never framed (clickjacking on admin actions), never sniffed, and never leaks paths to other sites.
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
