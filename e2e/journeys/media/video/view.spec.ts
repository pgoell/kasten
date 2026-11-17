import type { Locator, Page } from "@playwright/test";
import { findNote, leader, noteText, openApp, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube } from "../../../harness/youtube.ts";

const talk = "01 Notes/Talk.md";
const watch = (id: string, t: number) => `https://www.youtube.com/watch?v=${id}&t=${t}s`;

/** A talk on kastenVid01, then `more` (more links or sections), then a three paragraph transcript. */
const talkNote = (more = "") =>
  `# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n${more}\n## Transcript\n\n[00:05] First words here.\n\n[00:31] Second words here.\n\n[00:50] Third words here.\n`;

/** Opens `name`'s video pane by the leader and returns it, the fake player's commands answered. */
async function videoPane(page: Page, name: string): Promise<Locator> {
  await openApp(page);
  await findNote(page, name);
  await leader(page, "gv");
  const pane = page.locator("[data-video-pane]");
  await expect(pane.locator('iframe[title="video"]')).toBeVisible({ timeout: 15_000 });
  return pane;
}

/** Selects the words of the transcript paragraph holding `words`, the time's button left out. */
async function select(pane: Locator, words: string): Promise<void> {
  const paragraph = pane.getByRole("list", { name: "Transcript" }).getByText(words);
  await expect(paragraph).toBeVisible({ timeout: 15_000 });
  await paragraph.evaluate((p, wanted) => {
    const node = [...p.childNodes].find((n) => (n.textContent ?? "").includes(wanted)) as Node;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, words);
}

/** The seconds each PUT of `path` wrote into `watching:`, in order. */
function watchingWrites(page: Page, path: string): number[] {
  const seconds: number[] = [];
  page.on("request", (r) => {
    if (r.method() !== "PUT" || !decodeURIComponent(r.url()).endsWith(path)) return;
    const found = /watching: \{kastenVid01: (\d+)\}/.exec(r.postData() ?? "");
    if (found) seconds.push(Number(found[1]));
  });
  return seconds;
}

/** The commands the fake player got since its frame loaded: a reloaded frame starts with none. */
async function got(pane: Locator): Promise<string[]> {
  const frame = await (await pane.locator('iframe[title="video"]').elementHandle())?.contentFrame();
  return (await frame?.evaluate(() => (window as unknown as { got: string[] }).got)) ?? [];
}

test("Video view shows the transcript and the takes heading, keeps the pane focused, and a second press hides them", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [talk]: talkNote() });
  const blocked = await fakeYouTube(page);
  const pane = await videoPane(page, "Talk");
  const view = pane.getByRole("button", { name: "Video view" });
  const transcript = pane.getByRole("list", { name: "Transcript" });
  await expect(transcript).toHaveCount(0);

  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
  await expect(transcript).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Taken from this video" })).toBeVisible();
  await expect(pane).toBeFocused();

  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "false");
  await expect(transcript).toHaveCount(0);
  await expect(pane.getByRole("heading", { name: "Taken from this video" })).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test("the player plays on through two Video view presses, which write no second, and the pause writes its own", async ({
  page,
  stack,
}) => {
  const blocked = await fakeYouTube(page);
  const seconds = watchingWrites(page, "01 Notes/Lecture.md");
  const pane = await videoPane(page, "Lecture");
  const view = pane.getByRole("button", { name: "Video view" });

  await pane.getByRole("button", { name: "Play" }).click();
  await expect(pane.getByRole("button", { name: "Pause" })).toBeVisible();
  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "false");
  // Still the frame that was told to play: a new one would hold no command.
  expect(await got(pane)).toContain("playVideo");

  // The fake plays 30 s from 0, so a press that reported would write 1 first.
  await pane.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => seconds, { timeout: 15_000 }).toEqual([30]);
  expect(blocked).toEqual([]);
});

test("a pause after a Video view press writes the playing second once", async ({ page, stack }) => {
  const blocked = await fakeYouTube(page);
  const seconds = watchingWrites(page, "01 Notes/Lecture.md");
  const pane = await videoPane(page, "Lecture");

  await pane.getByRole("button", { name: "Play" }).click();
  await pane.getByRole("button", { name: "Video view" }).click();
  await expect(pane.getByRole("button", { name: "Video view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await pane.getByRole("button", { name: "Pause" }).click();
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Lecture.md"), { timeout: 15_000 })
    .toMatch(/^watching: \{kastenVid01: 30\}$/m);
  expect(seconds).toEqual([30]);
  expect(blocked).toEqual([]);
});

test("k pressed on a transcript time reaches the pane's keys and plays the video", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [talk]: talkNote() });
  const blocked = await fakeYouTube(page);
  const pane = await videoPane(page, "Talk");
  await pane.getByRole("button", { name: "Video view" }).click();
  const time = pane.getByRole("list", { name: "Transcript" }).getByRole("button").first();

  // Focused, not clicked: a click seeks and hands the cursor back to the pane.
  await time.focus();
  await page.keyboard.press("k");
  await expect(pane.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(time).toBeFocused();
  expect(await got(pane)).toEqual(["playVideo"]);
  expect(blocked).toEqual([]);
});

test("y takes the transcript's selection in Video view, and out of it takes nothing", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [talk]: talkNote() });
  const blocked = await fakeYouTube(page);
  const pane = await videoPane(page, "Talk");
  const view = pane.getByRole("button", { name: "Video view" });

  // A selection made in the view, then left with it: y out of the view must not take it.
  await view.click();
  await select(pane, "First words here.");
  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("y");

  await view.click();
  await select(pane, "Third words here.");
  await page.keyboard.press("y");
  await expect(pane.getByRole("status")).toContainText("Taken into the video's note");
  const text = await noteText(stack.vault, talk);
  // Only the take in the view landed: a take out of it would have been written first.
  expect(text.match(/\^hl-/g)).toHaveLength(1);
  expect(text).toContain("> Third words here.");
  expect(text).not.toContain("> First words here.");
  expect(blocked).toEqual([]);
});

