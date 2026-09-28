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
  // Reduced motion switches off decorative animations (the app honours it), so elements are
  // stable to click even on a loaded machine. Behaviour is otherwise identical.
  const context = await browser.newContext({ reducedMotion: "reduce" });
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

/**
 * The realtime status the page shows right now, or null if it shows none. Reads the DOM directly: a
 * Playwright locator would wait up to 30 s for the element, which once stretched a 20 s wait past two
 * minutes and hid that the page was not the one expected.
 */
export const liveStatus = (page: Page) => page.evaluate(() => document.querySelector("[data-realtime-status]")?.getAttribute("data-realtime-status") ?? null).catch(() => null);

export async function waitForLive(page: Page, timeoutMs = 20_000) {
  let status: string | null = null;
  let text = "";
  await waitFor(async () => {
    status = await liveStatus(page);
    if (status !== "connected") text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "(page text unavailable)");
    return status === "connected";
  }, "page shows live updates", timeoutMs, () => `URL: ${page.url()}\nRealtime status: ${status ?? "(no status element: not a live dashboard page)"}\nPage text:\n${text.slice(0, 1500)}`);
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
