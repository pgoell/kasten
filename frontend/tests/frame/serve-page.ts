/**
 * The browser commands that serve a vault page to a frame test, read by the
 * tests through `commands.servePage` and `commands.unservePages` in
 * `vitest/browser`. Registered in `vite.config.ts`, and typed in
 * `browser-commands.d.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserCommand } from "vitest/node";

/** The file `read_html` appends to every page, which the backend reads at import. */
const PAGE_SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../backend/src/kasten_backend/page_script.js",
);

/**
 * Serves one page at `/api/html/<path>` the way `read_html` does, so a frame
 * test can draw it without the backend running.
 *
 * The sandbox line is the one `HTML_POLICY` leads with, and it is the part a
 * frame needs. The script is appended the same way, after the page. Routed
 * here rather than through the dev server, which proxies `/api` to a backend
 * these tests do not start.
 */
export const servePage: BrowserCommand<[string, string]> = async ({ context }, pagePath, html) => {
  const script = readFileSync(PAGE_SCRIPT, "utf8");
  await context.route(
    (url) => url.pathname === `/api/html/${encodeURI(pagePath)}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: {
          "Content-Security-Policy":
            "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
        },
        body: `${html}\n<script>\n${script}\n</script>\n`,
      }),
  );
};

/** Stops serving the pages `servePage` routed, so the next test starts with none. */
export const unservePages: BrowserCommand<[]> = async ({ context }) => {
  await context.unrouteAll();
};
