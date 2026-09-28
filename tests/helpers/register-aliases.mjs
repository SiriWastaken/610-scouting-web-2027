// Loaded with `node --import` by the test bench so tests can import the app's
// server modules directly: resolves the `@/` path alias from tsconfig.json to
// `.ts` files and stubs `server-only` (Next.js provides it inside the app; in a
// plain Node process it would throw on purpose).
import { registerHooks } from "node:module";
import { statSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const isFile = (url) => { try { return statSync(url).isFile(); } catch { return false; } };

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      const found = [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => isFile(new URL(candidate)));
      if (found) return nextResolve(found, context);
    }
    return nextResolve(specifier, context);
  },
});
