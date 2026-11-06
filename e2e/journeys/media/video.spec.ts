import { findNote, leader, noteText, openApp, phone } from "../../harness/app.ts";
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
