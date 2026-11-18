import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  hold,
  holdStream,
  leader,
  localDate,
  openApp,
  recordEvents,
  vaultWith,
} from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { CONFIG, CONFIG_PATH, DAY, daily, logPane, logReads, note, TODAY } from "../log.ts";

const DAY_READ = `${TODAY}..${TODAY}`;
/** The thirty days the pane's trend asks for, counted on the calendar so a clock change cannot shift them. */
const TREND_READ = (() => {
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return `${localDate(from)}..${TODAY}`;
})();
const TEA = `${CONFIG}- 🍵 tea: 150 ml\n`;
const LATER = ["- 💧 750 ml", ...DAY.slice(1)];
const days = (asked: string[]) => asked.filter((read) => read === DAY_READ).length;

/** Opens the log pane over today's log once the vault's stream is open, so no write on disk goes unseen. */
async function opened(page: Page, vault: string, config = CONFIG) {
  const asked = logReads(page);
  const seen = await recordEvents(page);
  const stream = page.waitForResponse("**/api/events");
  const pane = await logPane(page, vault, "leader", DAY, config);
  await stream;
  return { pane, asked, seen };
}

/** Writes 750 ml into today's note and waits for the pane to draw it: a read of the day the write itself asks. */
async function later(page: Page, vault: string) {
  await vaultWith(vault, { [daily(TODAY)]: note(LATER) });
  await expect(
    page.getByRole("region", { name: "Log" }).getByRole("button", { name: "💧 750 ml" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("#774 a write to today's daily note asks the log again for the day and the trend, and the pane redraws", async ({
  page,
  stack,
}) => {
  const { asked } = await opened(page, stack.vault);
  const before = asked.length;
  await later(page, stack.vault);
  await expect
    .poll(() => asked.slice(before))
    .toEqual(expect.arrayContaining([DAY_READ, TREND_READ]));
});

for (const [what, path] of [
  ["a weekly note in the periodic folder", "01 Periodic/01 Weekly/2026-W43.md"],
  ["a dated note outside the daily folder", `00 Inbox/${TODAY}.md`],
]) {
  test(`#774 a write to ${what} does not ask the log again`, async ({ page, stack }) => {
    const { asked, seen } = await opened(page, stack.vault);
    const before = days(asked);
    await vaultWith(stack.vault, { [path]: "# A note\n" });
    await expect.poll(seen, { timeout: 15_000 }).toContain(path);
    // The day's own write asks once, so a count past one means the other note asked too.
    await later(page, stack.vault);
    expect(days(asked)).toBe(before + 1);
  });
}

test("#774 today's daily note removed asks the log again and the pane drops its entry", async ({
  page,
  stack,
}) => {
  const { pane, asked } = await opened(page, stack.vault);
  const before = asked.length;
  await rm(join(stack.vault, daily(TODAY)));
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toHaveCount(0, { timeout: 15_000 });
  expect(asked.slice(before)).toContain(DAY_READ);
});

test("#774 a daily note under a periodic folder other than the default asks the log again", async ({
  page,
  stack,
}) => {
  // The backend's folders are settings of the stack, so only the page is told of another one.
  await page.route("**/api/layout", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), periodic: "Journal" } });
  });
  // Written before the pane opens, so the write below changes no listing and only its own path can ask.
  const journal = { [`Journal/00 Daily/${TODAY}.md`]: note(DAY) };
  await vaultWith(stack.vault, journal);
  const { asked } = await opened(page, stack.vault);
  const before = asked.length;
  await vaultWith(stack.vault, { [`Journal/00 Daily/${TODAY}.md`]: note(LATER) });
  await expect.poll(() => asked.slice(before), { timeout: 15_000 }).toContain(DAY_READ);
});

test("#796 the daily folder moved out of the periodic folder asks the log again and the pane drops the entry", async ({
  page,
  stack,
}) => {
  const { pane, asked } = await opened(page, stack.vault);
  const before = asked.length;
  await rename(join(stack.vault, "01 Periodic/00 Daily"), join(stack.vault, "Old"));
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toHaveCount(0, { timeout: 15_000 });
  expect(asked.slice(before)).toContain(DAY_READ);
});

