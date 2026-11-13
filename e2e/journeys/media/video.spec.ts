import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  findNote,
  leader,
  localDate,
  noteText,
  openApp,
  phone,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";
import { fakeYouTube } from "../../harness/youtube.ts";

const lecture = "01 Notes/Lecture.md";
const frame = '[data-video-pane] iframe[title="video"]';

test("the video pane reopens a note's video at the second it was paused on", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  await openApp(page);
  await findNote(page, "Lecture");
  await leader(page, "gv");
  await expect(page.locator(frame)).toHaveAttribute("src", /\/embed\/kastenVid01\?enablejsapi=1$/);

  // The fake player moves 30 s on each play, so the pause writes 30.
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect
    .poll(() => noteText(stack.vault, lecture), { timeout: 15_000 })
    .toMatch(/^watching: \{kastenVid01: 30\}$/m);

  // A reload drops everything the page held, so the second can only come from the note.
  await page.reload();
  await openApp(page);
  await findNote(page, "Lecture");
  await leader(page, "gv");
  await expect(page.locator(frame)).toHaveAttribute(
    "src",
    /\/embed\/kastenVid01\?enablejsapi=1&start=30$/,
  );

  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect
    .poll(() => noteText(stack.vault, lecture), { timeout: 15_000 })
    .toMatch(/^watching: \{kastenVid01: 60\}$/m);
  expect(blocked).toEqual([]);
});

