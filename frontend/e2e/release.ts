/**
 * A tab left open across a release, proved in Chromium against two builds (#379).
 *
 * Run with `mise run fe:e2e:release`, which builds release N into
 * `dist-e2e-a` and N+1 into `dist-e2e-b` (every asset renamed by
 * `e2e/release-b.config.ts`), then runs this. The server serves A until a
 * scenario calls `release()`, then B, and answers 404 for an asset B has not
 * got, as nginx does. Each scenario gets a fresh context, because TanStack's
 * once-per-message reload guard lives in the tab's `sessionStorage` and a
 * second scenario in the same tab would meet the first one's guard.
 *
 * The app has no `<Link>` to another route, so a route change is driven the
 * way a link would end up driving it: `router.navigate`, the router found on
 * `RouterProvider`'s fiber. Nothing in `src/` is changed for the test.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page, type Route } from "playwright";

const A = path.resolve(import.meta.dirname, "../dist-e2e-a");
const B = path.resolve(import.meta.dirname, "../dist-e2e-b");
for (const dir of [A, B]) {
  if (!existsSync(path.join(dir, "sw.js"))) {
    console.error(`${dir} has no sw.js: run \`mise run fe:e2e:release\``);
    process.exit(1);
  }
}

let dist = A;
const release = () => {
  dist = B;
};

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const { pathname } = new URL(request.url);
    const file = path.join(dist, path.normalize(pathname));
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
      return new Response(Bun.file(file), { headers: { "Cache-Control": "no-cache" } });
    }
    if (pathname === "/sw.js" || pathname.startsWith("/assets/")) {
      return new Response(null, { status: 404 });
    }
    return new Response(Bun.file(path.join(dist, "index.html")), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
    });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

const NOTE = "s1.md";
/** The note as the stub's vault holds it. */
let stored = "hello\n";
/** Every PUT body for the note, in arrival order, with what the stub did with it. */
const puts: { content: string; afterRouteChange: boolean; landed: boolean }[] = [];
/** Set as the route change starts, so a PUT from then on is the page leaving. */
let navigated = false;
/** When set, the next PUT is held unanswered: the write in the air at the reload. */
let holdNext = false;
const held: Route[] = [];

async function api(route: Route): Promise<void> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (pathname === "/api/events") return route.fulfill({ status: 204 });
  if (pathname === `/api/files/${NOTE}`) {
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { content: string };
      // Playwright shows no keepalive flag, so a write is placed by when it came.
      const after = navigated;
      if (holdNext) {
        holdNext = false;
        puts.push({ content: body.content, afterRouteChange: after, landed: false });
        held.push(route);
        return;
      }
      puts.push({ content: body.content, afterRouteChange: after, landed: true });
      stored = body.content;
      return route.fulfill({ status: 200, json: { path: NOTE, content: stored } });
    }
    return route.fulfill({ status: 200, json: { path: NOTE, content: stored } });
  }
  if (pathname === "/api/files") return route.fulfill({ status: 200, json: [NOTE] });
  return route.fulfill({ status: 200, json: pathname === "/api/version" ? {} : [] });
}

interface Watch {
  errors: string[];
  failed: string[];
  loads: number;
}

