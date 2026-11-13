import type { Page } from "@playwright/test";
import { leader, noteText, openApp, openNote, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** Counts the browser's fetches of the built mermaid bundle; call before the page loads. */
function mermaidLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on("request", (request) => {
    if (/\/mermaid\.core-[^/]*\.js$/.test(request.url())) loads.push(request.url());
  });
  return loads;
}

test("a note without a diagram never loads mermaid, and one with a Mermaid fence loads and draws it", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "Code.md": "before\n\n```js\nconst x = 1;\n```\n\nafter `code` here\n",
    "Diagram.md": "before\n\n```Mermaid\nflowchart TD\n  Seed --> Sprout\n```\n",
  });
  const loads = mermaidLoads(page);
  await openApp(page);
  await openNote(page, "Code");
  // The note drawn, its other fence and all, which is when a load would start.
  await expect(page.locator(".cm-code-block").first()).toBeVisible();
  expect(loads).toEqual([]);

  await openNote(page, "Diagram");
  const diagram = page.locator(".cm-mermaid-block svg");
  await expect(diagram).toBeVisible({ timeout: 15_000 });
  await expect(diagram).toContainText("Seed");
  await expect(diagram).toContainText("Sprout");
  expect(loads).toHaveLength(1);
});

/** Keeps every promise rejection the page leaves unhandled; call before the page loads. */
async function unhandled(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const kept: string[] = [];
    Object.assign(window, { unhandled: kept });
    window.addEventListener("unhandledrejection", (event) => kept.push(String(event.reason)));
  });
  return () => page.evaluate(() => (window as unknown as { unhandled: string[] }).unhandled);
}

test("a failed mermaid load shows its error beside the source, and the next diagrams load again and draw with no reload (#647)", async ({
  page,
  stack,
}) => {
  const first = "graph LR\n  Root --> Leaf";
  await vaultWith(stack.vault, {
    "Offline.md": `before\n\n\`\`\`mermaid\n${first}\n\`\`\`\n`,
    "Online.md": `before\n\n\`\`\`mermaid\n${first}\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  Stem --> Bud\n\`\`\`\n`,
  });
  const loads = mermaidLoads(page);
  const rejections = await unhandled(page);
  // The chunk's first fetch fails, as it does while offline; every later one goes through.
  let aborted = 0;
  await page.route(/\/mermaid\.core-[^/]*\.js$/, (route) => {
    if (aborted++ === 0) return route.abort("internetdisconnected");
    return route.fallback();
  });
  await openApp(page);
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));

  await openNote(page, "Offline");
  const block = page.locator(".cm-mermaid-block");
  await expect(block.locator(".cm-mermaid-error")).toHaveText(/./, { timeout: 15_000 });
  await expect(block.locator(".cm-mermaid-source")).toHaveText(first);
  await expect(block.locator("svg")).toHaveCount(0);
  expect(await rejections()).toEqual([]);

  await openNote(page, "Online");
  const diagrams = page.locator(".cm-mermaid-block svg");
  await expect(diagrams).toHaveCount(2, { timeout: 15_000 });
  await expect(diagrams.nth(0)).toContainText("Leaf");
  await expect(diagrams.nth(1)).toContainText("Bud");
  await expect(page.locator(".cm-mermaid-error")).toHaveCount(0);
  expect(loads).toHaveLength(2);
  expect(await page.evaluate(() => "sameDocument" in window)).toBe(true);
  expect(await rejections()).toEqual([]);
});

test("a diagram with a syntax error shows its error beside the source, and shows it again with no new load", async ({
  page,
  stack,
}) => {
  const bad = "graph LR\n  bad -->";
  const note = `before\n\n\`\`\`mermaid\n${bad}\n\`\`\`\n`;
  await vaultWith(stack.vault, { "Bad.md": note, "Again.md": note, "Plain.md": "plain\n" });
  const loads = mermaidLoads(page);
  await openApp(page);

  await openNote(page, "Bad");
  const block = page.locator(".cm-mermaid-block");
  await expect(block.locator(".cm-mermaid-error")).toContainText("Parse error", {
    timeout: 15_000,
  });
  await expect(block.locator(".cm-mermaid-source")).toHaveText(bad);
  expect(loads).toHaveLength(1);

  await openNote(page, "Again");
  await expect(block.locator(".cm-mermaid-error")).toContainText("Parse error");
  await expect(block.locator(".cm-mermaid-source")).toHaveText(bad);
  await expect(block.locator("svg")).toHaveCount(0);
  expect(loads).toHaveLength(1);
});

const NESTED = "{{c1::a {{c2::b::h2}}::h1}}";

test.describe("a nested cloze", () => {
  test.beforeEach(async ({ stack }) => {
    await vaultWith(stack.vault, { "Cloze.md": `intro\n\n${NESTED}` });
  });

  test("shows as typed and stays whole when typed at its end with vim on", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    await openNote(page, "Cloze");
    const line = page.locator(".cm-line", { hasText: "{{c1::" });
    // The cursor sits on `intro`, so live preview draws the line as it would any other.
    await expect(line).toHaveText(NESTED);
    for (const key of ["G", "A", "!", "Escape", "g", "g"]) await page.keyboard.press(key);
    await expect(line).toHaveText(`${NESTED}!`);
    await expect
      .poll(() => noteText(stack.vault, "Cloze.md"), { timeout: 15_000 })
      .toContain(`\n${NESTED}!`);
  });

  test("stays whole when typed at its end with vim off", async ({ page, stack }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openApp(page);
    await openNote(page, "Cloze");
    const line = page.locator(".cm-line", { hasText: "{{c1::" });
    await expect(line).toHaveText(NESTED);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Control+Home");
    await expect(line).toHaveText(`${NESTED}!`);
    await expect
      .poll(() => noteText(stack.vault, "Cloze.md"), { timeout: 15_000 })
      .toContain(`\n${NESTED}!`);
  });
});

for (const preview of ["on", "off"]) {
  test(`in vim mode, completing a link's name before its alias keeps the alias, live preview ${preview}`, async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "Links.md": "intro\n\n[[bor|Jo]]",
      "reading/borges.md": "# Borges\n",
    });
    await openApp(page);
    await openNote(page, "Links");
    if (preview === "off") await leader(page, "p");
    // With the cursor on `intro`, preview shows the alias alone and preview off the source.
    const line = page.locator(".cm-line").last();
    await expect(line).toHaveText(preview === "on" ? "Jo" : "[[bor|Jo]]");
    // Into insert mode at the line's end, where preview shows the link's source, then back past
    // `]]`, `Jo` and `|` into the name, where a letter opens the list. A vim motion straight to the
    // `|` lands while the name is still hidden, and the caret steps out past it.
    const keys = ["G", "A", ...Array(5).fill("ArrowLeft"), "g"];
    for (const key of keys) await page.keyboard.press(key);
    const option = page.locator(".cm-tooltip-autocomplete [aria-selected='true']");
    await expect(option).toContainText("reading/borges");
    // CodeMirror refuses an accept for 75 ms after the list opens, and a refused Enter types a newline.
    await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => noteText(stack.vault, "Links.md"), { timeout: 15_000 })
      .toContain("\n[[reading/borges|Jo]]");
    expect(await noteText(stack.vault, "Links.md")).not.toContain("]]]]");
  });
}