test("a take still in flight when n moves to the next video shows no toast there", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [talk]: talkNote("[Two](https://youtu.be/kastenVid02)\n") });
  const blocked = await fakeYouTube(page);
  const pane = await videoPane(page, "Talk");
  await pane.getByRole("button", { name: "Video view" }).click();
  await select(pane, "Second words here.");

  let release: () => void = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const isPut = (r: { method(): string; url(): string }) =>
    r.method() === "PUT" && decodeURIComponent(r.url()).endsWith(talk);
  const put = (r: { request(): { method(): string; url(): string } }) => isPut(r.request());
  await page.route(
    (url) => decodeURIComponent(url.pathname).endsWith(talk),
    async (route) =>
      isPut(route.request()) ? gate.then(() => route.continue()) : route.fallback(),
  );
  const held = page.waitForRequest(isPut);
  await page.keyboard.press("y");
  await held;
  await page.keyboard.press("n");
  await expect(pane.locator('iframe[title="video"]')).toHaveAttribute("src", /kastenVid02/);

  // The take reads the note again before its toast, so the toast would follow that read.
  const reads = (async () => {
    await page.waitForResponse(put);
    await page.waitForResponse(
      (r) => r.request().method() === "GET" && decodeURIComponent(r.url()).endsWith(talk),
    );
  })();
  release();
  await reads;
  await expect.poll(() => noteText(stack.vault, talk)).toContain("> Second words here.");
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await expect(pane.getByText("Taken into the video's note")).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test("a note with ## Chapters lists them, and a note without draws no chapter list", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    [talk]: talkNote("\n## Chapters\n\n- 00:00 Opening\n- 01:30 The method\n"),
  });
  const blocked = await fakeYouTube(page);
  const pane = await videoPane(page, "Talk");
  await expect(pane.getByRole("list", { name: "Chapters" }).getByRole("button")).toHaveCount(2);

  await findNote(page, "Lecture");
  await leader(page, "gv");
  await expect(pane.getByRole("heading", { name: "Lecture", exact: true })).toBeVisible();
  await expect(pane.getByRole("list", { name: "Chapters" })).toHaveCount(0);
  expect(blocked).toEqual([]);
});

/** A talk with 30 takes and two chapters above its transcript, in Video view. */
async function crowded(page: Page, vault: string): Promise<Locator> {
  const takes = Array.from(
    { length: 30 },
    (_, n) =>
      `> Quote ${n}.\n\n[00:${String(n + 10)}](${watch("kastenVid01", n + 10)}) ^hl-a${String(n).padStart(5, "0")}`,
  );
  const more = `\n## Chapters\n\n- 00:00 Opening\n- 01:30 The method\n\n## Highlights\n\n${takes.join("\n\n")}\n`;
  await vaultWith(vault, { [talk]: talkNote(more) });
  return page.locator("[data-video-pane]");
}

/** Whether the transcript column sits beside or under the player, and its height over the body's. */
const column = (pane: Locator) =>
  pane.getByRole("list", { name: "Transcript" }).evaluate((list) => {
    let col = list as HTMLElement;
    while (col.parentElement?.parentElement?.hasAttribute("data-video-pane") === false) {
      col = col.parentElement;
    }
    const body = col.parentElement as HTMLElement;
    const player = body.querySelector("[data-video-box]") as HTMLElement;
    return {
      beside: col.getBoundingClientRect().left >= player.getBoundingClientRect().right,
      stacked: col.getBoundingClientRect().top >= player.getBoundingClientRect().bottom,
      share: Math.round((col.getBoundingClientRect().height / body.clientHeight) * 100) / 100,
    };
  });

test("in a wide pane the transcript column sits beside the player at the body's full height", async ({
  page,
  stack,
}) => {
  const pane = await crowded(page, stack.vault);
  const blocked = await fakeYouTube(page);
  await videoPane(page, "Talk");
  await pane.getByRole("button", { name: "Video view" }).click();
  await expect(
    pane.getByRole("list", { name: "Taken from this video" }).getByRole("listitem"),
  ).toHaveCount(30);
  expect(await column(pane)).toEqual({ beside: true, stacked: false, share: 1 });
  expect(blocked).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on Video view stacks the transcript under the player at 85% of the body", async ({
    page,
    stack,
  }) => {
    const pane = await crowded(page, stack.vault);
    const blocked = await fakeYouTube(page);
    await page.goto(`/?note=${encodeURIComponent(talk)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page
      .getByRole("option", { name: /Watch this note's video beside it/ })
      .first()
      .tap();
    await pane.getByRole("button", { name: "Video view" }).tap();
    await expect(
      pane.getByRole("list", { name: "Taken from this video" }).getByRole("listitem"),
    ).toHaveCount(30);
    expect(await column(pane)).toEqual({ beside: false, stacked: true, share: 0.85 });
    expect(blocked).toEqual([]);
  });
});
