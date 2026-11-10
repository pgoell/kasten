import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  findNote,
  leader,
  noteText,
  openApp,
  openFromTree,
  openNote,
  panes,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** The panes' boxes, leftmost first, once each has settled on screen. */
async function boxes(page: Page) {
  const found = await Promise.all((await panes(page).all()).map((pane) => pane.boundingBox()));
  return found.filter((box) => box !== null).sort((a, b) => a.x - b.x || a.y - b.y);
}

test("a split keeps the editor and its note", async ({ page }) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  const editor = page.locator(".cm-editor", { hasText: "front door" });
  await editor.click();
  await page.keyboard.press("Escape");
  // A mark on the DOM node: a remounted editor would come back without it.
  await editor.evaluate((node) => node.setAttribute("data-e2e-kept", "yes"));
  await leader(page, "%");
  // The new pane opens on the day page beside the note.
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await expect(page.locator(".cm-editor")).toHaveCount(2);
  await expect(page.locator(".cm-editor[data-e2e-kept=yes]")).toContainText("front door");
});

test("a split right and a split down make three panes, one beside and one below", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  await leader(page, '"');
  await expect(panes(page)).toHaveCount(3);
  // The Welcome pane stands on the left; the other two stand right of it, one above the other.
  await expect
    .poll(async () => {
      const [left, upper, lower] = await boxes(page);
      return (
        upper !== undefined &&
        lower !== undefined &&
        upper.x > left.x + left.width - 1 &&
        Math.abs(upper.x - lower.x) < 2 &&
        lower.y > upper.y + upper.height - 1
      );
    })
    .toBe(true);
});

test("a close takes the empty pane away and leaves Welcome", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  // The new pane is empty, so the first q closes it.
  await leader(page, "q");
  await expect(panes(page)).toHaveCount(1);
  await expect(page.locator(".cm-editor", { hasText: "front door" })).toBeVisible();
});

test("the panes and their notes are back after a reload", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await findNote(page, "Garden");
  await expect(page.locator(".cm-editor", { hasText: "water the tomatoes" })).toBeVisible();
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  await expect(panes(page).filter({ hasText: "front door" })).toHaveCount(1);
  await expect(panes(page).filter({ hasText: "water the tomatoes" })).toHaveCount(1);
});

test("a timers pane restored by a reload holds the focus, so the leader key works", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "gT");
  await expect(page.getByLabel("timers pane")).toBeFocused();
  await page.reload();
  await expect(page.getByLabel("timers pane")).toBeFocused();
  await leader(page, "gt");
  await expect(page.getByLabel("Todos", { exact: true })).toBeVisible();
});

test("q in the tree hands the keys to the focused pane, the second of two", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  await leader(page, "e");
  await expect(page.getByRole("navigation", { name: "Vault" }).locator(":focus")).toHaveCount(1);
  await page.keyboard.press("q");
  await expect(page.getByRole("navigation", { name: "Vault" })).toBeHidden();
  await expect(panes(page).filter({ has: today }).locator(".cm-content")).toBeFocused();
  await leader(page, "ff");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
});

test("q in the tree with vim off sends what is typed next into the note", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  await openFromTree(page, "Welcome");
  const note = page.locator(".cm-editor", { hasText: "front door" });
  await note.locator(".cm-content").click();
  const row = page
    .getByRole("navigation", { name: "Vault" })
    .getByRole("button", { name: "Welcome", exact: true });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("q");
  await expect(page.getByRole("navigation", { name: "Vault" })).toBeHidden();
  await page.keyboard.type("zq");
  await expect(note).toContainText("zq");
});

test("Escape in the tree hands the keys to the focused pane, the second of two", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  await leader(page, "e");
  const tree = page.getByRole("navigation", { name: "Vault" });
  await expect(tree.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(tree).toBeVisible();
  await expect(panes(page).filter({ has: today }).locator(".cm-content")).toBeFocused();
  await leader(page, "ff");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
});

test("Escape in the tree with vim off types into the focused pane, the second of two", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  // The split needs vim's leader, so it is made first and the reload brings it back with vim off.
  await page.evaluate(() => localStorage.setItem("kasten.vim", "off"));
  await page.reload();
  const right = panes(page).filter({ has: today }).locator(".cm-content");
  await right.click();
  const row = page
    .getByRole("navigation", { name: "Vault" })
    .getByRole("button", { name: "Welcome", exact: true });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.type("zq");
  await expect(right).toContainText("zq");
  await expect(page.locator(".cm-editor", { hasText: "front door" })).not.toContainText("zq");
});

test("a swap of two panes writes the waiting text first, and the note's pane trades places", async ({
  page,
  stack,
}) => {
  await page.clock.install();
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  const note = page.locator(".cm-content", { hasText: "front door" });
  await note.click();
  await page.keyboard.press("Escape");
  // A paused clock holds the quiet write back, so only the swap can send the text.
  await page.clock.pauseAt(Date.now() + 1_000);
  await page.keyboard.type("Gotyped before the swap");
  await page.keyboard.press("Escape");
  await expect(note).toContainText("typed before the swap");
  expect(await noteText(stack.vault, "Welcome.md")).not.toContain("typed before the swap");
  const [left] = await boxes(page);
  await leader(page, "L");
  await expect
    .poll(
      async () => [
        (await noteText(stack.vault, "Welcome.md")).includes("typed before the swap"),
        ((await note.boundingBox())?.x ?? 0) > left.x + left.width - 1,
        await page.locator(".cm-content:focus", { hasText: "front door" }).count(),
      ],
      { timeout: 15_000 },
    )
    .toEqual([true, true, 1]);
});

test.describe("the top bar", () => {
  const bar = (page: Page) => page.locator("[data-top-bar]");
  const field = (page: Page) => bar(page).getByRole("button", { name: /^Search \d+ notes$/ });

  test("the bar is 56 px tall at the top and holds the wordmark, Vault, Graph, Search, the field and New note", async ({
    page,
  }) => {
    await openApp(page);
    await expect
      .poll(async () => await bar(page).boundingBox())
      .toMatchObject({ y: 0, height: 56 });
    await expect(bar(page).getByText("kasten", { exact: true })).toBeVisible();
    const main = bar(page).getByRole("navigation", { name: "Main" });
    for (const name of ["Vault", "Graph", "Search"]) {
      await expect(main.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(bar(page).getByRole("button", { name: "New note", exact: true })).toBeVisible();
    await expect(field(page)).toBeVisible();
  });

  test("the search field counts the notes on disk, one more after a note is written there", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    await expect(field(page)).toBeVisible();
    const before = Number((await field(page).getAttribute("aria-label"))?.match(/\d+/)?.[0]);
    await writeFile(join(stack.vault, "Counted.md"), "one more note\n");
    await page.reload();
    await expect(bar(page).getByRole("button", { name: `Search ${before + 1} notes` })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
  });

  test("Graph in the top bar opens the vault graph", async ({ page }) => {
    await openApp(page);
    await bar(page).getByRole("button", { name: "Graph", exact: true }).click();
    await expect(page.locator("[data-graph-pane]")).toBeVisible();
  });

  test("New note in the top bar opens the new note prompt, and the note it makes is written to disk", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    await bar(page).getByRole("button", { name: "New note", exact: true }).click();
    const prompt = page.getByRole("dialog", { name: "New note" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("combobox").fill("From the bar");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "From the bar", selected: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await page.keyboard.type("iWritten from the bar.");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => noteText(stack.vault, "From the bar.md"), { timeout: 15_000 })
      .toContain("Written from the bar.");
  });
});
