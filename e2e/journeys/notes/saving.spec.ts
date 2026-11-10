import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { findNote, noteText, openApp, openFromTree, phone } from "../../harness/app.ts";
import { type Hit, hit, lineOf, openPanel } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const TYPED = "A line typed by the e2e test.";

test("an edit reaches the file on disk", async ({ page, stack }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("front door");
  await editor.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go");
  await page.keyboard.type(TYPED);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => readFile(join(stack.vault, "Welcome.md"), "utf8"), { timeout: 15_000 })
    .toContain(TYPED);
});

test("an edit with vim off reaches the file on disk", async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${TYPED}`);
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .toContain(TYPED);
});

/** The note below its frontmatter, which each save restamps. */
const body = (text: string) =>
  text.startsWith("---\n") ? text.slice(text.indexOf("\n---\n") + 5) : text;

test("u after an edit puts the old text back on disk", async ({ page, stack }) => {
  const before = await noteText(stack.vault, "Welcome.md");
  await openApp(page);
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go");
  await page.keyboard.type(TYPED);
  await page.keyboard.press("Escape");
  // The edit must be on disk first, or a poll for the old text passes before any save.
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .toContain(TYPED);
  await page.keyboard.press("u");
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .not.toContain(TYPED);
  // Byte for byte, so the blank line `o` opened goes too (#1662).
  expect(body(await noteText(stack.vault, "Welcome.md"))).toBe(body(before));
});

test.describe("on a phone", () => {
  test.use(phone);

  test("an edit typed by touch reaches the file on disk", async ({ page, stack }) => {
    // A phone opens on the Today page, so the note comes from the finder.
    await page.goto("/");
    await page.getByRole("button", { name: /^Search \d+ notes$/ }).tap({ timeout: 15_000 });
    await page.getByRole("combobox").fill("Welcome");
    await page
      .getByRole("option", { name: /Welcome/ })
      .first()
      .tap();
    const editor = page.locator(".cm-content", { hasText: "front door" });
    await expect(editor).toBeVisible();
    await editor.tap();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n${TYPED}`);
    await expect
      .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
      .toContain(TYPED);
  });
});

// The e2e vault's Seeds note names the Garden note twice in plain text, once in each case.
const SEEDS = "01 Notes/Seeds.md";
const BEDS = "Order seeds for the Garden beds in March.";
const FENCE = "A kitchen garden needs a fence against rabbits.";

/** Opens the Garden note's backlinks, its links answered by `links` where given; returns the mentions asks. */
async function gardenMentions(page: Page, links?: Hit[]): Promise<URL[]> {
  const asked: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/mentions?")) asked.push(new URL(request.url()));
  });
  if (links !== undefined) {
    await page.route("**/api/search?**", (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      // The recent notes ask the search too, by their `modified:` date.
      if (q.startsWith("modified:")) return route.fallback();
      return route.fulfill({ json: q === "Garden" ? links : [] });
    });
  }
  await openApp(page);
  await findNote(page, "Garden");
  await openPanel(page, "gb", "backlinks");
  return asked;
}

const panel = (page: Page) => page.getByRole("dialog", { name: "Backlinks" });
const rows = (page: Page) => panel(page).getByRole("option");
const mentions = (page: Page) =>
  panel(page).getByRole("group", { name: "unlinked mentions" }).getByRole("option");
const texts = (list: Locator) => list.allTextContents();

/** The Seeds note's two mentions as their rows read, path, line and words. */
async function mentionRows(vault: string): Promise<string[]> {
  return [
    `${SEEDS}:${await lineOf(vault, SEEDS, BEDS)}${BEDS}`,
    `${SEEDS}:${await lineOf(vault, SEEDS, FENCE)}${FENCE}`,
  ];
}

