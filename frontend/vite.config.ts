import { randomUUID } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { devPolicy } from "./src/lib/csp.ts";

const BACKEND = process.env.KASTEN_DEV_BACKEND ?? "http://localhost:8000";

/**
 * The commit the tree is on, in seven characters, or nothing without one.
 *
 * Read here and stamped into the bundle, because the browser has no repo to
 * ask. Read out of `.git` rather than run through `git`, which the build image
 * has not got. Production copies only `frontend/` into that image, so there is
 * nothing to read there and the status bar shows the backend's release alone.
 */
function buildId(): string {
  const git = path.resolve(import.meta.dirname, "..", ".git");
  const head = path.join(git, "HEAD");
  if (!existsSync(head)) return "";

  const named = readFileSync(head, "utf8").trim();
  // A detached HEAD holds the commit itself, which is what a checkout of a tag
  // leaves behind.
  if (!named.startsWith("ref: ")) return named.slice(0, 7);

  // A ref `git gc` has packed away has no loose file. Rare on a working tree,
  // and saying nothing beats parsing `packed-refs` for it.
  const loose = path.join(git, named.slice("ref: ".length));
  return existsSync(loose) ? readFileSync(loose, "utf8").trim().slice(0, 7) : "";
}

// Set by compose.dev.yml when this dev server sits behind Caddy. Unset means
// plain localhost work, so the default stays untouched.
const PUBLIC_HOST = process.env.KASTEN_DEV_PUBLIC_HOST;

const hosted = PUBLIC_HOST
  ? {
      // Vite rejects unknown Host headers, so the public name must be listed.
      // localhost stays allowed for a browser running on the box itself, which
      // cannot pass the OAuth gate in front of the public name.
      allowedHosts: [PUBLIC_HOST, "localhost", "127.0.0.1"],
      // Caddy terminates TLS on 443. Without this the HMR client dials the raw
      // dev port over ws:// and hot reload silently stops working.
      hmr: { host: PUBLIC_HOST, protocol: "wss" as const, clientPort: 443 },
    }
  : {};

/**
 * Serve development the production policy, with the one directive it has to change.
 *
 * `apply: "serve"` keeps the nonce out of the build, which carries no inline
 * script and needs none. The nonce is minted here, at plugin construction, so
 * it changes every dev server start: a literal would be readable by anybody who
 * has seen this repo, and a book can carry a `nonce="…"` of its own.
 *
 * One plugin owns both halves so the header and the stamp cannot drift. Vite's
 * own tag hook reads `html.cspNonce` off the config and stamps every script,
 * style and preload link it emits, so the app's tags pass and a book's do not.
 *
 * `server.headers`, and not a `configureServer` middleware. vitest's browser
 * plugin is `enforce: "pre"`, so a plain plugin's middleware installs behind its
 * tester middleware and never runs for the document the frame tests live in,
 * while vitest's own first middleware copies these headers onto every response.
 */
function devCsp(): Plugin {
  const nonce = randomUUID();
  return {
    name: "kasten-dev-csp",
    apply: "serve",
    config: () => ({
      html: { cspNonce: nonce },
      server: { headers: { "Content-Security-Policy": devPolicy(nonce) } },
    }),
  };
}

/** Where foliate keeps the pdf.js build it renders a PDF with. */
const PDFJS = path.resolve(import.meta.dirname, "node_modules/foliate-js/vendor/pdfjs");

/**
 * The one line of foliate's `pdf.js` that names its own vendored pdf.js.
 *
 * Matched literally so a foliate bump that rewrites it fails the build rather
 * than leaving a reader that draws nothing.
 */
const PDFJS_PATH =
  // A template with both placeholders escaped, so this is the literal text of
  // foliate's line rather than something interpolated out of it.
  `const pdfjsPath = path => new URL(\`vendor/pdfjs/\${path}\`, import.meta.url)`;

/**
 * What a PDF needs beside the bundle, which the bundler cannot work out itself.
 *
 * The worker and the two stylesheets are fetched by every PDF; `cmaps` holds
 * the character maps a CJK document needs and `standard_fonts` the fourteen
 * fonts a document may name without embedding. `pdf.mjs` is not here: it is a
 * plain import, so rollup bundles it, and copying it as well would ship 800kB
 * twice.
 */
const PDFJS_FILES = [
  "pdf.worker.mjs",
  "text_layer_builder.css",
  "annotation_layer_builder.css",
  "cmaps",
  "standard_fonts",
];

/**
 * Serve foliate the pdf.js files it reads at runtime.
 *
 * foliate builds those URLs with `new URL(\`vendor/pdfjs/${path}\`,
 * import.meta.url)`, which Vite rewrites into an `import.meta.glob` over a
 * pattern of its own making. That pattern is relative to nothing Vite accepts,
 * so development dies with `Invalid glob: "vendor/pdfjs/*"` and the build
 * quietly resolves every one of those URLs to the string `undefined`. A glob
 * could not have answered in any case: two of the five names are directories,
 * and a directory has no asset URL.
 *
 * So the line is replaced with one base, `/pdfjs/`, and the files are staged
 * into `public/` where Vite already serves a directory untouched and the build
 * already copies one. That is the whole reason for the copy rather than a
 * `/@fs/` path straight at `node_modules`: everything under `/@fs/` goes
 * through the transform pipeline, which turns the two stylesheets into
 * javascript modules, and foliate `fetch`es them as text. The text layer then
 * lands unstyled, every span in normal flow at the left edge, which is a
 * selection that highlights the wrong words rather than a visible failure.
 *
 * A middleware would have avoided the copy, and is refused for the reason
 * `devCsp` refuses one: vitest's browser plugin is `enforce: "pre"` and
 * installs ahead of it.
 */
