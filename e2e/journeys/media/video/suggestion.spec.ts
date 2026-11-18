import type { Locator, Page } from "@playwright/test";
import { leader } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube, say, sentTo, watchBeside, watchingPuts } from "../../../harness/youtube.ts";

const talk = "01 Notes/Talk.md";
const LINKED = "kastenVid01";
const OTHER = "iDulhoQ2pro";

/** A take at 0:40, a chapter at 0:20 and a paragraph at 0:30: one of each control that seeks. */
const MARKED = `# Talk\n\n[The talk](https://youtu.be/${LINKED})\n\n> Q.\n\n[00:40](https://www.youtube.com/watch?v=${LINKED}&t=40s) ^hl-a1b2c3\n\n## Chapters\n\n[00:20] Part two\n\n## Transcript\n\n[00:30] Words.\n`;
const seek = (at: number) => ({ func: "seekTo", args: [at, true] });
const load = (at: number) => ({ func: "loadVideoById", args: [LINKED, at] });
const onLinked = (at: number) => ({ videoData: { video_id: LINKED }, playerState: 1, currentTime: at });
const onOther = (at?: number, id = OTHER) => ({ videoData: { video_id: id }, playerState: 1, currentTime: at });

/** The pane in Video view on MARKED, where the takes, chapters and transcript show. */
async function marked(page: Page, vault: string): Promise<Locator> {
  const pane = await watchBeside(page, vault, talk, MARKED);
  await pane.getByRole("button", { name: "Video view" }).click();
  await expect(pane.getByRole("list", { name: "Transcript" })).toBeVisible({ timeout: 15_000 });
  return pane;
}

async function clickMarks(pane: Locator): Promise<void> {
  for (const name of [/Part two/, "Seek to 00:40", "Seek to 00:30"]) {
    await pane.getByRole("button", { name }).click();
  }
}

async function keys(page: Page, pane: Locator, pressed: string[]): Promise<void> {
  await pane.focus();
  for (const key of pressed) await page.keyboard.press(key);
}

test("#1497 A1 l and j on a suggestion seek it from its own second, down to 0, and never load the linked video", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, MARKED);
  await say(pane, onLinked(200));
  await say(pane, onOther(12));
  await keys(page, pane, ["l", "j", "j", "j"]);
  await expect.poll(() => sentTo(pane)).toEqual([seek(22), seek(12), seek(2), seek(0)]);
  expect(blocked).toEqual([]);
});

test("#1497 I1 a second suggestion counts from its own second, not the first one's", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, MARKED);
  await say(pane, onLinked(200));
  await say(pane, onOther(90));
  await say(pane, onOther(undefined, "aBcDeFgHiJk"));
  await keys(page, pane, ["l"]);
  await expect.poll(() => sentTo(pane)).toEqual([seek(10)]);
  expect(blocked).toEqual([]);
});

test("#1497 I2 l and a pause on a suggestion leave the linked video's second and write nothing for it", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const pane = await watchBeside(page, stack.vault, talk, MARKED);
  await say(pane, onLinked(200));
  await say(pane, onOther(30));
  await keys(page, pane, ["l"]);
  await expect.poll(() => sentTo(pane)).toEqual([seek(40)]);
  // A pause on the suggestion is a stop, which would write if the pane took it for the linked video.
  await say(pane, { playerState: 2, currentTime: 45 });
  await say(pane, { videoData: { video_id: LINKED }, playerState: 1 });
  await keys(page, pane, ["l"]);
  await expect.poll(() => sentTo(pane)).toEqual([seek(40), seek(210)]);
  await say(pane, { playerState: 2, currentTime: 212 });
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([`${LINKED}: 212`]);
  expect(blocked).toEqual([]);
});

test("#1498 I3 j and l on the ended linked video count from its end second", async ({ page, stack }) => {
  const blocked = await fakeYouTube(page);
  const pane = await watchBeside(page, stack.vault, talk, MARKED);
  await say(pane, onLinked(200));
  await say(pane, { playerState: 0, currentTime: 212 });
  await keys(page, pane, ["j", "l", "l"]);
  await expect.poll(() => sentTo(pane)).toEqual([seek(202), seek(212), seek(222)]);
  expect(blocked).toEqual([]);
});

test("#1566 A1 I1 a chapter, a take and a paragraph load the linked video from a suggestion, and seek it when on it", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const pane = await marked(page, stack.vault);
  await say(pane, onLinked(200));
  await clickMarks(pane);
  await expect.poll(() => sentTo(pane)).toEqual([seek(20), seek(40), seek(30)]);

  await say(pane, onOther());
  await clickMarks(pane);
  await expect
    .poll(() => sentTo(pane))
    .toEqual([seek(20), seek(40), seek(30), load(20), load(40), load(30)]);
  expect(blocked).toEqual([]);
});

test("#1566 I2 a click on a suggestion writes nothing until the linked video pauses under its own id", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const pane = await marked(page, stack.vault);
  await say(pane, onOther(9));
  await pane.getByRole("button", { name: "Seek to 00:30" }).click();
  await say(pane, { playerState: 2, currentTime: 12 });
  await expect.poll(() => sentTo(pane)).toEqual([load(30)]);

  await say(pane, onLinked(31));
  await say(pane, { playerState: 2, currentTime: 35 });
  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([`${LINKED}: 35`]);
  expect(blocked).toEqual([]);
});

test("#1566 I3 an ended linked video loaded back by a click, closed while it buffers, writes the clicked second", async ({
  page,
  stack,
}) => {
  test.fail(true, "#2200: a close by Space q writes no position");
  const blocked = await fakeYouTube(page);
  const puts = watchingPuts(page, talk);
  const pane = await marked(page, stack.vault);
  await say(pane, onLinked(200));
  await say(pane, { playerState: 0, currentTime: 212 });
  await say(pane, onOther(3));
  await pane.getByRole("button", { name: /Part two/ }).click();
  await expect.poll(() => sentTo(pane)).toEqual([load(20)]);
  await say(pane, { videoData: { video_id: LINKED }, playerState: 3, currentTime: 0 });
  await leader(page, "q");
  await expect(pane).toHaveCount(0);
  await expect.poll(() => puts, { timeout: 10_000 }).toEqual([`${LINKED}: 20`]);
  expect(blocked).toEqual([]);
});

for (const vim of ["on", "off"]) {
  test(`#1566 I4 I6 a click on a suggestion loads the linked video and gives the pane the cursor, with vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    const blocked = await fakeYouTube(page);
    const pane = await marked(page, stack.vault);
    await page.locator(".cm-content .cm-line:visible").last().click();
    await say(pane, onOther());
    await pane.getByRole("button", { name: /Part two/ }).click();
    await expect.poll(() => sentTo(pane)).toEqual([load(20)]);
    await expect(pane).toBeFocused();
    expect(blocked).toEqual([]);
  });
}
