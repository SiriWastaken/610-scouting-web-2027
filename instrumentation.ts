// Next.js hook that records server errors for the Admin → Overview 'recent errors' list.
import type { Instrumentation } from "next";
import { recordError } from "@/lib/ops/metrics";

/** Server errors from pages and route handlers, for the admin panel's "recent errors" (per process). */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? ` (digest ${String((error as { digest: unknown }).digest).slice(0, 40)})` : "";
  recordError(`next:${context.routeType}`, `${error instanceof Error ? error.message : String(error)}${digest}`, request.path);
};
