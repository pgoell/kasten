import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { noteText, openApp, openFromTree, phone } from "../../harness/app.ts";
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