test("a transcript take says the video's note, and Undo leaves a note changed since as it is", async ({
  page,
  stack,
}) => {
  const talk = "01 Notes/Talk.md";
  const words = "A passage of the video.";
  await vaultWith(stack.vault, {
    [talk]: `# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n\n## Transcript\n\n[00:12] ${words}\n\n[00:40] Another passage.\n`,
  });
  const blocked = await fakeYouTube(page);
  await openApp(page);
  await findNote(page, "Talk");
  await leader(page, "gv");
  const pane = page.locator("[data-video-pane]");
  await pane.getByRole("button", { name: "Video view" }).click();
  const paragraph = pane.getByRole("list", { name: "Transcript" }).getByText(words);
  await expect(paragraph).toBeVisible({ timeout: 15_000 });

  // The text node after the time's button, so the selection holds the words alone.
  await paragraph.evaluate((p, wanted) => {
    const node = [...p.childNodes].find((n) => n.textContent === wanted) as Node;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, words);
  await pane.getByRole("button", { name: "Take the passage" }).click();
  const toast = pane.getByRole("status");
  await expect(toast).toContainText("Taken into the video's note");
  await expect.poll(() => noteText(stack.vault, talk), { timeout: 15_000 }).toContain(`> ${words}`);

  // Held under the pointer, so it outlasts its five seconds.
  await toast.hover();
  await appendFile(join(stack.vault, talk), "\nWritten meanwhile.\n");
  const changed = await noteText(stack.vault, talk);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toContainText("The video's note changed since, so Undo left it as it is");
  expect(await noteText(stack.vault, talk)).toBe(changed);
  expect(blocked).toEqual([]);
});

/** A talk on kastenVid01 whose transcript has a paragraph every 10 s, enough to fill the column. */
function talkWith(more = ""): string {
  const rows = Array.from({ length: 40 }, (_, n) => {
    const at = `${String(Math.floor(n / 6)).padStart(2, "0")}:${String((n % 6) * 10).padStart(2, "0")}`;
    return `[${at}] Passage ${n} of the video.`;
  });
  return `# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n${more}\n## Transcript\n\n${rows.join("\n\n")}\n`;
}

/** Opens the open note's video in Video view and returns the pane. */
async function videoView(page: Page): Promise<Locator> {
  await leader(page, "gv");
  const pane = page.locator("[data-video-pane]");
  await pane.getByRole("button", { name: "Video view" }).click();
  await expect(pane.getByRole("list", { name: "Transcript" })).toBeVisible({ timeout: 15_000 });
  return pane;
}

/**
 * Selects the words of a transcript paragraph in sight and takes them: the first one for "first",
 * or for "low" one whose middle sits in the lower half of the box the toast sits in, measured
 * as it is selected, so the follow scroll cannot move it first. Returns the words.
 */
async function take(pane: Locator, where: "first" | "low"): Promise<string> {
  const words = await pane.getByRole("list", { name: "Transcript" }).evaluate((list, low) => {
    // The toast's box is the transcript's own wrapper, the one `low()` measures in.
    const box = (list.parentElement as HTMLElement).getBoundingClientRect();
    const seen = list.getBoundingClientRect();
    const fits = (r: DOMRect) => {
      const middle = (r.top + r.bottom) / 2;
      const inSight = r.top >= seen.top && r.bottom <= seen.bottom;
      const lower = middle > (box.top + box.bottom) / 2 + 20 && middle < box.bottom - 20;
      return inSight && (!low || lower);
    };
    const li = [...list.querySelectorAll("li")].find((row) => fits(row.getBoundingClientRect()));
    // The words are the text after the time's button, so the selection holds them alone.
    const node = [...(li?.querySelector("p")?.childNodes ?? [])].find((n) =>
      (n.textContent ?? "").includes("Passage"),
    );
    if (node === undefined) throw new Error("no paragraph in sight fits");
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    return (node.textContent ?? "").trim();
  }, where === "low");
  await pane.getByRole("button", { name: "Take the passage" }).click();
  return words;
}

test("the pane lists this video's takes with time and quote, leaves out another video's, and a take's time seeks there", async ({
  page,
  stack,
}) => {
  const talk = "01 Notes/Talk.md";
  // Two takes as the take writes them: this video at 12:34, another video at 01:00.
  const watch = (id: string, t: number) => `https://www.youtube.com/watch?v=${id}&t=${t}s`;
  await vaultWith(stack.vault, {
    [talk]: `# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n\n## Highlights\n\n> The first quote.\n\n[12:34](${watch("kastenVid01", 754)}) ^hl-a1b2c3\n\n> Elsewhere quote.\n\n[01:00](${watch("kastenVid02", 60)}) ^hl-d4e5f6\n`,
  });
  const blocked = await fakeYouTube(page);
  await openApp(page);
  await findNote(page, "Talk");
  await leader(page, "gv");
  const pane = page.locator("[data-video-pane]");
  await pane.getByRole("button", { name: "Video view" }).click();
  const takes = pane.getByRole("list", { name: "Taken from this video" });
  await expect(takes.getByRole("listitem")).toHaveCount(1, { timeout: 15_000 });
  await expect(takes.getByRole("listitem")).toContainText("The first quote.");
  const time = takes.getByRole("button", { name: "Seek to 12:34" });
  await expect(time).toHaveText("12:34");
  await expect(pane.getByText("Elsewhere quote.")).toHaveCount(0);

  // The fake plays 30 s from where it stands, so the pause writes 754 + 30 only after the seek.
  await time.click();
  await pane.getByRole("button", { name: "Play" }).click();
  await pane.getByRole("button", { name: "Pause" }).click();
  await expect
    .poll(() => noteText(stack.vault, talk), { timeout: 15_000 })
    .toMatch(/^watching: \{kastenVid01: 784\}$/m);
  expect(blocked).toEqual([]);
});

test("a take's toast sits at the foot of the transcript, and goes to the top for a passage low in it", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "01 Notes/Talk.md": talkWith() });
  const blocked = await fakeYouTube(page);
  await openApp(page);
  await findNote(page, "Talk");
  const pane = await videoView(page);
  const toast = pane.getByRole("status");
  const place = () =>
    toast.evaluate((t) => {
      const r = t.getBoundingClientRect();
      const box = (t.parentElement as HTMLElement).getBoundingClientRect();
      return { top: r.top - box.top, foot: box.bottom - r.bottom, mid: (box.top + box.bottom) / 2 };
    });

  const high = await take(pane, "first");
  await expect(toast).toContainText(high);
  const foot = await place();
  const highMiddle = await pane
    .getByRole("list", { name: "Transcript" })
    .getByText(high)
    .evaluate((p) => {
      const r = p.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
  expect(highMiddle, "the first passage sits in the upper half").toBeLessThan(foot.mid);
  expect([foot.foot < 16, foot.top > 16]).toEqual([true, true]);

  const low = await take(pane, "low");
  await expect(toast).toContainText(low);
  const top = await place();
  expect([top.top < 16, top.foot > 16]).toEqual([true, true]);
  expect(blocked).toEqual([]);
});

