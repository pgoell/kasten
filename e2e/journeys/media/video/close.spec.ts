import type { Locator, Page } from "@playwright/test";
import { findNote, leader, noteText, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube, say, sentTo, watchBeside, watchingPuts } from "../../../harness/youtube.ts";

const talk = "01 Notes/Talk.md";
const LINKED = "kastenVid01";
const pane = (page: Page) => page.locator("[data-video-pane]");
const shield = (on: Locator) => on.locator("[data-video-shield]");
const editor = (page: Page) => page.locator(".cm-content .cm-line:visible");

/** A talk on the linked video, `watching` in its block when given, and a bare time at 01:30. */
const talkNote = (watching?: number) =>
  `${watching === undefined ? "" : `---\nwatching: {${LINKED}: ${watching}}\n---\n`}# Talk\n\n[The talk](https://youtu.be/${LINKED})\n\nAt [01:30] the point.\n`;

/** Plays the video by its shield and has the player say it stands at `at`, as its ticks do. */
async function playTo(on: Locator, at: number): Promise<void> {
  await shield(on).click();
  await expect(shield(on)).toHaveAccessibleName("Pause");
  await say(on, { playerState: 1, currentTime: at });
}

/** Waits until the note on disk holds `entry` as its watching line. */
async function watching(vault: string, entry: string): Promise<void> {
  const line = new RegExp(`^watching: \\{${entry}\\}$`, "m");
  await expect.poll(() => noteText(vault, talk), { timeout: 15_000 }).toMatch(line);
}

for (const vim of ["on", "off"]) {
  test(`#2200 Space q on a playing video writes its second, and the pane opens there again, with vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    const blocked = await fakeYouTube(page);
    const video = await watchBeside(page, stack.vault, talk, talkNote());
    await playTo(video, 42);
    await video.focus();
    await leader(page, "q");
    await expect(video).toHaveCount(0);
    await watching(stack.vault, `${LINKED}: 42`);

    // A reload drops what the page held, so the second can only come from the note.
    await page.reload();
    await editor(page).last().click({ timeout: 15_000 });
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().click();
    await expect(pane(page).locator('iframe[title="video"]')).toHaveAttribute(
      "src",
      `https://www.youtube.com/embed/${LINKED}?enablejsapi=1&start=42`,
    );
    expect(blocked).toEqual([]);
  });
}

test("#2200 Space q after a time in the note seeked the player writes that second", async ({ page, stack }) => {
  const blocked = await fakeYouTube(page);
  const video = await watchBeside(page, stack.vault, talk, talkNote());
  await page.locator(".cm-content").getByRole("button", { name: "Seek to 01:30", exact: true }).click();
  await expect.poll(() => sentTo(video)).toEqual([{ func: "seekTo", args: [90, true] }]);
  await video.focus();
  await leader(page, "q");
  await expect(video).toHaveCount(0);
  await watching(stack.vault, `${LINKED}: 90`);
  expect(blocked).toEqual([]);
});

test("#2200 a pause writes, and a close after it writes nothing new", async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const video = await watchBeside(page, stack.vault, talk, talkNote());
  // The fake player stands 30 s on after a play, so the pause says 30.
  await playTo(video, 12);
  await shield(video).click();
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([`${LINKED}: 30`]);
  await leader(page, "q");
  await expect(video).toHaveCount(0);
  // A save of typed text is the next PUT, so anything the close wrote would sit before it.
  await editor(page).last().click();
  await page.keyboard.type("Typed.");
  await expect.poll(() => noteText(stack.vault, talk), { timeout: 15_000 }).toContain("Typed.");
  expect(puts).toEqual([`${LINKED}: 30`, `${LINKED}: 30`]);
  expect(blocked).toEqual([]);
});

test("#2200 a close with no play writes nothing", async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const video = await watchBeside(page, stack.vault, talk, talkNote(150));
  await video.focus();
  await leader(page, "q");
  await expect(video).toHaveCount(0);
  await editor(page).last().click();
  await page.keyboard.type("Typed.");
  await expect.poll(() => noteText(stack.vault, talk), { timeout: 15_000 }).toContain("Typed.");
  expect(puts).toEqual([`${LINKED}: 150`]);
  expect(blocked).toEqual([]);
});

