/**
 * The browser commands that serve a vault page to a frame test, read by the
 * tests through `commands.servePage`, `commands.serveFile` and
 * `commands.unservePages` in `vitest/browser`. Registered in `vite.config.ts`,
 * and typed in `browser-commands.d.ts`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

/** Where `kasten_backend.html_page` runs from, so `uv` finds the backend's environment. */
const BACKEND = path.resolve(import.meta.dirname, "../../../backend");

/** Where `servePage` writes a page's html, under `node_modules` and so out of git. */
const PAGES = path.resolve(import.meta.dirname, "../../node_modules/.cache/kasten-pages");

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
  await context.route(
    (url) => url.pathname === `/api/html/${encodeURI(pagePath)}`,
    (route) => {
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
      return route.fulfill({
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
    },
  );
}

/** Serves `html` as the page at `pagePath`, written to a file first, as the backend reads one. */
export const servePage: BrowserCommand<[string, string]> = async (command, pagePath, html) => {
  const file = path.join(PAGES, pagePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  await routePage(command, pagePath, file);
};

/** Serves a page that already exists on disk, such as a plugin's, at `pagePath`. */
export const serveFile: BrowserCommand<[string, string]> = async (command, pagePath, file) => {
  await routePage(command, pagePath, file);
};

/** Stops serving the pages `servePage` routed, so the next test starts with none. */
export const unservePages: BrowserCommand<[]> = async ({ context }) => {
  await context.unrouteAll();
};
