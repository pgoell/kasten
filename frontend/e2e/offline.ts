/**
 * Offline capture, proved in a real Chromium against the production build.
 *
 * Run with `mise run fe:e2e` after `mise run fe:build`. Outside `tests/` so
 * vitest never collects it: it needs a browser, a build and a server, and
 * each step leans on the state the one before it left, which a test runner's
 * isolation would undo.
 *
 * The bundle is served by a few lines of Bun.serve rather than `vite
 * preview`, because the steps need the server to act as oauth2-proxy does
 * (a 302 to the sign-in for every path) and to answer 404 for a missing
 * `/sw.js` as nginx does. `/api/*` is stubbed with `context.route`, which
 * sees the page's requests whether or not the worker is in control.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, chromium, type Page, type Route } from "playwright";

const DIST = path.resolve(import.meta.dirname, "../dist");
const SHOT =
  process.env.KASTEN_E2E_SHOT ??
  "/tmp/claude-1000/-home-pascal-Code-kasten/5dd8be4d-6dce-4308-b9ea-c590f1e2825a/scratchpad/waiting.png";

if (!existsSync(path.join(DIST, "sw.js"))) {
  console.error("frontend/dist has no sw.js: run `mise run fe:build` first");
  process.exit(1);
}

/** When set, the server answers every path but the sign-in with oauth2-proxy's 302. */
let signedOut = false;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/oauth2/")) {
      return new Response("<!doctype html><title>login</title><p>LOGIN</p>", {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (signedOut) {
      return new Response(null, { status: 302, headers: { Location: "/oauth2/start" } });
    }
    const file = path.join(DIST, path.normalize(pathname));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
      return new Response(Bun.file(file), { headers: { "Cache-Control": "no-cache" } });
    }
    // nginx's `location = /sw.js` and `/assets/` answer 404 rather than the shell.
    if (pathname === "/sw.js" || pathname.startsWith("/assets/")) {
      return new Response(null, { status: 404 });
    }
    return new Response(Bun.file(path.join(DIST, "index.html")), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
    });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

interface Posted {
  id: string;
  text: string;
  date: string;
}

/** Every POST /api/dump body the stub saw, in arrival order. */
const posted: Posted[] = [];
/** What the stub does with a POST /api/dump. */
let answer: "ok" | "lost" | "sign-in" = "ok";
/** Mirrors `setOffline`, so the stub cannot answer a request the network could not carry. */
let offline = false;

async function api(route: Route): Promise<void> {
  if (offline) return route.abort("internetdisconnected");
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (request.method() === "POST" && pathname === "/api/dump") {
    posted.push(request.postDataJSON() as Posted);
    if (answer === "lost") return route.abort("connectionreset");
    if (answer === "sign-in") {
      return route.fulfill({ status: 302, headers: { Location: "https://example.invalid/login" } });
    }
    return route.fulfill({ status: 200, json: { ok: true } });
  }
  // Enough for a page to mount; nothing here reads the vault.
  return route.fulfill({ status: 200, json: pathname === "/api/version" ? {} : [] });
}

async function setOffline(context: BrowserContext, value: boolean): Promise<void> {
  offline = value;
  await context.setOffline(value);
  // Chromium flips `navigator.onLine` under Playwright's emulation but fires
  // no `online` event (seen with Playwright 1.62), which a phone regaining
  // signal does fire. Sent by hand, so the outbox meets what a phone sends it.
  if (!value) {
    for (const open of context.pages()) {
      await open.evaluate(() => window.dispatchEvent(new Event("online")));
    }
  }
}

/** Today in the shape `readClock` names the daily note. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const waitingRows = (page: Page) => page.locator('ul[aria-label="Waiting"] li');

async function type(page: Page, text: string): Promise<void> {
  await page.getByLabel("What is on your mind").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await waitingRows(page).filter({ hasText: text }).waitFor();
}

/** Wait until the list has emptied, or fail naming what is left. */
async function drained(page: Page): Promise<void> {
  await waitingRows(page).first().waitFor({ state: "detached", timeout: 10_000 });
}

