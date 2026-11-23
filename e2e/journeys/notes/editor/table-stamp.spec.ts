import type { Page } from "@playwright/test";
import { caretLine } from "../../../harness/app.ts";
import { test } from "../../../harness/stack.ts";
import { LINED, onDisk, pad, RAGGED, rowEnd, SAVE, stamped, TYPED_C, typeInLast } from "./table.ts";

// The note has no frontmatter, so its first save stamps one on top of the table while the
// edit waits for its line-up (#2288).

const LEAVE = {
  off: (page: Page) => page.keyboard.press("Control+End"),
  on: (page: Page) => page.keyboard.type("G"),
};

test.describe("a table typed into before the first save's frontmatter lands (#2288)", () => {
  for (const vim of ["off", "on"] as const) {
    test(`a key out with vim ${vim} lines it up`, async ({ page, stack }) => {
      await rowEnd(page, stack.vault, RAGGED, 2, vim);
      await typeInLast(page, "c", vim);
      await stamped(page);
      await LEAVE[vim](page);
      await onDisk(stack.vault, LINED);
    });

    test(`a save with the cursor still in it, vim ${vim}, lines it up`, async ({ page, stack }) => {
      await rowEnd(page, stack.vault, RAGGED, 2, vim);
      await typeInLast(page, "c", vim);
      await stamped(page);
      await SAVE[vim](page);
      await onDisk(stack.vault, LINED);
    });
  }

  test("a click out lines it up, vim off", async ({ page, stack }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await typeInLast(page, "c", "off");
    await stamped(page);
    await page.locator(".cm-content").getByText("after", { exact: true }).click();
    await onDisk(stack.vault, LINED);
  });

  test("the frontmatter landing leaves the table ragged while the cursor stays in it", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await typeInLast(page, "c", "off");
    await stamped(page);
    // A line-up here would move the padding under the cursor; the leave writes it.
    await test.expect(caretLine(page)).toHaveText("| xx | bc |");
    await onDisk(stack.vault, TYPED_C);
  });

  test("ctrl+z after the line-up puts the ragged table back, vim off", async ({ page, stack }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await typeInLast(page, "c", "off");
    await stamped(page);
    await page.keyboard.press("Control+End");
    await onDisk(stack.vault, LINED);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, TYPED_C);
  });

  test("a space typed before the head's first pipe keeps one mark, and the leave lines it up once", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await typeInLast(page, "c", "off");
    await stamped(page);
    // Put in on the mark's own position, which the stamp moved.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Home");
    await page.keyboard.type(" ");
    await page.keyboard.press("Control+End");
    const rows = pad([
      ["a", "longer"],
      ["---", "------"],
      ["xx", "bc"],
    ]).map((row) => ` ${row}`);
    await onDisk(stack.vault, [...rows, "", "after"].join("\n"));
  });
});
