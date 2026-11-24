import type { Page } from "@playwright/test";
import { onPhone, openApp, openFromTree, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

// Thirty sections, so a screen of headings lies past what a slowed first parse reaches.
const NOTE = `---\ntype: Concept\n---\n\n# Thirty parts\n\nSome words.\n\n${Array.from(
  { length: 30 },
  (_, i) =>
    `## Part ${i + 1}\n\nA paragraph of words that the parser has to walk through, line by line.\n`,
).join("\n")}`;

/** Keeps each line the page ever drew with a raw heading mark off the cursor's line. Call before the page loads. */
async function recordRawHeadings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raw: string[] = [];
    Object.assign(window, { raw });
    new MutationObserver(() => {
      for (const line of document.querySelectorAll(".cm-line:not(.cm-activeLine):not(.cm-flat)")) {
        const text = line.textContent ?? "";
        if (/^#{1,6} /.test(text) && !raw.includes(text)) raw.push(text);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

/** Opens Thirty parts.md with the CPU slowed 20 times, the way a loaded phone parses (#1984): by the tree, or by the finder's tap on a phone. */
async function openSlowed(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, { "Thirty parts.md": NOTE });
  await recordRawHeadings(page);
  const cdp = await page.context().newCDPSession(page);
  const slow = () => cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  if (onPhone(page)) {
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Find a note" }).tap();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("Thirty parts");
    await expect(finder.getByRole("option").first()).toContainText("Thirty parts");
    await slow();
    await finder.getByRole("option").first().tap();
  } else {
    await openApp(page);
    await slow();
    await openFromTree(page, "Thirty parts");
  }
  await expect(page.locator(".cm-line.cm-heading-2").first()).toHaveText("Part 1");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
}

const rawHeadings = (page: Page) =>
  page.evaluate(() => (window as unknown as { raw: string[] }).raw);

test("a note opened on a slowed desktop draws no heading with its raw #", async ({
  page,
  stack,
}) => {
  await openSlowed(page, stack.vault);
  expect(await rawHeadings(page)).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a note opened on a slowed phone draws no heading with its raw #", async ({
    page,
    stack,
  }) => {
    await openSlowed(page, stack.vault);
    expect(await rawHeadings(page)).toEqual([]);
  });
});