test("Put it in a note says nothing was written lately when only the archive was, and lists a note written outside it", async ({
  page,
  stack,
  browser,
}) => {
  const archived = "98 Archive/Old talk.md";
  // The guides the backend wrote at its start are stamped today: aged to last year, so nothing
  // outside the archive was written lately.
  for (const path of await readdir(stack.vault, { recursive: true })) {
    if (!path.endsWith(".md")) continue;
    const text = await readFile(join(stack.vault, path), "utf8");
    const aged = text.replace(/^modified: .*$/m, "modified: 2025-01-01T00:00:00+00:00");
    if (aged !== text) await writeFile(join(stack.vault, path), aged);
  }
  await vaultWith(stack.vault, { [archived]: talkWith(), "01 Notes/Talk.md": talkWith() });
  const blocked = await fakeYouTube(page);
  // Both months the list asks for, answered before the list is read: an unanswered list is empty too.
  const month = today().slice(0, 7);
  // Day 0 of this month is the last day of the one before.
  const prior = new Date(`${month}-01T12:00:00`);
  prior.setDate(0);
  const months = [month, localDate(prior).slice(0, 7)];
  const answered = (on: Page) =>
    Promise.all(
      months.map((m) =>
        on.waitForResponse(
          (r) =>
            r.url().includes("/api/search") &&
            new URL(r.url()).searchParams.get("q") === `modified: ${m}`,
        ),
      ),
    );

  // Opened by address, so the home screen's Recent column, which asks the same searches, never draws.
  const open = async (on: Page, path: string, name: string) => {
    await on.goto(`/?note=${encodeURIComponent(path)}`);
    await expect(on.getByRole("tab", { name, selected: true })).toBeVisible({ timeout: 15_000 });
    await on.locator(".cm-content").first().locator(".cm-line:visible").first().click();
    await on.keyboard.press("Escape");
    return videoView(on);
  };
  const pane = await open(page, archived, "Old talk");
  await take(pane, "first");
  await expect(pane.getByRole("status")).toContainText("Taken into the video's note");
  await expect
    .poll(() => noteText(stack.vault, archived), { timeout: 15_000 })
    .toMatch(/^modified: /m);
  const searches = answered(page);
  await pane.getByRole("button", { name: "Put it in a note" }).click();
  await searches;
  await expect(pane.getByRole("status").getByText("Nothing written lately.")).toBeVisible();
  expect(blocked).toEqual([]);

  // A fresh browser, so its list asks the search afresh and its workspace starts empty.
  const fresh = await browser.newContext({ baseURL: stack.url });
  const other = await fresh.newPage();
  const blockedToo = await fakeYouTube(other);
  const second = await open(other, "01 Notes/Talk.md", "Talk");
  await take(second, "first");
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Talk.md"), { timeout: 15_000 })
    .toMatch(/^modified: /m);
  const again = answered(other);
  await second.getByRole("button", { name: "Put it in a note" }).click();
  await again;
  const status = second.getByRole("status");
  await expect(status.getByRole("button", { name: "Talk" })).toBeVisible();
  await expect(status.getByText("Nothing written lately.")).toHaveCount(0);
  expect(blockedToo).toEqual([]);
  await fresh.close();
});

test("? over the video pane lists each video key beside its label, under Over a video", async ({
  page,
}) => {
  await fakeYouTube(page);
  await openApp(page);
  await findNote(page, "Lecture");
  await leader(page, "gv");
  await expect(page.locator(frame)).toBeVisible();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  // k, j, l, f and m answer in other groups too, so each row is read inside this one.
  const video = help
    .getByRole("heading", { name: "Over a video", exact: true })
    .locator("xpath=ancestor::section[1]");
  const rows: [string, string][] = [
    ["k", "Play or pause"],
    ["j", "Ten seconds back"],
    ["l", "Ten seconds on"],
    ["y", "Take the selected transcript into the note"],
    ["f", "Full screen, and out again"],
    ["ArrowUp", "Volume up"],
    ["ArrowDown", "Volume down"],
    ["m", "Mute, and back at the same volume"],
  ];
  for (const [key, label] of rows) {
    const term = video.locator("dt").getByText(key, { exact: true });
    await expect(term.locator("xpath=following-sibling::dd[1]")).toHaveText(label);
  }
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap plays and pauses, and the note keeps the second for the next open", async ({
    page,
    stack,
  }) => {
    const blocked = await fakeYouTube(page);
    const open = async () => {
      await page.goto(`/?note=${encodeURIComponent(lecture)}`);
      const commands = page.getByRole("toolbar", { name: "Commands" });
      await expect(commands).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Notes on the first lecture")).toBeVisible();
      await commands.getByRole("button", { name: "Run a command by name" }).tap();
      await page
        .getByRole("option", { name: /Watch this note's video beside it/ })
        .first()
        .tap();
    };

    await open();
    await expect(page.locator(frame)).toHaveAttribute(
      "src",
      /\/embed\/kastenVid01\?enablejsapi=1$/,
    );
    await page.getByRole("button", { name: "Play" }).tap();
    await page.getByRole("button", { name: "Pause" }).tap();
    await expect
      .poll(() => noteText(stack.vault, lecture), { timeout: 15_000 })
      .toMatch(/^watching: \{kastenVid01: 30\}$/m);

    await open();
    await expect(page.locator(frame)).toHaveAttribute(
      "src",
      /\/embed\/kastenVid01\?enablejsapi=1&start=30$/,
    );
    expect(blocked).toEqual([]);
  });
});
