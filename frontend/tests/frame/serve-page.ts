/**
 * The browser commands that serve a vault page to a frame test, read by the
 * tests through `commands.servePage`, `commands.serveFile` and
 * `commands.unservePages` in `vitest/browser`. Registered in `vite.config.ts`,
 * and typed in `browser-commands.d.ts`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";
import type { Plugin } from "vite";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

/** Where `kasten_backend.html_page` runs from, so `uv` finds the backend's environment. */
const BACKEND = path.resolve(import.meta.dirname, "../../../backend");

/** Where `servePage` writes a page's html, under `node_modules` and so out of git. */
const PAGES = path.resolve(import.meta.dirname, "../../node_modules/.cache/kasten-pages");
/**
 * Numbers each `servePage` call's own folder: test files run side by side and share
 * `PAGES`, and a name two of them serve handed one's page to the other's frame (#1425, #1519).
 */
let served = 0;

/**
 * Each context's routed pages by pathname: how many requests the route has answered,
 * and a promise that settles on the next. A render can outlast a poll on a slow
 * runner, so `ready` waits on this first (#1692).
 */
type Answers = { count: number; next: Promise<void>; settle: () => void };
const answered = new WeakMap<BrowserContext, Map<string, Answers>>();

function nextAnswer(answers: Answers) {
  answers.next = new Promise<void>((done) => {
    answers.settle = done;
  });
}

/**
 * Routes `/api/html/<pagePath>` to the backend's own page writer, so the page a
 * frame test draws is the one the app serves: the script first, the theme and
 * palette from the request's query when the page opts in. The sandbox line is
 * the one `HTML_POLICY` leads with, and it is the part a frame needs, with its
 * frame-ancestors beside it. Routed
 * here rather than through the dev server, which proxies `/api` to a backend
 * these tests do not start.
 */
async function routePage({ context }: BrowserCommandContext, pagePath: string, file: string) {
  const pathname = `/api/html/${encodeURI(pagePath)}`;
  const answers: Answers = { count: 0, next: Promise.resolve(), settle: () => {} };
  nextAnswer(answers);
  const pages = answered.get(context) ?? new Map<string, Answers>();
  answered.set(context, pages.set(pathname, answers));
  await context.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const theme = query.get("theme");
      const palette = query.get("palette");
      const body = execFileSync(
        "uv",
        [
          "run",
          "python",
          "-m",
          "kasten_backend.html_page",
          file,
          ...(theme ? ["--theme", theme] : []),
          ...(palette ? ["--palette", palette] : []),
        ],
        { cwd: BACKEND },
      );
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: {
          // `HTML_POLICY`'s frame-ancestors too, so a test that sees the page
          // load proves the pane's frame passes it (#870).
          "Content-Security-Policy":
            "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'",
        },
        body,
      });
      // A waiter that wakes and still wants more must find the next promise already there.
      const { settle } = answers;
      answers.count += 1;
      nextAnswer(answers);
      settle();
    },
  );
}

/** Under the frame project's 15 s test timeout, so a page never asked for fails with its path named. */
const SERVED_WITHIN = 10_000;

/**
 * Waits until the page at `pathname` has been answered `times` times since it was
 * served, so a page opened again can be waited on too; a path no route serves passes at once.
 */
export const pageServed: BrowserCommand<[string, number?]> = async (
  { context },
  pathname,
  times = 1,
) => {
  const answers = answered.get(context)?.get(pathname);
  if (!answers) return;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(lateMessage(pathname, answers.count, times))),
      SERVED_WITHIN,
    );
  });
  try {
    while (answers.count < times) await Promise.race([answers.next, late]);
  } finally {
    clearTimeout(timer);
  }
};

function lateMessage(pathname: string, count: number, times: number): string {
  const shortfall = times === 1 ? "" : ` (answered ${count} of ${times} times)`;
  return `pageServed: ${pathname} was not answered within ${SERVED_WITHIN} ms${shortfall}: no frame asked for it, or its render queued that long`;
}

/**
 * Serves `html` as the page at `pagePath`, written to a file first, as the backend reads one.
 * A UTF-16 `encoding` writes it with its byte order mark first.
 */
export const servePage: BrowserCommand<[string, string, Utf16?]> = async (
  command,
  pagePath,
  html,
  encoding,
) => {
  served += 1;
  const file = path.join(PAGES, String(served), pagePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encoding ? utf16(html, encoding) : html);
  await routePage(command, pagePath, file);
};

type Utf16 = "utf-16le" | "utf-16be";

function utf16(html: string, encoding: Utf16): Buffer {
  const bytes = Buffer.from(`\ufeff${html}`, "utf16le");
  return encoding === "utf-16be" ? bytes.swap16() : bytes;
}

/** Serves a page that already exists on disk, such as a plugin's, at `pagePath`. */
export const serveFile: BrowserCommand<[string, string]> = async (command, pagePath, file) => {
  await routePage(command, pagePath, file);
};

/**
 * Hides `ResizeObserver` from the page at `pagePath` before its script runs, for a
 * browser without one. Keyed by pathname, since an init script runs in every frame
 * of the context and cannot be removed.
 */
export const hideResizeObserver: BrowserCommand<[string]> = async ({ context }, pagePath) => {
  await context.addInitScript(
    ({ p }: { p: string }) => {
      if (location.pathname === p) Reflect.deleteProperty(window, "ResizeObserver");
    },
    { p: `/api/html/${encodeURI(pagePath)}` },
  );
};

/**
 * Serves an empty image at `pagePath` after `ms`, so a page that shows it parses and
 * runs its script long before its `load`, as a page with large images does.
 */
export const serveSlowly: BrowserCommand<[string, number]> = async ({ context }, pagePath, ms) => {
  await context.route(
    (url) => url.pathname === `/api/html/${encodeURI(pagePath)}`,
    async (route) => {
      await new Promise((done) => setTimeout(done, ms));
      return route.fulfill({ status: 200, contentType: "image/gif", body: "" });
    },
  );
};

/** Stops serving the pages `servePage` routed, so the next test starts with none. */
export const unservePages: BrowserCommand<[]> = async ({ context }) => {
  // A late answer `serveSlowly` still owes a frame the test has removed has nowhere to go.
  await context.unrouteAll({ behavior: "ignoreErrors" });
  answered.delete(context);
};

/** The commands this file gives the frame project, for `vite.config.ts` to register. */
export const serveCommands = {
  hideResizeObserver,
  pageServed,
  serveFile,
  servePage,
  serveSlowly,
  unservePages,
};

/**
 * Answers the backend's paths at once with the 502 a proxy to no backend gives, as on CI.
 * Proxied, a request that slips past a test's mocks reaches whatever listens on the dev
 * backend's port; one that accepts and never answers held Chromium's six connections and
 * stalled every later module load (#1885). Routes `servePage` adds still win in the browser.
 */
export function noBackend(): Plugin {
  return {
    name: "kasten-frame-no-backend",
    configureServer: (server) => {
      server.middlewares.use((req, res, next) => {
        if (!/^\/(api|share|chat)(\/|\?|$)/.test(req.url ?? "")) return next();
        res.writeHead(502, { "Content-Type": "text/plain" }).end();
      });
    },
  };
}
