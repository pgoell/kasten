import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
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
          include: ["tests/perf/**/*.test.{ts,tsx}"],
          benchmark: { include: ["bench/**/*.bench.ts"] },
        },
      },
    ],
  },
});
