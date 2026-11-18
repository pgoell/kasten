import type { Locator, Page } from "@playwright/test";
import { leader, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube, say, sentTo, watchBeside } from "../../../harness/youtube.ts";

const talk = "01 Notes/Talk.md";
const TEXT = "# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n\nNotes below.\n";
const shield = (pane: Locator) => pane.locator("[data-video-shield]");
const panel = (page: Page) => page.getByRole("dialog", { name: "Leader keys" });
const press = (func: string) => ({ func, args: [] });

test("#791 A4 a click on the shield plays, a second pauses, and the focus and the layout's focus move to the pane from the note", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, TEXT);

  await page.locator(".cm-content .cm-line:visible").last().click();
  await expect(shield(pane)).toHaveAccessibleName("Play");
  await shield(pane).click();
  await expect(shield(pane)).toHaveAccessibleName("Pause");
  await expect.poll(() => sentTo(pane)).toEqual([press("playVideo")]);

  await page.locator(".cm-content .cm-line:visible").last().click();
  await shield(pane).click();
  await expect(shield(pane)).toHaveAccessibleName("Play");
  expect(await sentTo(pane)).toEqual([press("playVideo"), press("pauseVideo")]);
  await expect(pane).toBeFocused();
  // The leader's q closes the pane the layout holds focused: the video's, not the note's.
  await leader(page, "q");
  await expect(pane).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Notes below.");
  expect(blocked).toEqual([]);
});

test("#791 A4 a press on the shield keeps the focus off it, Tab passes it by, and its circle shows only while paused", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, TEXT);
  const circle = shield(pane).locator("[data-paused]");
  await expect(circle).toHaveCSS("opacity", "1");

  await pane.focus();
  await shield(pane).hover();
  await page.mouse.down();
  await expect(pane).toBeFocused();
  await page.mouse.up();
  await expect(circle).toHaveCSS("opacity", "0");
  await expect(pane).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(shield(pane)).not.toBeFocused();
  expect(blocked).toEqual([]);
});

for (const vim of ["on", "off"]) {
  test(`#791 A4 after a shield click a Space on the pane starts the leader, with vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    const blocked = await fakeYouTube(page);
    const pane = await watchBeside(page, stack.vault, talk, TEXT);

    await page.locator(".cm-content .cm-line:visible").last().click();
    await shield(pane).click();
    await expect(pane).toBeFocused();
    await page.keyboard.press("Space");
    await expect(panel(page)).toBeVisible();
    expect(blocked).toEqual([]);
  });
}

test("#791 A9 k plays and pauses, l and j seek ten seconds from where the player is, and j stops at 0", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, TEXT);
  await pane.focus();

  await page.keyboard.press("k");
  await expect(shield(pane)).toHaveAccessibleName("Pause");
  await page.keyboard.press("k");
  await expect(shield(pane)).toHaveAccessibleName("Play");
  await say(pane, { playerState: 1, currentTime: 50 });
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  await say(pane, { playerState: 1, currentTime: 4 });
  await page.keyboard.press("j");

  await expect.poll(() => sentTo(pane)).toEqual([
    press("playVideo"),
    press("pauseVideo"),
    { func: "seekTo", args: [60, true] },
    { func: "seekTo", args: [50, true] },
    { func: "seekTo", args: [0, true] },
  ]);
  expect(blocked).toEqual([]);
});

test("#791 A9 with a leader pending, k does not play the video", async ({ page, stack }) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, TEXT);
  await pane.focus();

  await page.keyboard.press("Space");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("k");
  await expect(shield(pane)).toHaveAccessibleName("Play");
  expect((await sentTo(pane)).map((sent) => sent.func)).not.toContain("playVideo");
  expect(blocked).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#791 A4 a tap on the shield plays and a second pauses, and a time on a suggestion loads the linked video", async ({
    page,
    stack,
  }) => {
    const blocked = await fakeYouTube(page);
    const note = `${TEXT}\n## Transcript\n\n[00:30] Words.\n`;
    await vaultWith(stack.vault, { [talk]: note });
    await page.goto(`/?note=${encodeURIComponent(talk)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(page.getByText("Notes below.")).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().tap();
    const pane = page.locator("[data-video-pane]");
    await expect(pane.locator('iframe[title="video"]')).toBeVisible({ timeout: 15_000 });

    await shield(pane).tap();
    await expect(shield(pane)).toHaveAccessibleName("Pause");
    await shield(pane).tap();
    await expect(shield(pane)).toHaveAccessibleName("Play");
    await pane.getByRole("button", { name: "Video view" }).tap();
    await say(pane, { videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 9 });
    await pane.getByRole("button", { name: "Seek to 00:30" }).tap();
    await expect.poll(() => sentTo(pane)).toEqual([
      press("playVideo"),
      press("pauseVideo"),
      { func: "loadVideoById", args: ["kastenVid01", 30] },
    ]);
    expect(blocked).toEqual([]);
  });
});
