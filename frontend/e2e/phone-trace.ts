/**
 * A phone session on one release build, traced in Chromium (#934).
 *
 * Run from `frontend/` as `mise run fe:trace:phone -- <dist> <label>`. It serves
 * the built app, opens it at 390 px with touch and a 4x CPU throttle, and runs the
 * three things a thumb does (a tab switch, opening a note from the tree, typing
 * ten characters). Each sits between two `performance.mark`s in a Chrome trace,
 * and `e2e/phone-trace-report.ts` reads the trace back between those marks.
 *
 * The vault is generated here and stubbed over `/api/`, so both builds see the
 * same notes. Nothing in `src/` is changed for the trace.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, chromium, type Route } from "playwright";

const DIST = process.argv[2];
const LABEL = process.argv[3];
if (DIST === undefined || LABEL === undefined) {
  console.error("usage: bun e2e/phone-trace.ts <dist dir> <label>");
  process.exit(1);
}
const dist = path.resolve(DIST);
if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`${dist} has no index.html: build it first`);
  process.exit(1);
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const { pathname } = new URL(request.url);
    const file = path.join(dist, path.normalize(pathname));
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
      return new Response(Bun.file(file));
    }
    return new Response(Bun.file(path.join(dist, "index.html")));
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

const NOTES = 8;

/** The line a step waits for in note `n`, unique to it, as no heading or link is. */
const opening = (n: number) => `Opening sentence of note ${n}.`;

/** Every API request the page made, as `METHOD /path`, printed when a step fails. */
const apiRequests: string[] = [];

/** The folders the 0.85 and 0.98 builds read on start, as the backend defaults them. */
const LAYOUT = {
  inbox: "00 Inbox",
  periodic: "01 Periodic",
  archive: "98 Archive",
  images: "99 Misc/02 Assets/01 Images",
  config: "99 Misc/01 Config",
};

/**
 * About 300 lines of mixed markdown, the same every run. A wikilink every 64
 * lines, a todo, a code block and a list keep the editor doing what a real note
 * makes it do.
 */
function noteText(n: number): string {
  // The opening sentence is what the steps wait for. A heading's `# ` is hidden
  // by the 0.85 live preview, so `# Note N` is not in the editor text there.
  const lines = [`# Note ${n}`, "", opening(n), ""];
  for (let i = 1; lines.length < 300; i++) {
    if (i % 32 === 9) lines.push("```ts", `const note${n} = ${i};`, "```", "");
    else if (i % 8 === 0) lines.push(`## Section ${i}`, "");
    else if (i % 8 === 3) lines.push(`- first point ${i}`, `- second point ${i}`, "");
    else if (i % 64 === 4) lines.push(`See [[Note ${((n + i) % NOTES) + 1}]] for idea ${i}.`, "");
    else if (i % 24 === 7) lines.push(`- [ ] todo ${i} for note ${n}`, "");
    else {
      lines.push(
        `Paragraph ${i} of note ${n}, with enough words to wrap across a phone screen.`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const vault = new Map<string, string>();
for (let n = 1; n <= NOTES; n++) vault.set(`Note ${n}.md`, noteText(n));

async function api(route: Route): Promise<void> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  apiRequests.push(`${request.method()} ${pathname}`);
  if (pathname === "/api/events") return route.fulfill({ status: 204 });
  if (pathname === "/api/layout") return route.fulfill({ status: 200, json: LAYOUT });
  // The graph answers an object of lists, which the 0.85 pane reads with `.map`.
  if (pathname === "/api/graph") {
    return route.fulfill({ status: 200, json: { nodes: [], edges: [], columns: [], rows: [] } });
  }
  if (pathname === "/api/files") return route.fulfill({ status: 200, json: [...vault.keys()] });
  if (pathname.startsWith("/api/files/")) {
    const notePath = decodeURIComponent(pathname.slice("/api/files/".length));
    const content = vault.get(notePath);
    if (content === undefined) return route.fulfill({ status: 404, json: {} });
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { content: string };
      vault.set(notePath, body.content);
      return route.fulfill({ status: 200, json: { path: notePath, content: body.content } });
    }
    return route.fulfill({ status: 200, json: { path: notePath, content } });
  }
  return route.fulfill({ status: 200, json: pathname === "/api/version" ? {} : [] });
}

/** Six tabs, one note each, as the phone had them open. */
const WORKSPACE = JSON.stringify({
  layout: {
    tabs: Array.from({ length: 6 }, (_, index) => {
      const n = index + 1;
      return { id: `t${n}`, root: { id: `p${n}`, path: `Note ${n}.md` }, focus: `p${n}` };
    }),
    active: 0,
  },
  treeOpen: false,
});

/**
 * Runs before every document. Seeds once per context, so a reload keeps what the
 * page wrote and does not get the layout back.
 */
function seed(workspace: string): void {
  if (sessionStorage.getItem("trace:seeded") !== null) return;
  localStorage.setItem("kasten.vim", "off");
  localStorage.setItem("kasten.workspace.coarse.1", workspace);
  sessionStorage.setItem("trace:seeded", "1");
}

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "blink.user_timing",
  "toplevel",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
];

const browser = await chromium.launch();

/** Say what failed, and what the page showed and asked for, so the failure says why. */
async function fail(message: string): Promise<never> {
  console.error(`FAIL ${message}`);
  // The router's error screen hides the error behind "Show Error", so it is opened first.
  await page
    .getByText("Show Error", { exact: true })
    .click({ timeout: 1_000 })
    .catch(() => undefined);
  const text = await page.evaluate(() => document.body.innerText).catch(() => "(page gone)");
  console.error(`document.body.innerText (first 1500 chars):\n${text.slice(0, 1500)}`);
  console.error(`/api requests the page made:\n${apiRequests.join("\n")}`);
  console.error(`page errors:\n${pageErrors.join("\n")}`);
  console.error(`console errors:\n${consoleErrors.join("\n")}`);
  await browser.close();
  server.stop(true);
  process.exit(1);
}

const context: BrowserContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
await context.route((url) => url.pathname.startsWith("/api/"), api);
await context.addInitScript(seed, WORKSPACE);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
});
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));

