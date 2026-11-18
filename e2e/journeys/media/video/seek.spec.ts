import type { Page } from "@playwright/test";
import { leader } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube, say, sentTo, watchBeside, watchingPuts } from "../../../harness/youtube.ts";

const talk = "01 Notes/Talk.md";
const LINKED = "kastenVid01";
const OTHER = "iDulhoQ2pro";

/** A talk on the linked video, `watching` in its block when given, `more` lines, and a bare time at 01:30. */
const talkNote = (watching?: number, more = "") =>
  `${watching === undefined ? "" : `---\nwatching: {${LINKED}: ${watching}}\n---\n`}# Talk\n\n[The talk](https://youtu.be/${LINKED})\n${more}\nAt [01:30] the point.\n`;

/** The note's time button, as live preview draws it. */
const time = (page: Page, label = "01:30") =>
  page.locator(".cm-content").getByRole("button", { name: `Seek to ${label}`, exact: true });
const seek = (at: number) => ({ func: "seekTo", args: [at, true] });
const load = (at: number) => ({ func: "loadVideoById", args: [LINKED, at] });

test("#791 A11 a time in the note seeks the player there, and the same time again seeks again", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, talkNote());
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([seek(90)]);
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([seek(90), seek(90)]);
  expect(blocked).toEqual([]);
});

test("#791 A11 a pane opened again after a time was clicked does not seek until a time is clicked again", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  let pane = await watchBeside(page, stack.vault, talk, talkNote());
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([seek(90)]);

  await pane.focus();
  await leader(page, "q");
  await expect(pane).toHaveCount(0);
  await page.locator(".cm-content").click();
  await leader(page, "gv");
  pane = page.locator("[data-video-pane]");
  await expect(pane.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 15_000 });
  // The new player answered its subscription, so a seek on mount would have reached it by now.
  await expect.poll(() => sentTo(pane)).toEqual([]);
  await say(pane, { playerState: 2, currentTime: 0 });
  expect(await sentTo(pane)).toEqual([]);

  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([seek(90)]);
  expect(blocked).toEqual([]);
});

test("#1192 A2 I2 a time loads the linked video back when the player is on another, and seeks it when on it", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, talkNote());
  await say(pane, { videoData: { video_id: OTHER }, playerState: 1 });
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([load(90)]);

  await say(pane, { videoData: { video_id: LINKED }, playerState: 1 });
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([load(90), seek(90)]);
  expect(blocked).toEqual([]);
});

test("#1192 I3 the linked video loaded back by a time writes its pause under its own id", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const pane = await watchBeside(page, stack.vault, talk, talkNote());
  await say(pane, { videoData: { video_id: OTHER }, playerState: 1, currentTime: 30 });
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([load(90)]);
  await say(pane, { videoData: { video_id: LINKED }, playerState: 1, currentTime: 91 });
  await say(pane, { playerState: 2, currentTime: 95 });
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([`${LINKED}: 95`]);
  expect(blocked).toEqual([]);
});

test("#1192 I3 an ended linked video loaded back by a time, closed while it buffers, writes the asked second", async ({
  page,
  stack,
}) => {
  test.fail(true, "#2200: a close by Space q writes no position");
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const pane = await watchBeside(page, stack.vault, talk, talkNote(150));
  await say(pane, { videoData: { video_id: LINKED }, playerState: 1, currentTime: 200 });
  await say(pane, { playerState: 0, currentTime: 212 });
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([""]);
  await say(pane, { videoData: { video_id: OTHER }, playerState: 1, currentTime: 3 });
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([load(90)]);
  await say(pane, { videoData: { video_id: LINKED }, playerState: 3, currentTime: 0 });
  await pane.focus();
  await leader(page, "q");
  await expect(pane).toHaveCount(0);
  await expect.poll(() => puts, { timeout: 10_000 }).toEqual(["", `${LINKED}: 90`]);
  expect(blocked).toEqual([]);
});

test("#791 R8 a take of the note's other video switches the player to it at that second and writes the first one's", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const take = `\n[two](https://youtu.be/${OTHER})\n\n> Q.\n\n[01:30](https://www.youtube.com/watch?v=${OTHER}&t=90s) ^hl-a1b2c3\n`;
  const pane = await watchBeside(page, stack.vault, talk, talkNote(undefined, take));
  await say(pane, { playerState: 1, currentTime: 12 });
  await time(page).first().click();
  await expect(pane.locator('iframe[title="video"]')).toHaveAttribute(
    "src",
    `https://www.youtube.com/embed/${OTHER}?enablejsapi=1&start=90`,
  );
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([`${LINKED}: 12`]);
  expect(blocked).toEqual([]);
});

test("#791 R8 a take typed for a video the pane has not read yet leaves the player alone", async ({
  page,
  stack,
}) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, talkNote());
  // The save never lands, so the pane still holds the note before the take and does not link its video.
  await page.route(`**/api/files/${encodeURIComponent(talk).replaceAll("%2F", "/")}`, (route) =>
    route.request().method() === "PUT" ? new Promise(() => {}) : route.fallback(),
  );
  await page.locator(".cm-content .cm-line:visible").last().click();
  await page.keyboard.type("[02:00](https://www.youtube.com/watch?v=other0000xx&t=120s)");
  await page.locator(".cm-content .cm-line:visible").first().click();
  await time(page, "02:00").click();
  // The note's own time still seeks, so the click above had its chance to.
  await time(page).click();
  await expect.poll(() => sentTo(pane)).toEqual([seek(90)]);
  await expect(pane.locator('iframe[title="video"]')).toHaveAttribute(
    "src",
    `https://www.youtube.com/embed/${LINKED}?enablejsapi=1`,
  );
  expect(blocked).toEqual([]);
});
