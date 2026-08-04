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
      allowedHosts: [PUBLIC_HOST],
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
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
