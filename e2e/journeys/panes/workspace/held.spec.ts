import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, panes, unstamped } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import {
  beside,
  FINE,
  focusedPane,
  HELD,
  held,
  layout,
  load,
  paneText,
  puts,
  seed,
  stored,
  TYPED,
} from "./stored.ts";

const GONE = "Gone.md";
const status = (page: Page) => page.getByTestId("save-status").getAttribute("aria-label");

/** Clicks into a pane's editor and leaves insert mode, so the keys after go to vim there. */
async function into(page: Page, index: number) {
  await panes(page).nth(index).locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await expect(panes(page).nth(index).locator(".cm-content:focus")).toHaveCount(1);
}

test.describe("a restored pane naming a note gone since", () => {
  test("blocks nothing beside it and is never written", async ({ page, stack }) => {
    const before = await readFile(join(stack.vault, "Welcome.md"), "utf8");
    await seed(page, layout([beside({ path: "Welcome.md" }, { path: GONE })]));
    const sent = puts(page);
    await load(page);
    await expect(page.getByText(`Could not open ${GONE}`)).toBeVisible();
    await into(page, 0);
    await page.keyboard.type("Gk0x");
    await expect
      .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
      .not.toBe(before);
    expect([sent.includes(GONE), await noteText(stack.vault, GONE)]).toEqual([false, ""]);
  });

  test("focused, writes nothing, staying or leaving", async ({ page, stack }) => {
    await page.clock.install();
    await seed(page, layout([{ id: "t", root: { id: "a", path: GONE }, focus: "a" }]));
    const sent = puts(page);
    await load(page);
    await expect(page.getByText(`Could not open ${GONE}`)).toBeVisible();
    await page.clock.runFor(5_000);
    await page.goto("about:blank");
    expect([sent, await noteText(stack.vault, GONE)]).toEqual([[], ""]);
  });
});

test.describe("held text in a restored pane", () => {
  /** Welcome focused beside Long note, which holds text a failed write left. */
  async function heldBeside(page: Page) {
    await seed(page, {
      ...held("Long note.md"),
      ...layout([beside({ path: "Welcome.md" }, { path: "Long note.md" })]),
    });
    await load(page);
    await expect(panes(page)).toHaveCount(2);
  }

  test("out of focus stays where it was: in the bar and in storage, not in the workspace or on disk", async ({
    page,
    stack,
  }) => {
    const before = await readFile(join(stack.vault, "Long note.md"), "utf8");
    await heldBeside(page);
    const heldBefore = held("Long note.md")[HELD];
    await expect
      .poll(async () => [
        (await page.getByTestId("held").getAttribute("title")) ?? "",
        await stored(page, HELD),
        ((await stored(page, FINE)) ?? TYPED).includes(TYPED),
        await noteText(stack.vault, "Long note.md"),
      ])
      .toEqual([expect.stringContaining("Long note.md"), heldBefore, false, before]);
  });

  test("out of focus comes back when the pane gets the focus by key", async ({ page }) => {
    await heldBeside(page);
    await into(page, 0);
    await leader(page, "o");
    await expect
      .poll(async () => [await focusedPane(page), await paneText(page, 1), await status(page)])
      .toEqual([1, TYPED, "Could not save"]);
  });

  test("out of focus comes back when the pane gets the focus by a click", async ({ page }) => {
    await heldBeside(page);
    await panes(page).nth(1).locator(".cm-content").click();
    await expect
      .poll(async () => [await focusedPane(page), await paneText(page, 1), await status(page)])
      .toEqual([1, TYPED, "Could not save"]);
  });

  test("thrown away in one pane does not come back from a second pane on the same note", async ({
    page,
    stack,
  }) => {
    const before = await readFile(join(stack.vault, "Welcome.md"), "utf8");
    await seed(page, {
      ...held("Welcome.md", "Not yet written when the page was hidden"),
      ...layout([beside({ path: "Welcome.md" }, { path: "Welcome.md" })]),
    });
    await load(page);
    await expect.poll(() => paneText(page, 1)).toBe(TYPED);
    await into(page, 0);
    await page.keyboard.type(":e!");
    await page.keyboard.press("Enter");
    await expect.poll(() => paneText(page, 1)).toContain("front door");

    await into(page, 1);
    await page.keyboard.type("Gk0x");
    await expect
      .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
      .not.toBe(before);
    const after = unstamped(await noteText(stack.vault, "Welcome.md"));
    expect([after.includes("\nhe front door"), after.includes("yped and never saved")]).toEqual([
      true,
      false,
    ]);
  });
});
