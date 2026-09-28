// Real Chromium (via Playwright) for the browser E2E suites. A missing browser
// is a hard failure with instructions, never a skip.
import { chromium, type Browser, type Page } from "playwright";
import { waitFor } from "./wait.ts";

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Chromium could not start. Install it with \`npx playwright install chromium\` (CI: --with-deps).\n${error instanceof Error ? error.message : error}`, { cause: error });
  }
}

/**
 * Opens `path` in a fresh browser context (an independent device/tab) and
 * collects page errors. With `user`, the context carries that account's session
 * cookie (made by tests/helpers/auth.ts through the real account code).
 */
export async function openPage(browser: Browser, base: string, path: string, user?: { cookie: string } | null): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  if (user) {
    const [name, ...value] = user.cookie.split("=");
    await context.addCookies([{ name, value: value.join("="), url: base, httpOnly: true, sameSite: "Lax" }]);
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}${path}`);
  return { page, errors };
}

export const liveStatus = (page: Page) => page.locator("[data-realtime-status]").getAttribute("data-realtime-status");

export async function waitForLive(page: Page, timeoutMs = 20_000) {
  await waitFor(async () => (await liveStatus(page)) === "connected", "page shows live updates", timeoutMs);
}

/** Waits until the page's visible text satisfies `check`. Text is as rendered, so CSS uppercase applies (use /i regexes). */
export async function waitForText(page: Page, check: (text: string) => boolean, message: string, timeoutMs = 15_000) {
  let last = "";
  await waitFor(async () => check(last = await page.locator("body").innerText()), message, timeoutMs, () => `Page text was:\n${last.slice(0, 2000)}`);
}

/** Team numbers in table order, read from the team links. */
export async function teamOrder(page: Page): Promise<number[]> {
  return page.locator("tbody tr a[href^='/teams/'] span:first-child").evaluateAll((spans) => spans.map((span) => Number(span.textContent)));
}