for (const from of ["the video pane", "the note"]) {
  test(`#2200 the tab's × on a playing video writes its second, from ${from}`, async ({ page, stack }) => {
    const blocked = await fakeYouTube(page);
    const video = await watchBeside(page, stack.vault, talk, talkNote());
    await playTo(video, 42);
    if (from === "the note") await editor(page).last().click();
    await page.getByRole("button", { name: "Close Talk" }).click();
    await expect(video).toHaveCount(0);
    await watching(stack.vault, `${LINKED}: 42`);
    expect(blocked).toEqual([]);
  });
}

test("#2200 a close keeps text typed in the note beside, and u leaves the watching line", async ({
  page,
  stack,
}) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
  const blocked = await fakeYouTube(page);
  const video = await watchBeside(page, stack.vault, talk, talkNote());
  await playTo(video, 42);
  await editor(page).last().click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("iTyped words.");
  await page.keyboard.press("Escape");
  await video.focus();
  await leader(page, "q");
  await expect(video).toHaveCount(0);
  await watching(stack.vault, `${LINKED}: 42`);
  await expect.poll(() => noteText(stack.vault, talk)).toContain("Typed words.");

  await editor(page).last().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await expect.poll(() => noteText(stack.vault, talk), { timeout: 15_000 }).not.toContain("Typed words.");
  await watching(stack.vault, `${LINKED}: 42`);
  expect(blocked).toEqual([]);
});

test("#2200 a pause after a close is not undone when the note opens again", async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
  const blocked = await fakeYouTube(page);
  await vaultWith(stack.vault, { "01 Notes/Other.md": "# Other\n\nElse.\n" });
  let video = await watchBeside(page, stack.vault, talk, talkNote());
  await playTo(video, 42);
  await video.focus();
  await leader(page, "q");
  await watching(stack.vault, `${LINKED}: 42`);

  await editor(page).last().click();
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().click();
  video = pane(page);
  // Opened at 42, the fake player stands at 72 after a play.
  await shield(video).click();
  await expect(shield(video)).toHaveAccessibleName("Pause");
  await shield(video).click();
  await watching(stack.vault, `${LINKED}: 72`);

  await editor(page).last().click();
  await page.keyboard.press("Escape");
  await findNote(page, "Other");
  await findNote(page, "Talk");
  await expect(page.getByText("the point.")).toBeVisible();
  await page.keyboard.type("GoTyped.");
  await page.keyboard.press("Escape");
  await expect.poll(() => noteText(stack.vault, talk), { timeout: 15_000 }).toContain("Typed.");
  await watching(stack.vault, `${LINKED}: 72`);
  expect(blocked).toEqual([]);
});

test("#2200 closing the note beside leaves the video playing, and its next pause writes", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const video = await watchBeside(page, stack.vault, talk, talkNote());
  await playTo(video, 12);
  await editor(page).last().click();
  await page.keyboard.press("Escape");
  await leader(page, "q");
  await expect(page.getByText("the point.")).toHaveCount(0);
  await expect(shield(video)).toHaveAccessibleName("Pause");
  await shield(video).click();
  await watching(stack.vault, `${LINKED}: 30`);
  expect(blocked).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#2200 closing a playing video by taps writes its second", async ({ page, stack }) => {
    const blocked = await fakeYouTube(page);
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(stack.vault, { [talk]: talkNote() });
    await page.goto(`/?note=${encodeURIComponent(talk)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(page.getByText("the point.")).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().tap();
    const video = pane(page);
    await expect(video.locator('iframe[title="video"]')).toBeVisible({ timeout: 15_000 });
    await shield(video).tap();
    await expect(shield(video)).toHaveAccessibleName("Pause");
    await say(video, { playerState: 1, currentTime: 42 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /Close the note, then the pane/ }).first().tap();
    await expect(video).toHaveCount(0);
    await watching(stack.vault, `${LINKED}: 42`);
    expect(blocked).toEqual([]);
  });
});
