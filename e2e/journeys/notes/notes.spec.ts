import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { findNote, leader, noteText, openApp } from "../../harness/app.ts";
import { type Hit, hit, lineOf, openPanel } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

test("a new note made from the note prompt is written to disk with the typed line", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "cf");
  const prompt = page.getByRole("dialog", { name: "New note" });
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.getByRole("combobox").fill("Plans");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Plans", selected: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.type("i");
  await page.keyboard.type("Pack the seed potatoes before Sunday.");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => noteText(stack.vault, "Plans.md"), { timeout: 15_000 })
    .toContain("Pack the seed potatoes before Sunday.");
});

test("renaming a note rewrites the links that named it", async ({ page, stack }) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "rf");
  const prompt = page.getByRole("dialog", { name: "Rename note" });
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.getByRole("combobox").fill("01 Notes/Proverb");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Proverb.md"), { timeout: 15_000 })
    .toContain("The best time to plant a tree");
  await expect.poll(() => readdir(join(stack.vault, "01 Notes"))).not.toContain("Quote.md");
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Reading.md"), { timeout: 15_000 })
    .toMatch(/\[\[Proverb\]\][\s\S]*!\[\[Proverb\]\]/);
});

test("following a wikilink opens the note it names", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Welcome");
  const editor = page.locator(".cm-editor", { hasText: "front door" });
  await expect(editor).toBeVisible();
  await editor.getByText("Garden", { exact: true }).click({ modifiers: ["Control"] });
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});

test("the backlinks panel lists the note that links to the open one", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "gb");
  const panel = page.getByRole("dialog", { name: "Backlinks" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // The backlinks are asked for once the panel opens, which can trail the editor under load.
  await expect(panel).toContainText("Reading", { timeout: 15_000 });
  await expect(panel).toContainText("[[Quote]]");
});

test("an embed draws the text of the note it names inside the note", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Reading");
  await expect(page.locator(".cm-embed")).toContainText(
    "The best time to plant a tree was twenty years ago.",
  );
});

/** Opens the backlinks of the Garden note, the vault answering its name with `hits`; returns what was asked. */
async function gardenBacklinks(
  page: Page,
  hits: Hit[] | (() => Promise<Hit[]>),
  narrow = false,
): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/search?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    // The recent notes ask the search too, by their `modified:` date.
    if (q.startsWith("modified:")) return route.fallback();
    asked.push(q);
    const answer = typeof hits === "function" ? await hits() : hits;
    await route.fulfill({ json: q === "Garden" ? answer : [] });
  });
  await page.route("**/api/mentions?**", (route) => route.fulfill({ json: [] }));
  await openApp(page);
  await findNote(page, "Garden");
  // The app opens wide, since a narrow window has no tree to open the note from.
  if (narrow) await page.setViewportSize({ width: 600, height: 900 });
  await openPanel(page, "gb", "backlinks");
  return asked;
}

const backlinks = (page: Page) =>
  page.getByRole("dialog", { name: "Backlinks" }).getByRole("option");

test("the backlinks panel asks once for the note's name and keeps the links to it in every spelling, not the lines that only say the name", async ({
  page,
}) => {
  const asked = await gardenBacklinks(page, [
    hit("Welcome.md", 3, "see [[Garden]]"),
    hit("Welcome.md", 9, "Garden wrote the library"),
    hit("01 Notes/Reading.md", 3, "see [[02 Projects/Garden]]"),
    hit("01 Notes/Reading.md", 4, "see [[Garden|Beds]]"),
    hit("01 Notes/Reading.md", 5, "see [[Garden#Spring]]"),
    hit("Long note.md", 2, "![[Garden#Spring]]"),
    hit("Long note.md", 3, "![[02 Projects/Garden|Beds]]"),
  ]);
  // One poll: the rows land with the one question asked, before a key is typed.
  await expect.poll(async () => [await backlinks(page).count(), asked]).toEqual([6, ["Garden"]]);
  await expect(page.getByRole("dialog", { name: "Backlinks" })).not.toContainText(
    "wrote the library",
  );
});

