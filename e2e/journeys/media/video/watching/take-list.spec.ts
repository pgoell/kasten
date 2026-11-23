import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page, Route } from "@playwright/test";
import { findNote, noteText, vaultWith } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { fakeYouTube } from "../../../../harness/youtube.ts";
import { take, talkWith, videoView } from "./talk.ts";

const archived = "98 Archive/Old talk.md";
const talk = "01 Notes/Talk.md";
const waiting = "Loading recent notes…";
const nothing = "Nothing written lately.";

/** Ages every stamp to last year: the guides the backend wrote at its start are stamped today. */
async function ageAll(vault: string): Promise<void> {
  for (const path of await readdir(vault, { recursive: true })) {
    if (!path.endsWith(".md")) continue;
    const text = await readFile(join(vault, path), "utf8");
    const aged = text.replace(/^modified: .*$/m, "modified: 2025-01-01T00:00:00+00:00");
    if (aged !== text) await writeFile(join(vault, path), aged);
  }
}

/** Opens `path` by address, so the home screen's Recent column, which asks the same searches, never draws. */
async function open(page: Page, path: string, name: string): Promise<Locator> {
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible({ timeout: 15_000 });
  await page.locator(".cm-content").first().locator(".cm-line:visible").first().click();
  await page.keyboard.press("Escape");
  return videoView(page);
}

/** Takes the first passage in sight and waits until its note is stamped. */
async function takeInto(pane: Locator, vault: string, path: string): Promise<void> {
  await take(pane, "first");
  await expect(pane.getByRole("status")).toContainText("Taken into the video's note");
  await expect.poll(() => noteText(vault, path), { timeout: 15_000 }).toMatch(/^modified: /m);
}

/**
 * Holds every `modified:` search from now on. `held` counts them; `release` lets them through,
 * or with `fail` answers last month's with a 500.
 */
async function holdRecent(page: Page) {
  const routes: Route[] = [];
  await page.route(
    (url) =>
      url.pathname === "/api/search" && (url.searchParams.get("q") ?? "").startsWith("modified: "),
    (route) => void routes.push(route),
  );
  const thisMonth = `modified: ${new Date().toISOString().slice(0, 7)}`;
  return {
    held: () => routes.length,
    release: async (fail = false) => {
      for (const route of routes.splice(0)) {
        const q = new URL(route.request().url()).searchParams.get("q");
        if (fail && q !== thisMonth) await route.fulfill({ status: 500, body: "down" });
        else await route.continue();
      }
    },
  };
}

test("Put it in a note says it is loading while the recent notes' searches are out, and a failed one ends the wait (#2301)", async ({
  page,
  stack,
}) => {
  await ageAll(stack.vault);
  await vaultWith(stack.vault, { [archived]: talkWith() });
  const blocked = await fakeYouTube(page);
  const recent = await holdRecent(page);
  const pane = await open(page, archived, "Old talk");
  await takeInto(pane, stack.vault, archived);

  const status = pane.getByRole("status");
  await status.getByRole("button", { name: "Put it in a note" }).click();
  await expect.poll(recent.held).toBe(2);
  await expect(status.getByText(waiting)).toBeVisible();
  await expect(status.getByText(nothing)).toHaveCount(0);

  // Only the archived note was written lately, and last month's search fails: the list stops waiting.
  await recent.release(true);
  await expect(status.getByText(nothing)).toBeVisible();
  await expect(status.getByText(waiting)).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test("in the same tab, a list opened within 10 s of the last answer waits for a fresh one and holds the note a take just wrote (#1971)", async ({
  page,
  stack,
}) => {
  await ageAll(stack.vault);
  await vaultWith(stack.vault, { [archived]: talkWith(), [talk]: talkWith() });
  const blocked = await fakeYouTube(page);
  const first = await open(page, archived, "Old talk");
  await takeInto(first, stack.vault, archived);
  const put = (pane: Locator) =>
    pane.getByRole("status").getByRole("button", { name: "Put it in a note" });
  await put(first).click();
  await expect(first.getByRole("status").getByText(nothing)).toBeVisible();

  // No reload: the answer just drawn stays in the page's cache, fresh for 10 s.
  const recent = await holdRecent(page);
  await findNote(page, "Talk");
  const second = await videoView(page);
  await takeInto(second, stack.vault, talk);
  await put(second).click();
  const status = second.getByRole("status");
  await expect.poll(recent.held).toBe(2);
  await expect(status.getByText(waiting)).toBeVisible();
  await expect(status.getByText(nothing)).toHaveCount(0);
  await recent.release();
  await expect(status.getByRole("button", { name: "Talk" })).toBeVisible();
  await expect(status.getByText(waiting)).toHaveCount(0);
  expect(blocked).toEqual([]);
});
