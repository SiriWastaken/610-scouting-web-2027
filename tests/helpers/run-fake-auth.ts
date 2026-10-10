// Starts a fake account store and fake Google provider for trying
// sign-in locally without real OAuth credentials, and prints the AUTH_*
// variables to put in .env.local (see docs/10-authentication.md, "Local development").
import { CONFIGURED_OWNER, startTestAuth } from "./auth.ts";

const auth = await startTestAuth({ baseUrl: process.env.AUTH_URL ?? "http://localhost:3000" });
// "Continue with Google" signs in as the configured Owner. Change the identity below to try signing in as someone new.
auth.oidc.setIdentity("google", { sub: "local-owner", email: CONFIGURED_OWNER, emailVerified: true, name: "Local Owner" });
for (const [name, value] of Object.entries(auth.env())) console.log(`${name}=${value}`);
console.error(`# Fake provider at ${auth.oidc.origin}; accounts live in memory until this process stops.`);
