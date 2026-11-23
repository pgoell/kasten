import { noteText, openApp, openNote, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

// A vim motion onto the bar of a link drawn as its alias stops there, and `i` writes into the name, as in Obsidian (#1973).
for (const motion of [
  ["0", "f", "|"],
  ["$", "F", "|"],
]) {
  test(`G ${motion.join(" ")} i writes before the bar of a link drawn as its alias`, async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "Links.md": "intro\n\n[[bor|Jo]]" });
    await openApp(page);
    await openNote(page, "Links");
    const line = page.locator(".cm-line").last();
    await expect(line).toHaveText("Jo");
    for (const key of ["G", ...motion]) await page.keyboard.press(key);
    await expect(line).toHaveText("[[bor|Jo]]");
    await page.keyboard.press("i");
    await page.keyboard.type("g");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => noteText(stack.vault, "Links.md"), { timeout: 15_000 })
      .toContain("\n[[borg|Jo]]");
    await expect(line).toHaveText("[[borg|Jo]]");
  });
}

// `F(` reaches a markdown link's hidden address, and `i` writes before it, as in Obsidian (#2306).
test("G $ F ( i writes before the ( of a markdown link drawn as its text", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "Links.md": "intro\n\n[text](https://example.com)" });
  await openApp(page);
  await openNote(page, "Links");
  const line = page.locator(".cm-line").last();
  await expect(line).toHaveText("text");
  for (const key of ["G", "$", "F", "("]) await page.keyboard.press(key);
  await expect(line).toHaveText("[text](https://example.com)");
  await page.keyboard.press("i");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => noteText(stack.vault, "Links.md"), { timeout: 15_000 })
    .toContain("\n[text]x(https://example.com)");
});