test("typing narrows the backlinks in hand without asking the vault again", async ({ page }) => {
  const asked = await gardenBacklinks(page, [
    hit("Welcome.md", 3, "see [[Garden]]"),
    hit("01 Notes/Reading.md", 3, "the library of [[Garden]]"),
  ]);
  await expect(backlinks(page)).toHaveCount(2);
  await page.keyboard.type("library");
  await expect.poll(async () => [await backlinks(page).count(), asked]).toEqual([1, ["Garden"]]);
});

test("Tab, Shift+Tab, the arrows, Ctrl+N and Ctrl+P walk the backlinks, Escape closes, and Enter opens the line", async ({
  page,
  stack,
}) => {
  await gardenBacklinks(page, async () => [
    hit("Welcome.md", 3, "see [[Garden]]"),
    hit(
      "01 Notes/Reading.md",
      await lineOf(stack.vault, "01 Notes/Reading.md", "habit"),
      "and [[Garden]]",
    ),
  ]);
  const rows = backlinks(page);
  await expect(rows).toHaveCount(2);
  const at = (index: number) => expect(rows.nth(index)).toHaveAttribute("aria-selected", "true");
  for (const [key, index] of [
    ["Tab", 1],
    ["Shift+Tab", 0],
    ["ArrowDown", 1],
    ["ArrowDown", 1],
    ["Control+p", 0],
    ["Control+n", 1],
    ["ArrowUp", 0],
    ["ArrowUp", 0],
  ] as const) {
    await page.keyboard.press(key);
    await at(index);
  }
  // A bare letter is typing, and the input keeps it.
  await page.keyboard.press("n");
  await expect(page.getByRole("combobox", { name: "backlinks" })).toHaveValue("n");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Backlinks" })).toBeHidden();
  await openPanel(page, "gb", "backlinks");
  await expect(rows).toHaveCount(2);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Reading", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("reading habit");
});

test("a note nothing links to says so, and Tab keeps the focus in the panel", async ({ page }) => {
  await gardenBacklinks(page, []);
  await expect
    .poll(async () => [await backlinks(page).count(), await page.getByRole("status").textContent()])
    .toEqual([0, "nothing links here"]);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "backlinks" })).toBeFocused();
});

test("the backlinks group under the relation in front, typed by the target that resolves here, with the untyped lines last", async ({
  page,
}) => {
  await gardenBacklinks(page, [
    hit("Welcome.md", 3, "depends-on:: [[Garden]]"),
    hit("Welcome.md", 4, "see [[Garden]]"),
    hit("01 Notes/Reading.md", 7, "depends-on:: [[Garden]]"),
    hit("Long note.md", 2, "rel:: [[Garden|Beds]]"),
    hit("Long note.md", 3, "rel:: [[Garden#Spring]]"),
    hit("Long note.md", 4, "invented-thing:: [[Garden]]"),
    // Only the first target is the relation's, so this one is untyped here.
    hit("Long note.md", 5, "depends-on:: [[Home]] because [[Garden]]"),
  ]);
  const dialog = page.getByRole("dialog", { name: "Backlinks" });
  // One poll: each group's name with its rows' count, then the rows drawn after every group.
  await expect
    .poll(() =>
      dialog.evaluate((panel) => [
        [...panel.querySelectorAll('[role="group"]')].map(
          (group) =>
            `${group.getAttribute("aria-label")} ${group.querySelectorAll('[role="option"]').length}`,
        ),
        [...panel.querySelectorAll('[role="option"]')]
          .slice(-2)
          .map((row) => row.textContent ?? ""),
      ]),
    )
    .toEqual([
      ["depends-on 2", "rel 2", "invented-thing 1"],
      [expect.stringContaining("see [[Garden]]"), expect.stringContaining("because [[Garden]]")],
    ]);
});

