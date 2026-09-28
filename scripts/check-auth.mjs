// `npm run auth:check`: checks sign-in configuration and the account store from
// this machine, using the app's own code and the same environment `npm run dev`
// loads (.env.local, .env). Prints what to fix; never prints secrets.
//
// It writes, reads back, and deletes one short-lived `diag_*` document in the
// account store (sign-in needs to write there too). Scouting data is never touched.
import { createPrivateKey } from "node:crypto";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

const { readAuthConfig, enabledProviders, storeKeyspace } = await import("../lib/auth/config.ts");
const { AuthStore, StoreUnavailableError } = await import("../lib/auth/store.ts");
const { appleClientSecret } = await import("../lib/auth/jwt.ts");

let failures = 0;
const ok = (message) => console.log(`  ✔ ${message}`);
const bad = (message, fix) => { failures += 1; console.log(`  ✖ ${message}${fix ? `\n      → ${fix}` : ""}`); };
const note = (message) => console.log(`  • ${message}`);
const section = (title) => console.log(`\n${title}`);

section("Configuration");
const result = readAuthConfig();
if (!result.ok) {
  for (const problem of result.problems) bad(problem);
  console.log("\nSee docs/authentication.md#environment-variables.");
  process.exit(1);
}
const { config } = result;
ok(`AUTH_URL is ${config.baseUrl} (open the app at exactly this address; cookies and redirects are tied to it)`);
if (config.endpointOverride) note(`AUTH_OIDC_ENDPOINT_OVERRIDE points sign-in at ${config.endpointOverride} (test/local only)`);
const port = process.env.PORT || "3000";
const url = new URL(config.baseUrl);
if (["localhost", "127.0.0.1"].includes(url.hostname) && (url.port || (url.protocol === "https:" ? "443" : "80")) !== port) {
  bad(`AUTH_URL uses port ${url.port || "(default)"} but the dev server listens on ${port}`, "make them match, or sign-in returns to a different origin than the one you opened");
}
if (url.protocol === "https:" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
  bad("AUTH_URL is https on localhost, but `npm run dev` serves plain http", "use http://localhost:3000 locally; Secure cookies from an https AUTH_URL are not sent over http");
}
for (const provider of enabledProviders(result)) {
  ok(`${provider === "google" ? "Google" : "Apple"} enabled; its redirect URI must be registered exactly as ${config.baseUrl}/api/auth/callback/${provider}`);
}
if (config.providers.apple?.apple) {
  try {
    createPrivateKey(config.providers.apple.apple.privateKey);
    appleClientSecret(config.providers.apple.apple, config.providers.apple.clientId, config.providers.apple.issuer);
    ok("Apple private key parses and signs a client secret");
  } catch (error) {
    bad(`AUTH_APPLE_PRIVATE_KEY cannot be used: ${error instanceof Error ? error.message : error}`, "paste the whole .p8 file, including the BEGIN/END lines (\\n line breaks are fine)");
  }
}
if (config.rootEmails.size === 0) note("AUTH_ROOT_EMAILS is empty: nobody will be able to open the admin panel until someone is made ROOT");
else ok(`${config.rootEmails.size} configured root email(s)`);

section(`Account store: "${storeKeyspace(config.store)}" at ${new URL(config.store.url).origin}`);
if (config.store.collection !== "_default") note(`Accounts live in collection "${config.store.scope}.${config.store.collection}" of database "${config.store.database}"`);
try {
  const root = await fetch(`${config.store.url}/`, { signal: AbortSignal.timeout(8000) });
  const body = await root.json().catch(() => ({}));
  if (root.ok) ok(`Sync Gateway answers (${body.version ?? body.vendor?.version ?? "version unknown"})`);
  // Capella App Services does not always serve the root path; the database checks below are what matter.
  else note(`Server root answered HTTP ${root.status} (normal on Capella App Services)`);
} catch (error) {
  bad(`Cannot reach ${new URL(config.store.url).origin}: ${error instanceof Error ? error.cause?.code ?? error.name : error}`, "check AUTH_STORE_URL / COUCHBASE_SYNC_GATEWAY_URL and your network/VPN");
  process.exit(1);
}

const store = new AuthStore(config.store);
const step = async (label, run) => {
  try { const detail = await run(); ok(detail ? `${label}: ${detail}` : label); return true; }
  catch (error) {
    bad(`${label}: ${error instanceof Error ? error.message : error}`, error instanceof StoreUnavailableError ? undefined : "unexpected error; see the stack above");
    if (!(error instanceof StoreUnavailableError)) console.error(error);
    return false;
  }
};
const reachable = await step("Database and credentials", async () => { const info = await store.info(); return `state ${info.state}, ${info.latencyMs} ms`; });
if (reachable) {
  await step("Read a document that does not exist (404 as expected)", async () => { if (await store.get(`diag_probe_${Date.now()}`) !== null) throw new Error("expected no document"); });
  const id = `diag_authcheck_${Date.now()}`;
  let rev;
  const wrote = await step("Create a document (sign-in creates accounts and sessions)", async () => { rev = await store.create(id, { type: "diagnostic", at: new Date().toISOString() }); });
  if (wrote) {
    await step("Update it with its revision (sign-in updates accounts)", async () => { rev = await store.update(id, rev, { type: "diagnostic", updated: true }); });
    await step("Read it back", async () => { const doc = await store.get(id); if (!doc?.body.updated) throw new Error("the read-back document does not match"); });
    await step("List by id prefix (_all_docs; sessions and the user list use this)", async () => { const rows = await store.list("diag_authcheck_"); if (!rows.some((row) => row.id === id)) throw new Error("the new document is not listed"); return `${rows.length} row(s)`; });
    await step("Delete it", async () => { await store.remove(id, rev); });
  }
}

section("Providers");
for (const provider of enabledProviders(result)) {
  const jwks = config.providers[provider].jwksUri;
  try {
    const response = await fetch(jwks, { signal: AbortSignal.timeout(8000) });
    const keys = (await response.json()).keys ?? [];
    if (response.ok && keys.length) ok(`${provider} signing keys reachable (${keys.length})`);
    else bad(`${provider} signing keys returned HTTP ${response.status}`);
  } catch (error) {
    bad(`${provider} signing keys unreachable from this machine: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(failures ? `\n✖ ${failures} problem(s). Fix them, then run npm run auth:check again.` : "\n✔ Sign-in configuration and account store look good.");
process.exit(failures ? 1 : 0);