let failed = false;

async function step(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    console.log(`PASS ${name}`);
  } catch (error) {
    // The report is the point of the script: each step says PASS or FAIL and
    // the exit code carries any FAIL, so a failed step is printed, not thrown.
    if (!(error instanceof Error)) throw error;
    failed = true;
    console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "allow",
});
await context.route((url) => url.pathname.startsWith("/api/"), api);
let page = await context.newPage();

await step("offline the app opens", async () => {
  await page.goto(`${BASE}/capture`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await setOffline(context, true);
  await page.goto(`${BASE}/capture?text=x`);
  await page.getByLabel("What is on your mind").waitFor({ timeout: 5_000 });
  check((await page.getByLabel("What is on your mind").inputValue()) === "x", "shared text lost");
  await page.goto(`${BASE}/`);
  await page.locator("#root > *").first().waitFor({ timeout: 5_000 });
});

await step("a dump typed offline waits", async () => {
  await page.goto(`${BASE}/capture`);
  await type(page, "first thought");
  await page.screenshot({ path: SHOT });
  await page.close();
  page = await context.newPage();
  await page.goto(`${BASE}/capture`);
  await waitingRows(page).filter({ hasText: "first thought" }).waitFor({ timeout: 5_000 });
  check(posted.length === 0, `the stub saw ${posted.length} posts offline`);
});

await step("back online sends once, in order", async () => {
  await type(page, "second thought");
  await setOffline(context, false);
  await drained(page);
  // A moment for any stray second send to arrive before counting.
  await page.waitForTimeout(500);
  check(
    JSON.stringify(posted.map((one) => one.text)) ===
      JSON.stringify(["first thought", "second thought"]),
    `posted ${JSON.stringify(posted.map((one) => one.text))}`,
  );
  check(new Set(posted.map((one) => one.id)).size === 2, "an id was sent twice");
  check(
    posted.every((one) => one.date === today()),
    `dates ${posted.map((one) => one.date)}`,
  );
});

await step("a lost answer is resent with the same id", async () => {
  posted.length = 0;
  answer = "lost";
  await page.getByLabel("What is on your mind").fill("lost answer");
  await page.getByRole("button", { name: "Send" }).click();
  await waitingRows(page).filter({ hasText: "lost answer" }).waitFor();
  await page.waitForTimeout(500);
  check(posted.length === 1, `first try posted ${posted.length}`);
  answer = "ok";
  await page.reload();
  await drained(page);
  check(posted.length === 2, `posted ${posted.length} in all`);
  check(posted[0]?.id === posted[1]?.id, "the resend carried a new id");
});

await step("a 302 keeps the dump", async () => {
  posted.length = 0;
  answer = "sign-in";
  await page.getByLabel("What is on your mind").fill("needs a sign-in");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("link", { name: "sign in again" }).waitFor({ timeout: 5_000 });
  await waitingRows(page).filter({ hasText: "needs a sign-in" }).waitFor();
  answer = "ok";
  await page.reload();
  await drained(page);
  check(posted.length === 2, `posted ${posted.length}`);
});

await step("a 302 navigation is not cached as the app", async () => {
  signedOut = true;
  await page.goto(`${BASE}/`);
  await page.getByText("LOGIN").waitFor({ timeout: 5_000 });
  check(page.url() === `${BASE}/oauth2/start`, `landed on ${page.url()}`);
  await setOffline(context, true);
  await page.goto(`${BASE}/capture`);
  await page.getByLabel("What is on your mind").waitFor({ timeout: 5_000 });
  check(!(await page.getByText("LOGIN").isVisible()), "the sign-in page answered offline");
});

await browser.close();
await server.stop(true);
process.exit(failed ? 1 : 0);
