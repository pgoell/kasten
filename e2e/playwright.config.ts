import { defineConfig, devices } from "@playwright/test";

// CI splits the journeys across jobs with E2E_SHARD=<current>/<total>.
const [current, total] = (process.env.E2E_SHARD ?? "").split("/").map(Number);
const shard = current && total ? { current, total } : null;
// The full build: chromium_headless_shell-1234 segfaults closing a context after the todo pane wrote a note.
const browser = { ...devices["Desktop Chrome"], channel: "chromium" };
const COMPOSE = /a run's compose project/;

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
  // A flaky journey is a bug to fix, not to retry past: a pass on a second try still fails the run.
  retries: 0,
  failOnFlakyTests: true,
  projects: [
    // A compose project's network coming or going fails Chromium's requests in flight with
    // ERR_NETWORK_CHANGED, so those journeys finish before any page loads.
    { name: "compose", testMatch: "harness.spec.ts", grep: COMPOSE, use: browser },
    { name: "chromium", grepInvert: COMPOSE, dependencies: ["compose"], use: browser },
  ],
});
