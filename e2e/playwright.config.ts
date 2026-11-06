import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "journeys",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : 4,
  globalSetup: "./harness/global-setup.ts",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  // The full build: chromium_headless_shell-1234 segfaults closing a context after the todo pane wrote a note.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