test("Enter opens the backlink drawn first and ArrowDown walks to the one drawn second, not their rank", async ({
  page,
  stack,
}) => {
  // Ranked untyped first, drawn after the relation's group.
  await gardenBacklinks(page, async () => [
    hit("Welcome.md", await lineOf(stack.vault, "Welcome.md", "front door"), "see [[Garden]]"),
    hit(
      "01 Notes/Reading.md",
      await lineOf(stack.vault, "01 Notes/Reading.md", "habit"),
      "depends-on:: [[Garden]]",
    ),
  ]);
  await expect(backlinks(page)).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Reading", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("reading habit");
  await findNote(page, "Garden");
  await openPanel(page, "gb", "backlinks");
  await expect(backlinks(page)).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(backlinks(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("front door");
});

const preview = (page: Page) => page.getByTestId("preview");
/** The preview's line numbers, the note's own; the gutter's hidden spacer adds one, so callers take the smallest. */
const numbers = (page: Page) =>
  preview(page).evaluate((pane) =>
    [...pane.querySelectorAll(".cm-gutterElement")]
      .map((n) => Number(n.textContent))
      .filter((n) => n > 0),
  );

test("the preview shows the note around the highlighted backlink, numbered as the note is, its line marked, and reads the note once for two of its lines", async ({
  page,
  stack,
}) => {
  const long = "Long note.md";
  const far = await lineOf(stack.vault, long, "Line 120 of filler");
  const near = await lineOf(stack.vault, long, "A note long enough");
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/files/Long%20note.md")) reads += 1;
  });
  await gardenBacklinks(page, [
    hit(long, far, "far [[Garden]]"),
    hit(long, near, "near [[Garden]]"),
  ]);
  // One poll: the marked line, its neighbours and the window's first number.
  await expect
    .poll(async () => {
      const shown = await numbers(page);
      return [
        await preview(page).locator(".cm-searchHit").textContent(),
        await preview(page).textContent(),
        Math.min(...shown),
      ];
    })
    .toEqual([
      expect.stringContaining("Line 120 of filler"),
      expect.stringMatching(/Line 119 of filler[\s\S]*Line 121 of filler/),
      far - 30,
    ]);
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () => [
      await preview(page).locator(".cm-searchHit").textContent(),
      Math.min(...(await numbers(page))),
      reads,
    ])
    .toEqual([expect.stringContaining("A note long enough"), 1, 1]);
});

test("the preview draws the markdown rather than its syntax, still numbered and marked", async ({
  page,
  stack,
}) => {
  const reading = "01 Notes/Reading.md";
  const line = await lineOf(stack.vault, reading, "habit");
  await gardenBacklinks(page, [hit(reading, line, "see [[Garden]]")]);
  // One poll: the mark, the heading without its `#` and the hit's own number.
  await expect
    .poll(async () => [
      await preview(page).locator(".cm-searchHit").textContent(),
      /(^|\n|\s)# Reading/.test((await preview(page).innerText()) ?? ""),
      (await preview(page).textContent())?.includes("Reading"),
      (await numbers(page)).includes(line),
    ])
    .toEqual([expect.stringContaining("reading habit"), false, true, true]);
});

test("the preview says so when the note behind a backlink cannot be read", async ({ page }) => {
  await gardenBacklinks(page, [hit("Gone.md", 1, "see [[Garden]]")]);
  await expect(preview(page)).toContainText("could not read this note");
});

test("in a narrow window the backlinks read and draw no preview", async ({ page }) => {
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/files/Long%20note.md")) reads += 1;
  });
  await page.clock.install();
  await gardenBacklinks(page, [hit("Long note.md", 9, "see [[Garden]]")], true);
  await expect(backlinks(page)).toHaveCount(1);
  // Past the delay the pane waits before it reads.
  await page.clock.runFor(500);
  await expect.poll(async () => [await preview(page).count(), reads]).toEqual([0, 0]);
});
