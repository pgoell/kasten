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

test.describe("a space in an image address (#553)", () => {
  const SHOT = "![shot](99 Misc/shot.png)";
  const DRAWN = "/api/assets/99%20Misc/shot.png";
  /** A 1 px png, so a drawn picture loads with a size above zero. */
  const DOT = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  /** Each picture live preview draws in the note, as its address and alt text, once it has loaded. */
  async function pictures(page: Page): Promise<[string | null, string | null][]> {
    const drawn = page.locator(".cm-content img.cm-image");
    for (const img of await drawn.all())
      await expect
        .poll(() => img.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth))
        .toBeGreaterThan(0);
    return drawn.evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute("src"), node.getAttribute("alt")]),
    );
  }

  async function opened(page: Page, vault: string, body: string, vim: boolean): Promise<void> {
    await vaultWith(vault, {
      "99 Misc/shot.png": DOT,
      "x y.png": DOT,
      "other.png": DOT,
      "Shot.md": `intro\n\n${body}`,
    });
    if (!vim) await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    // The https picture's host answers here, so no request leaves the box.
    await page.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "image/png", body: DOT }),
    );
    await openApp(page);
    await openNote(page, "Shot");
  }

  for (const vim of [true, false]) {
    const mode = vim ? "vim on" : "vim off";

    test(`draws the vault picture off its line and shows the address as typed on it, ${mode}`, async ({
      page,
      stack,
    }) => {
      await opened(page, stack.vault, SHOT, vim);
      const line = page.locator(".cm-content .cm-line").nth(2);
      await expect.poll(() => pictures(page)).toEqual([[DRAWN, "shot"]]);
      await expect(line).toHaveText("");
      await page.keyboard.press(vim ? "G" : "Control+End");
      if (vim) await page.keyboard.press("i");
      await expect(line).toHaveText(SHOT);
      if (vim) await page.keyboard.press("Escape");
      await page.keyboard.press(vim ? "g" : "Control+Home");
      if (vim) await page.keyboard.press("g");
      await expect.poll(() => pictures(page)).toEqual([[DRAWN, "shot"]]);
      await expect(line).toHaveText("");
    });
  }

  test("draws a spaced image address in a table cell as the picture", async ({ page, stack }) => {
    await opened(page, stack.vault, `| a |\n| - |\n| ${SHOT} |`, false);
    const cell = page.locator(".cm-table-grid tbody td");
    await expect(cell.locator("img.cm-image")).toHaveAttribute("src", DRAWN);
    await expect(cell).toHaveText("");
    await expect.poll(() => pictures(page)).toEqual([[DRAWN, "shot"]]);
  });

  test("keeps a spaced script address as typed and draws a spaced https one", async ({
    page,
    stack,
  }) => {
    await opened(
      page,
      stack.vault,
      "![a](javascript:x y)\n\n![b](https://example.com/a b.png)",
      false,
    );
    await expect(page.locator(".cm-content .cm-line").nth(2)).toHaveText("![a](javascript:x y)");
    await expect.poll(() => pictures(page)).toEqual([["https://example.com/a%20b.png", "b"]]);
  });

  test("draws the spaced address in the parens over a definition of the alt text", async ({
    page,
    stack,
  }) => {
    await opened(page, stack.vault, "![a](x y.png)\n\n[a]: other.png", false);
    await expect.poll(() => pictures(page)).toEqual([["/api/assets/x%20y.png", "a"]]);
  });
});
