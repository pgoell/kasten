import { defineConfig, devices } from "@playwright/test";

// CI splits the journeys across jobs with E2E_SHARD=<current>/<total>.
const [current, total] = (process.env.E2E_SHARD ?? "").split("/").map(Number);
const shard = current && total ? { current, total } : null;

export default defineConfig({
  testDir: "journeys",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  shard,
  // A runner has 4 cores: 3 workers ran fastest on a 4-core slice, 4 starved a first load past 15 s (#1979).
  workers: process.env.CI ? 3 : 4,
  globalSetup: "./harness/global-setup.ts",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // A context closed while the app's service worker installs crashes Chromium's browser process (#1606).
  use: { trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block" },
  // The full build: chromium_headless_shell-1234 segfaults closing a context after the todo pane wrote a note.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
