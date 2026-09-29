import type { Io } from "./cli.js";
import { SITE_ORIGIN } from "./client.js";
import { HaziHinamError } from "./errors.js";

export function extractToken(body: unknown): string {
  const token = (body as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new HaziHinamError("LOGIN_FAILED", "The site's login response did not contain an access token. Check the username and password and try again.");
  }
  return token;
}

export async function captureTokenFromBrowser(io: Io, timeoutMs = 5 * 60_000): Promise<string> {
  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch {
    throw new HaziHinamError("BROWSER_UNAVAILABLE", "Browser login needs playwright-core (npm install playwright-core). Or run `hazi-hinam login` and paste the token.");
  }

  const browser = await playwright.chromium.launch({ channel: "chrome", headless: false });
  try {
    const page = await browser.newPage();
    io.stderr("A Chrome window opened. Log in to Hazi Hinam there yourself, including the CAPTCHA. It closes by itself afterwards.\n");
    const loginResponse = page.waitForResponse(
      r => new URL(r.url()).pathname === "/proxy/Login" && r.request().method() === "POST",
      { timeout: timeoutMs },
    );
    await page.goto(SITE_ORIGIN);
    return extractToken(await (await loginResponse).json());
  } finally {
    await browser.close();
  }
}
