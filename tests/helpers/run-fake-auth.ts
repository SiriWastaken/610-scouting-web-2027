// Starts a fake account store and fake Google/Apple provider for trying
// sign-in locally without real OAuth credentials, and prints the AUTH_*
// variables to put in .env.local (see docs/authentication.md, "Local development").
import { CONFIGURED_OWNER, startTestAuth } from "./auth.ts";

const auth = await startTestAuth({ baseUrl: process.env.AUTH_URL ?? "http://localhost:3000" });
// "Continue with Google" signs in as the configured root account; "Continue with Apple" as a new, unapproved scout.
auth.oidc.setIdentity("google", { sub: "local-owner", email: CONFIGURED_OWNER, emailVerified: true, name: "Local Owner" });
auth.oidc.setIdentity("apple", { sub: "local-apple", email: "new.scout@privaterelay.appleid.com", emailVerified: true, name: "New Scout" });
for (const [name, value] of Object.entries(auth.env())) console.log(`${name}=${value}`);
console.error(`# Fake provider at ${auth.oidc.origin}; accounts live in memory until this process stops.`);