// Every script the first navigation asks for, read once the editor is up.
const scriptBodies: Promise<Buffer>[] = [];
let firstLoad = true;
page.on("response", (response) => {
  // The console line for a failed request does not name it, so it is named here.
  if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`);
  if (firstLoad && response.request().resourceType() === "script") {
    scriptBodies.push(response.body());
  }
});

await page.goto(`${BASE}/`);
const editor = page.locator(".cm-content:visible");
await editor
  .filter({ hasText: opening(1) })
  .waitFor({ timeout: 20_000 })
  .catch((error: unknown) => fail(`Note 1 is not on the page: ${String(error).slice(0, 300)}`));
firstLoad = false;

// I6: the phone's toolbar is the proof of phone mode. It is a div with role
// toolbar, not a nav, so the selector says so.
const toolbar = page.locator('[role="toolbar"][aria-label="Commands"]');
if (!(await toolbar.isVisible())) {
  await fail('phone mode is off: [role="toolbar"][aria-label="Commands"] is not visible');
}

const bodies = await Promise.all(scriptBodies);
const firstLoadJsRaw = bodies.reduce((total, body) => total + body.byteLength, 0);
const firstLoadJsGzip = bodies.reduce((total, body) => total + Bun.gzipSync(body).byteLength, 0);

const traces = path.join(import.meta.dirname, "../traces");
mkdirSync(traces, { recursive: true });
const tracePath = path.join(traces, `${LABEL}.json`);
await browser.startTracing(page, { path: tracePath, screenshots: false, categories: CATEGORIES });

async function mark(name: string): Promise<void> {
  await page.evaluate((text) => {
    performance.mark(text);
  }, name);
}

/** One step between its marks, with a second after its result for the springs to land. */
async function step(name: string, work: () => Promise<void>): Promise<void> {
  await mark(`${name}:start`);
  await work().catch((error: unknown) =>
    fail(`step ${name} missing or timed out: ${String(error).slice(0, 300)}`),
  );
  await page.waitForTimeout(1_000);
  await mark(`${name}:end`);
}

// Note 2, not 4: at 390 px the 0.98 strip folds the tabs past the first few
// behind "N more", and a folded tab is inert and invisible. Note 2 is on the
// strip in both builds, so the tap is the same on each.
await step("tab", async () => {
  await page.locator('[role="tab"]:visible', { hasText: "Note 2" }).tap({ timeout: 10_000 });
  await editor.filter({ hasText: opening(2) }).waitFor({ timeout: 10_000 });
});

await step("open", async () => {
  await page.getByRole("button", { name: "File tree", exact: true }).tap({ timeout: 10_000 });
  await page
    .getByRole("navigation", { name: "Vault" })
    .getByRole("button", { name: "Note 8", exact: true })
    .tap({ timeout: 10_000 });
  await editor.filter({ hasText: opening(8) }).waitFor({ timeout: 10_000 });
});

await step("type", async () => {
  await editor.tap({ timeout: 10_000 });
  await page.keyboard.press("End");
  await page.keyboard.type("abcdefghij", { delay: 120 });
  await editor.filter({ hasText: "abcdefghij" }).waitFor({ timeout: 10_000 });
});

// The frames at rest, after the last step's springs have had time to settle.
await page.waitForTimeout(1_500);
await mark("rest:start");
await page.waitForTimeout(2_000);
await mark("rest:end");
await browser.stopTracing();

await Bun.write(
  path.join(traces, `${LABEL}.meta.json`),
  `${JSON.stringify(
    {
      label: LABEL,
      dist,
      firstLoadJsGzip,
      firstLoadJsRaw,
      firstLoadJsFiles: bodies.length,
      consoleErrors,
      pageErrors,
    },
    null,
    2,
  )}\n`,
);

for (const message of consoleErrors) console.log(`console error: ${message}`);
console.log(`trace written: ${tracePath}`);
await context.close();
await browser.close();
server.stop(true);
if (pageErrors.length > 0) {
  for (const message of pageErrors) console.error(`page error: ${message}`);
  process.exit(1);
}