test.describe("unlinked mentions", () => {
  test("a note's mentions come in a group of their own after its links, asked for by its path with the archive out", async ({
    page,
    stack,
  }) => {
    const asked = await gardenMentions(page);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [await texts(rows(page)), await texts(mentions(page))])
      .toEqual([[expect.stringContaining("[[Garden]]"), ...both], both]);
    expect(asked.map((url) => [...url.searchParams])).toEqual([
      [
        ["path", "02 Projects/Garden.md"],
        ["archive", "false"],
      ],
    ]);
  });

  test("the mentions still show under a note with more links than the list holds", async ({
    page,
    stack,
  }) => {
    const links = Array.from({ length: 25 }, (_, i) =>
      hit("Long note.md", i + 1, `[[Garden]] ${i}`),
    );
    await gardenMentions(page, links);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [await rows(page).count(), await texts(mentions(page))])
      .toEqual([22, both]);
  });

  test("a note with only mentions still says nothing links here", async ({ page, stack }) => {
    await gardenMentions(page, []);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [
        await texts(rows(page)),
        await panel(page).getByRole("status").textContent(),
      ])
      .toEqual([both, "nothing links here"]);
  });

  test("typing narrows the mentions, and Enter opens one on its line without linking it", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, SEEDS);
    await gardenMentions(page);
    await expect(mentions(page)).toHaveCount(2);
    await page.keyboard.type("fence");
    const [, fence] = await mentionRows(stack.vault);
    await expect.poll(() => texts(rows(page))).toEqual([fence]);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Seeds", selected: true })).toBeVisible();
    await expect(page.locator(".cm-activeLine")).toHaveText(FENCE);
    expect(await noteText(stack.vault, SEEDS)).toBe(before);
  });

  test("Ctrl+Enter and Cmd+Enter link the highlighted mention on disk and open nothing", async ({
    page,
    stack,
  }) => {
    await gardenMentions(page);
    const [beds] = await mentionRows(stack.vault);
    await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press("Tab");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows(page).nth(1)).toHaveText(beds ?? "");
    await page.keyboard.press("Control+Enter");
    await expect
      .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
      .toContain("Order seeds for the [[Garden]] beds in March.");

    // The list reloads once a link lands, so the second mention is narrowed to rather than walked to.
    await page.keyboard.type("fence");
    await expect.poll(() => texts(rows(page))).toEqual([expect.stringContaining(FENCE)]);
    await page.keyboard.press("Meta+Enter");
    await expect
      .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
      .toContain("A kitchen [[Garden|garden]] needs a fence against rabbits.");
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  });

  test("a refused link says why and keeps its row, three presses send one write, and the reason goes once the query changes", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, SEEDS);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    await page.route("**/api/files/**", async (route) => {
      const request = route.request();
      if (request.method() !== "PUT" || !request.url().includes("Seeds.md"))
        return route.fallback();
      writes.push(request.url());
      await held;
      await route.fulfill({ status: 500, json: { detail: "refused by the test" } });
    });
    await gardenMentions(page, []);
    const status = panel(page).getByRole("status");
    await expect(mentions(page)).toHaveCount(2);

    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Control+Enter");
    await panel(page).getByRole("button", { name: "link" }).first().click();
    await expect.poll(() => writes.length).toBe(1);
    release();
    await expect
      .poll(async () => [await status.textContent(), await mentions(page).count(), writes.length])
      .toEqual(["The link was not written", 2, 1]);
    expect(await noteText(stack.vault, SEEDS)).toBe(before);

    await page.keyboard.type("fence");
    await expect
      .poll(async () => [await status.textContent(), await rows(page).count()])
      .toEqual(["nothing links here", 1]);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on a mention's link button links it on disk, keeps the focus in the input and opens nothing", async ({
      page,
      stack,
    }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /^Search \d+ notes$/ }).tap({ timeout: 15_000 });
      await page.getByRole("combobox").fill("Garden");
      await page
        .getByRole("option", { name: /Garden/ })
        .first()
        .tap();
      const editor = page.locator(".cm-content", { hasText: "water the tomatoes" });
      await expect(editor).toBeVisible();
      await page
        .getByRole("toolbar", { name: "Commands" })
        .getByRole("button", { name: "Run a command by name" })
        .tap();
      await page.getByRole("option", { name: /^Show what links here/ }).tap();
      const input = page.getByRole("combobox", { name: "backlinks" });
      await expect(input).toBeFocused();
      await expect(mentions(page)).toHaveCount(2);

      const button = panel(page).getByRole("button", { name: "link" }).first();
      // A thumb's height, as the rows of the finder are on a phone.
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await button.tap();
      await expect
        .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
        .toContain("Order seeds for the [[Garden]] beds in March.");
      await expect(input).toBeFocused();
      await expect(panel(page).getByTestId("preview")).toHaveCount(0);
      await expect(editor).toBeVisible();
    });
  });
});
