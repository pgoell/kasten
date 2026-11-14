import type { Page } from "@playwright/test";
import { leader, openApp, vaultWith } from "../../harness/app.ts";
import { answer, hit } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const LINES = "one\ntwo\nthree\nfour";

/** Searches for `term` with `Space f g` and opens the first line the search lists. */
async function openHit(page: Page, term: string): Promise<void> {
  await leader(page, "fg");
  const input = page.getByRole("combobox", { name: "search notes" });
  await expect(input).toBeFocused();
  await input.fill(term);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Lines", selected: true })).toBeVisible();
}

test.describe("a search hit", () => {
  test.beforeEach(async ({ page, stack }) => {
    await vaultWith(stack.vault, { "Lines.md": LINES });
    // The search answers each word with its line of Lines.md, and `gone` with a line past its end.
    await answer(page, (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      const line = { two: 2, three: 3, four: 4, gone: 99 }[q];
      return line ? [hit("Lines.md", line, q)] : [];
    });
    await openApp(page);
  });

  test("opens the note with the cursor on its line, and a second hit on the open note moves it there", async ({
    page,
  }) => {
    await openHit(page, "three");
    await expect(page.locator(".cm-activeLine")).toHaveText("three");
    await page.keyboard.press("Escape");
    await openHit(page, "two");
    await expect(page.locator(".cm-activeLine")).toHaveText("two");
  });

  test("past the note's end opens it with the cursor on its last line", async ({ page }) => {
    await openHit(page, "gone");
    await expect(page.locator(".cm-activeLine")).toHaveText("four");
  });
});
/**
 * Opens the note by its address, vim on or off, and names the line the cursor starts on: its place
 * among the lines drawn and its text. A frontmatter draws as one line, the first.
 */
async function startLine(page: Page, vault: string, body: string, vim = true) {
  await vaultWith(vault, { "Start.md": body });
  if (!vim) await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await page.goto(`/?note=${encodeURIComponent("Start.md")}`);
  await expect(page.locator(".cm-content")).toBeFocused({ timeout: 15_000 });
  await expect(page.locator(".cm-activeLine")).toHaveCount(1);
  return page.locator(".cm-content").evaluate((content) => {
    const lines = [...content.querySelectorAll(".cm-line")];
    const at = lines.findIndex((line) => line.classList.contains("cm-activeLine"));
    return { at, text: lines[at]?.textContent };
  });
}

test.describe("a note opened with no line", () => {
  test("starts at the top", async ({ page, stack }) => {
    expect(await startLine(page, stack.vault, LINES)).toEqual({ at: 0, text: "one" });
  });

  const BELOW = [
    ["a frontmatter", "---\nid: 1\n---\nNotes"],
    ["one whose opening fence has a trailing space", "--- \nid: x\n---\nbody"],
    ["one whose closing fence has a trailing space and tab", "---\nid: x\n--- \t\nbody"],
    ["one with CRLF line ends", "---\r\nid: x\r\n---\r\nbody"],
  ];
  for (const [shape, body] of BELOW) {
    test(`starts below ${shape}`, async ({ page, stack }) => {
      const first = body.split(/\r?\n/).at(-1);
      expect(await startLine(page, stack.vault, body)).toEqual({ at: 1, text: first });
    });
  }

  test("starts below a frontmatter whose opening fence has a trailing space, with vim off", async ({
    page,
    stack,
  }) => {
    expect(await startLine(page, stack.vault, "--- \nid: x\n---\nbody", false)).toEqual({
      at: 1,
      text: "body",
    });
  });

  const TOP = [
    ["the opening fence has a space in front", " ---\nid: x\n---\nbody"],
    ["the frontmatter never closes", "---\nid: x\nbody"],
  ];
  for (const [shape, body] of TOP) {
    test(`starts at the top when ${shape}`, async ({ page, stack }) => {
      expect((await startLine(page, stack.vault, body)).at).toBe(0);
    });
  }
});