/** Collect what the report needs from one page. */
function watch(page: Page): Watch {
  const seen: Watch = { errors: [], failed: [], loads: 0 };
  page.on("console", (message) => {
    if (message.type() === "error") seen.errors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => seen.errors.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on("requestfailed", (request) =>
    seen.failed.push(`${request.url().replace(BASE, "")} ${request.failure()?.errorText}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      seen.failed.push(`${response.url().replace(BASE, "")} ${response.status()}`);
    }
  });
  page.on("load", () => {
    seen.loads++;
  });
  return seen;
}

async function fresh(browser: Browser, serviceWorkers: "allow" | "block"): Promise<BrowserContext> {
  dist = A;
  const context = await browser.newContext({ serviceWorkers });
  await context.route((url) => url.pathname.startsWith("/api/"), api);
  // Counted in `sessionStorage`, which a reload keeps and a new tab does not.
  await context.addInitScript(() => {
    const bump = (key: string) =>
      sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1));
    bump("e2e:documents");
    window.addEventListener("vite:preloadError", () => bump("e2e:preloadError"));
  });
  return context;
}

/** Mark the document, so a later read can tell whether it was replaced. */
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { e2eMark: number }).e2eMark = 1;
  });

/** The router `RouterProvider` was handed, found by walking React's fibers from #root. */
async function routerCall(page: Page, call: "navigate" | "preloadRoute", to: string) {
  return page.evaluate(
    ({ call, to }) => {
      type Fiber = { child?: Fiber; sibling?: Fiber; memoizedProps?: { router?: unknown } };
      const root = document.getElementById("root") as unknown as Record<string, Fiber>;
      const key = Object.keys(root).find((one) => one.startsWith("__reactContainer$"));
      const stack: (Fiber | undefined)[] = [key === undefined ? undefined : root[key]];
      while (stack.length > 0) {
        const fiber = stack.pop();
        if (fiber === undefined) continue;
        const router = fiber.memoizedProps?.router as
          | Record<string, (options: { to: string }) => Promise<unknown>>
          | undefined;
        if (router !== undefined) {
          // Not awaited: a reload part way through would take the answer with it.
          void router[call]({ to }).catch(() => undefined);
          return true;
        }
        stack.push(fiber.sibling, fiber.child);
      }
      return false;
    },
    { call, to },
  );
}

interface State {
  url: string;
  release: string;
  marked: boolean;
  documents: number;
  preloadErrors: number;
  reloadGuards: string[];
  review: boolean;
  root: string;
}

async function state(page: Page): Promise<State> {
  const review = await page
    .getByText("No decks.")
    .isVisible()
    .catch(() => false);
  return page.evaluate(
    (review) => ({
      url: location.pathname + location.search,
      release: [...document.querySelectorAll("script[src]")].some((one) =>
        (one as HTMLScriptElement).src.includes("-b."),
      )
        ? "B"
        : "A",
      marked: (window as unknown as { e2eMark?: number }).e2eMark === 1,
      documents: Number(sessionStorage.getItem("e2e:documents") ?? 0),
      preloadErrors: Number(sessionStorage.getItem("e2e:preloadError") ?? 0),
      reloadGuards: Object.keys(sessionStorage).filter((one) =>
        one.startsWith("tanstack_router_reload:"),
      ),
      review,
      root: (document.getElementById("root")?.innerText ?? "").slice(0, 160).replace(/\s+/g, " "),
    }),
    review,
  );
}

/** Wait for the route change to settle, long enough to see a reload loop. */
async function settle(page: Page): Promise<void> {
  await page
    .getByText("No decks.")
    .waitFor({ timeout: 8_000 })
    .catch(() => undefined);
  await page.waitForTimeout(3_000);
}

let failed = false;

function report(name: string, pass: boolean, evidence: Record<string, unknown>): void {
  if (!pass) failed = true;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  for (const [key, value] of Object.entries(evidence)) {
    console.log(`  ${key}: ${JSON.stringify(value)}`);
  }
}

const cacheNames = (page: Page) =>
  page.evaluate(async () => (await caches.keys()).filter((one) => one.startsWith("kasten-")));

/** Type into the open note's editor, in insert mode whether or not vim is on. */
async function type(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  if (await page.locator(".cm-fat-cursor").count()) await page.keyboard.press("i");
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

const browser = await chromium.launch();

// S1 and S4: the worker in control, a note being typed into, the release, the route change.
{
  const context = await fresh(browser, "allow");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`${BASE}/?note=${NOTE}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.locator(".cm-content").getByText("hello").waitFor({ timeout: 10_000 });
  const before = await cacheNames(page);

  // One write lands, the next is held in the air, the last is still in the quiet period.
  await type(page, " one");
  await page.waitForTimeout(1_500);
  holdNext = true;
  await type(page, " two");
  await page.waitForTimeout(1_500);
  await type(page, " three");
  const onScreen = await page.locator(".cm-content").innerText();

  release();
  const other = await context.newPage();
  await other.goto(`${BASE}/`);
  await other.evaluate(() => navigator.serviceWorker.ready);
  let after: string[] = [];
  for (let tries = 0; tries < 50; tries++) {
    after = await cacheNames(page);
    if (after.length === 1 && !before.includes(after[0] ?? "")) break;
    await page.waitForTimeout(200);
  }
  const controller = await page.evaluate(() => navigator.serviceWorker.controller?.state);
  await other.close();

  await mark(page);
  navigated = true;
  const found = await routerCall(page, "navigate", "/review");
  await settle(page);
  const end = await state(page);
  report(
    "S1 worker in control, client-side route change after the release",
    // One reload at most: a second would be the start of a loop.
    end.review && end.release === "B" && end.documents <= 2,
    {
      routerFound: found,
      cachesBefore: before,
      cachesAfter: after,
      oldCacheDeleted: after.every((one) => !before.includes(one)),
      controllerAfterClaim: controller,
      ...end,
      reloaded: !end.marked,
      pageLoadEvents: seen.loads,
      errors: seen.errors,
      failed: seen.failed,
    },
  );

  // S4: after the reload, where did " three" end up?
  for (const route of held) await route.abort("connectionreset").catch(() => undefined);
  await page.waitForTimeout(1_000);
  const heldStore = await page.evaluate(() => localStorage.getItem("kasten.held.2"));
  await page.goto(`${BASE}/?note=${NOTE}`);
  await page.locator(".cm-content").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1_500);
  const reopened = await page.locator(".cm-content").innerText();
  const landed = puts.filter((one) => one.landed).map((one) => one.content);
  // No older text after newer: every landed body holds at least what the one before it held.
  const ordered = landed.every(
    (content, index) => index === 0 || content.length >= (landed[index - 1] ?? "").length,
  );
  const latest = "three";
  const kept =
    landed.some((one) => one.includes(latest)) ||
    (heldStore ?? "").includes(latest) ||
    reopened.includes(latest);
  report("S4 text typed before the route change survives the reload", kept && ordered, {
    typedOnScreenBefore: onScreen,
    puts,
    heldAfterReload: heldStore,
    reopenedNoteShows: reopened,
    storedByStub: stored,
    landedInOrder: ordered,
  });
  await context.close();
}

// S2: no worker, the same route change.
{
  const context = await fresh(browser, "block");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`${BASE}/`);
  await page.locator("#root > *").first().waitFor();
  await page.waitForTimeout(1_000);
  release();
  await mark(page);
  const found = await routerCall(page, "navigate", "/review");
  await settle(page);
  const end = await state(page);
  report(
    "S2 no worker, client-side route change after the release",
    end.review && end.release === "B" && end.documents <= 2,
    {
      routerFound: found,
      ...end,
      reloaded: !end.marked,
      pageLoadEvents: seen.loads,
      errors: seen.errors,
      failed: seen.failed,
    },
  );
  await context.close();
}

// S3: a preload of the gone route must not reload the page by itself.
{
  const context = await fresh(browser, "block");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`${BASE}/`);
  await page.locator("#root > *").first().waitFor();
  await page.waitForTimeout(1_000);
  release();
  await mark(page);
  const found = await routerCall(page, "preloadRoute", "/review");
  await page.waitForTimeout(4_000);
  const end = await state(page);
  report(
    "S3 an intent preload of a gone chunk does not reload",
    end.marked && end.documents === 1 && end.url === "/",
    {
      routerFound: found,
      note: "the app renders no <Link>, so no hover can preload; driven through router.preloadRoute, which is what a Link's intent preload calls",
      ...end,
      reloaded: !end.marked,
      pageLoadEvents: seen.loads,
      errors: seen.errors,
      failed: seen.failed,
    },
  );
  await context.close();
}

// S5: A's worker in control and no tab on B yet, so A's cache still holds A's chunks.
{
  const context = await fresh(browser, "allow");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`${BASE}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.locator("#root > *").first().waitFor();
  release();
  await mark(page);
  const found = await routerCall(page, "navigate", "/review");
  await settle(page);
  const end = await state(page);
  report(
    "S5 worker A in control, no tab on B: the route renders from A's cache",
    end.review &&
      end.release === "A" &&
      end.marked &&
      end.documents === 1 &&
      !seen.failed.some((one) => one.includes(" 404")),
    {
      routerFound: found,
      ...end,
      reloaded: !end.marked,
      pageLoadEvents: seen.loads,
      errors: seen.errors,
      failed: seen.failed,
    },
  );
  await context.close();
}

// S6: the other way round, a tab opened on /review going to the home route,
// as review.tsx does to open a parked note. The home route's chunk lists a
// stylesheet among its preloads (see I1).
{
  const context = await fresh(browser, "block");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`${BASE}/review`);
  await page.getByText("No decks.").waitFor();
  release();
  await mark(page);
  const found = await routerCall(page, "navigate", "/");
  await page.waitForTimeout(6_000);
  const end = await state(page);
  report(
    "S6 no worker, /review to / after the release",
    end.root.includes("VAULT") && end.release === "B" && end.documents <= 2,
    {
      routerFound: found,
      ...end,
      reloaded: !end.marked,
      pageLoadEvents: seen.loads,
      errors: seen.errors,
      failed: seen.failed,
    },
  );
  await context.close();
}

// I1: which lazy chunks preload a stylesheet. Recorded, not asserted: a gone
// stylesheet throws "Unable to preload CSS", which TanStack's
// `isModuleNotFoundError` does not match, and kasten's `RouteError` reloads
// for it instead. S6 is the proof for the home route, which has one.
{
  const assets = path.join(A, "assets");
  const css = readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => {
      const lists = readFileSync(path.join(assets, name), "utf8").match(/m\.f=\[[^\]]*\]/g) ?? [];
      return lists.flatMap((list) =>
        (list.match(/"[^"]*\.css"/g) ?? []).map((one) => `${name} preloads ${one}`),
      );
    });
  console.log("INFO I1 lazy chunks that preload a stylesheet (S6 covers the reload)");
  console.log(`  found: ${JSON.stringify(css.length === 0 ? "none" : css)}`);
}

await browser.close();
await server.stop(true);
process.exit(failed ? 1 : 0);
