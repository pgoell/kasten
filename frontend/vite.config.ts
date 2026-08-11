import { randomUUID } from "node:crypto";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { devPolicy } from "./src/lib/csp.ts";

const BACKEND = process.env.KASTEN_DEV_BACKEND ?? "http://localhost:8000";

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

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    devCsp(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
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