function foliatePdfjs(): Plugin {
  return {
    name: "kasten-foliate-pdfjs",
    // Ahead of vite's own plugins, which is the whole trick: `vite:import-glob`
    // is a core plugin and core plugins run before unenforced user ones, so it
    // reaches that line and throws before this could have replaced it.
    enforce: "pre",
    configResolved(config) {
      // Emptied and copied on every start rather than filled when it is
      // missing, so a foliate bump cannot leave a stale worker behind. A copy
      // over the top would not be enough on its own: `cpSync` merges, so a cmap
      // or a font that a later foliate drops would stay in `public/` and go on
      // being built into every image after it. It is 4.6MB against the page
      // cache and it is not in the hot path of anything.
      const staged = path.join(config.publicDir, "pdfjs");
      rmSync(staged, { recursive: true, force: true });
      for (const name of PDFJS_FILES) {
        cpSync(path.join(PDFJS, name), path.join(staged, name), { recursive: true });
      }
    },
    transform(code, id) {
      // The query goes first. Development stamps a `?v=` cache token on a
      // dependency's id, so a plain `endsWith` matches in the build and never
      // in the dev server, which is the difference between a reader that works
      // and one that takes the whole dev server down.
      if (!id.split("?")[0]?.endsWith("/foliate-js/pdf.js")) return;
      if (!code.includes(PDFJS_PATH)) {
        this.error("foliate's pdf.js no longer builds its paths the way vite.config.ts expects");
      }
      // `PDFJS_BASE` in `book-pane.tsx` is the other copy of this base, the
      // pdf the seek opens having to be opened with the same character maps and
      // fonts as the one on screen. Two literals rather than one import,
      // because nginx and the browser cannot read this file either.
      return code.replace(PDFJS_PATH, "const pdfjsPath = path => (`/pdfjs/` + path)");
    },
  };
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    devCsp(),
    foliatePdfjs(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  // Development pre-bundles a dependency with esbuild before any plugin sees
  // it, and `foliatePdfjs` above has to see foliate's own source: the glob Vite
  // writes over that line is invalid, so the optimiser's copy takes the dev
  // server down with `Invalid glob: "vendor/pdfjs/*"` before the reader opens
  // anything. foliate is plain ESM with no CommonJS in it, so there is nothing
  // the optimiser was buying here.
  optimizeDeps: { exclude: ["foliate-js"] },
  server: {
    // Defaults to loopback. compose.dev.yml sets 0.0.0.0 because inside a
    // container the only route in is Caddy on the `web` network; no port is
    // published to the host.
    host: process.env.KASTEN_DEV_BIND ?? "127.0.0.1",
    port: 5173,
    strictPort: true,
    ...hosted,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    // `vitest bench` resolves benchmark.include per project and ignores
    // test.include, so a bench file left unpinned runs once per project and
    // prints the same benchmark under several labels. Off here rather than per
    // project, so a project added later has to ask for benchmarks rather than
    // inherit vitest's default include and fan them out again.
    benchmark: { include: [] },
    // vitest is pinned to an exact version in package.json for two reasons:
    // benchmarking prints "Breaking changes might not follow SemVer, please pin
    // Vitest's version when using it", and @vitest/browser-playwright peer
    // depends on exactly the vitest it ships with. A range widens both.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          // Tests live in tests/ and end in .test.ts or .test.tsx. Anything
          // co-located under src/, and anything named .spec, is outside that
          // convention and deliberately not collected.
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/perf/**", "tests/frame/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          environment: "node",
          // Without this the gate measures a contended machine: one worker pool
          // shared with the jsdom project oversubscribes the box, and the same
          // code then reads 1.6x slower inside the full suite than it does
          // alone. A number that moves with whatever else is in the run is not
          // a baseline, and slices 3, 6 and 11 read these back.
          sequence: { groupOrder: 1 },
          include: ["tests/perf/**/*.test.{ts,tsx}"],
          benchmark: { include: ["bench/**/*.bench.ts"] },
        },
      },
      {
        extends: true,
        test: {
          name: "frame",
          // jsdom lays nothing out and paints nothing, so the only honest
          // answer to "did this keystroke land inside a frame" comes from a
          // real browser. `fe:test` names its projects rather than running them
          // all, because CI's Test job and lefthook install no browser.
          //
          // No groupOrder here, unlike perf: `fe:frame` is the only task that
          // names this project, so it never shares a worker pool with the jsdom
          // suite and has nothing to be sequenced away from.
          include: ["tests/frame/**/*.test.tsx"],
          // Chromium raises "ResizeObserver loop completed with undelivered
          // notifications" as a window error, and vitest counts one of those
          // as a failed run. foliate's paginator columnises to the box it is
          // in and resizes inside its own observer, which is exactly what the
          // notice reports, and nothing has gone wrong. Named to the message,
          // so every other unhandled error still fails.
          onUnhandledError: (error: unknown) =>
            !(error instanceof Error && error.message.includes("ResizeObserver loop")),
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium", headless: true }],
          },
        },
      },
    ],
  },
});