test("#796 a listing that leaves the daily notes as they were does not ask the log again", async ({
  page,
  stack,
}) => {
  const { asked, seen } = await opened(page, stack.vault);
  const before = days(asked);
  const listed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/files",
  );
  await vaultWith(stack.vault, { "00 Inbox/new idea.md": "# new idea\n" });
  await expect.poll(seen, { timeout: 15_000 }).toContain('"listing"');
  await listed;
  await later(page, stack.vault);
  expect(days(asked)).toBe(before + 1);
});

test("#795 the log config written asks the log again for the day and the trend, and the pane reads its kinds", async ({
  page,
  stack,
}) => {
  const { pane, asked } = await opened(page, stack.vault);
  const before = asked.length;
  await vaultWith(stack.vault, { [CONFIG_PATH]: TEA });
  await expect(pane.getByRole("button", { name: "Log tea" })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => asked.slice(before))
    .toEqual(expect.arrayContaining([DAY_READ, TREND_READ]));
});

test("#795 the log config removed asks the log again, and the pane goes back to the default kinds", async ({
  page,
  stack,
}) => {
  const { pane, asked } = await opened(page, stack.vault, TEA);
  await expect(pane.getByRole("button", { name: "Log tea" })).toBeVisible();
  const before = asked.length;
  await rm(join(stack.vault, CONFIG_PATH));
  await expect(pane.getByRole("button", { name: "Log tea" })).toHaveCount(0, { timeout: 15_000 });
  await expect(pane.getByRole("button", { name: "Log water" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Log juice" })).toHaveCount(0);
  expect(asked.slice(before)).toContain(DAY_READ);
});

test("#796 a listing before the file listing first answered asks no log and throws nothing", async ({
  page,
  stack,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = logReads(page);
  const seen = await recordEvents(page);
  const release = await hold(page, /\/api\/files$/);
  await vaultWith(stack.vault, { [daily(TODAY)]: note(DAY) });
  const stream = page.waitForResponse("**/api/events");
  await page.goto("/");
  await stream;
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toBeVisible({ timeout: 15_000 });
  const before = days(asked);

  await vaultWith(stack.vault, { "00 Inbox/new idea.md": "# new idea\n" });
  await expect.poll(seen, { timeout: 15_000 }).toContain('"listing"');
  await release();
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await later(page, stack.vault);
  expect(days(asked)).toBe(before + 1);
  expect(errors).toEqual([]);
});

test("#813 a stream that opens again asks the log again and the pane shows what was written while it was down", async ({
  page,
  stack,
}) => {
  // The first stream ends at once, as a backend going down ends it; the next waits until `up`.
  let opens = 0;
  let up = () => {};
  const back = new Promise<void>((resolve) => {
    up = resolve;
  });
  await page.route("**/api/events", async (route) => {
    opens += 1;
    if (opens === 1) {
      return route.fulfill({ contentType: "text/event-stream", body: "retry: 200\n\n" });
    }
    await back;
    await route.continue();
  });
  const asked = logReads(page);
  const pane = await logPane(page, stack.vault);
  await expect.poll(() => opens, { timeout: 15_000 }).toBe(2);
  const before = asked.length;
  await vaultWith(stack.vault, { [daily(TODAY)]: note(LATER) });

  const reopened = page.waitForResponse("**/api/events");
  up();
  await reopened;
  await expect(pane.getByRole("button", { name: "💧 750 ml" })).toBeVisible({ timeout: 15_000 });
  expect(days(asked.slice(before))).toBe(1);
});

test("#813 the first open of the stream asks the log once, not twice", async ({ page, stack }) => {
  await page.clock.install();
  const asked = logReads(page);
  const answer = await hold(page, /\/api\/log\?/);
  const open = await holdStream(page);
  await vaultWith(stack.vault, { [daily(TODAY)]: note(DAY) });
  await openApp(page);
  await leader(page, "gf");
  // The pane's own first read is out and held when the stream opens.
  await expect.poll(() => days(asked), { timeout: 15_000 }).toBe(1);
  const opened = page.waitForResponse("**/api/events");
  open();
  await opened;
  await answer();
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toBeVisible({ timeout: 15_000 });
  // A second read set off late would be out once the clock runs past any wait it could sit in.
  await page.clock.runFor(5_000);
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toBeVisible();
  expect(days(asked)).toBe(1);
});
