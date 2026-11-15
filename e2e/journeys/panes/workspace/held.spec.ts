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

/** The held store as a page before this one left it: each path's texts by reason and conflict. */
const heldStore = (notes: Record<string, [reason: string, conflicted?: boolean][]>) => ({
  [HELD]: JSON.stringify(
    Object.fromEntries(
      Object.entries(notes).map(([path, texts]) => [
        path,
        texts.map(([reason, conflicted = false]) => ({ content: TYPED, reason, conflicted })),
      ]),
    ),
  ),
});
const WELCOME_ALONE = layout([{ id: "t", root: { id: "a", path: "Welcome.md" }, focus: "a" }]);
const bar = (page: Page, id: string) => page.getByTestId(id);
const detail = (page: Page) => page.getByTestId("status-detail");

test.describe("the bar's list of notes left behind", () => {
  test("names a note whose write failed and the way back to it, leaving the open note's sign alone", async ({
    page,
  }) => {
    await seed(page, {
      ...heldStore({ "Notes/index.md": [["PUT failed with 500"]] }),
      ...WELCOME_ALONE,
    });
    await load(page);
    await expect(bar(page, "held")).toHaveText("Not saved: index");
    const title = await bar(page, "held").getAttribute("title");
    expect(title).toContain("Notes/index.md: PUT failed with 500");
    expect(title).toContain("Open the note to write it again, or :e! there to drop it.");
    await expect(page.getByTestId("save-status")).toHaveAttribute("aria-label", "Saved");
  });

  test("lists every held note, and drops each from the list when its text goes", async ({
    page,
  }) => {
    const b: [string][] = [["PUT failed with 502"]];
    const two = heldStore({ "a.md": [["PUT failed with 500"]], "Sub/b.md": b });
    await seed(page, { ...two, ...WELCOME_ALONE });
    await load(page);
    await expect(bar(page, "held")).toHaveText("Not saved: 2 notes");
    await expect(bar(page, "held")).toHaveAttribute("title", /a\.md: PUT failed with 500/);
    await expect(bar(page, "held")).toHaveAttribute("title", /Sub\/b\.md: PUT failed with 502/);

    // Another tab writes or drops a held text, and this tab's bar follows its storage.
    const other = await page.context().newPage();
    await other.goto("/api/version");
    const write = (value: string) =>
      other.evaluate(([key, held]) => localStorage.setItem(key, held), [HELD, value]);
    await write(heldStore({ "Sub/b.md": b })[HELD]);
    await expect(bar(page, "held")).toHaveText("Not saved: b");
    await expect(bar(page, "held")).not.toHaveAttribute("title", /a\.md/);
    await write("{}");
    await expect(bar(page, "held")).toHaveCount(0);
  });

  test("names a note holding two texts once, and lists both", async ({ page }) => {
    await seed(page, {
      ...heldStore({ "a.md": [["PUT failed with 500"], ["PUT failed with 502"]] }),
      ...WELCOME_ALONE,
    });
    await load(page);
    await expect(bar(page, "held")).toHaveText("Not saved: a");
    await expect(bar(page, "held")).toHaveAttribute("title", /a\.md: PUT failed with 500/);
    await expect(bar(page, "held")).toHaveAttribute("title", /a\.md: PUT failed with 502/);
  });

  test("lists a conflict left behind under its own label, which opens to its way out", async ({
    page,
  }) => {
    await seed(page, {
      ...heldStore({ "Notes/index.md": [["Changed on disk", true]] }),
      ...WELCOME_ALONE,
    });
    await load(page);
    await expect(bar(page, "held-conflict")).toHaveText("Changed on disk: index");
    await expect(bar(page, "held")).toHaveCount(0);
    await bar(page, "held-conflict").click();
    await expect(detail(page)).toContainText("Notes/index.md: Changed on disk");
    await expect(detail(page)).toContainText(":w keeps your text, :e! takes the vault's.");
  });
});
