import { leader, noteText, openApp, openNote, unstamped, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** A note whose `---` on line 1 nothing closes. */
const UNCLOSED = "---\nref: x #abc\n\n#real";
/** The built KaTeX chunk, which the first formula on a page asks for. */
const KATEX = /\/assets\/katex-[^/]*\.js$/;

for (const vim of ["on", "off"]) {
  test(`the tags under a --- nothing closes draw as tags, vim ${vim}`, async ({ page, stack }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await vaultWith(stack.vault, { "Open.md": UNCLOSED });
    await openApp(page);
    await openNote(page, "Open");
    await expect(page.locator(".cm-tag", { hasText: "#real" })).toBeVisible();
    await expect(page.locator(".cm-tag", { hasText: "#abc" })).toBeVisible();
  });
}

test("typing the closing --- makes a frontmatter, and deleting it unmakes one", async ({
  page,
  stack,
}) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await vaultWith(stack.vault, { "Open.md": UNCLOSED });
  await openApp(page);
  await openNote(page, "Open");
  const ref = page.locator(".cm-line", { hasText: "ref: x" });
  const abc = page.locator(".cm-tag", { hasText: "#abc" });
  await expect(abc).toBeVisible();

  // Onto the blank third line, which the closing fence takes.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("---");
  await expect(abc).toHaveCount(0);
  await expect(page.locator(".cm-tag", { hasText: "#real" })).toBeVisible();
  // Read hides a frontmatter while the cursor is below it.
  await page.keyboard.press("Control+End");
  await expect(ref).toHaveCount(0);
  await expect.poll(async () => unstamped(await noteText(stack.vault, "Open.md"))).toMatch(
    /^---\n(type: Note\n)?ref: x #abc\n---\n#real$/,
  );

  // Onto the closing fence, the line above `#real` whatever the save stamped above it.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press("Control+End");
  await expect(ref).toBeVisible();
  await expect(abc).toBeVisible();
  await expect.poll(() => noteText(stack.vault, "Open.md")).toMatch(/[^-]\n\n#real$/);
});

test("a failed KaTeX load leaves the formula as typed, and the next formula loads it and draws", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "First.md": "intro\n\narea $x$\n", "Second.md": "intro\n\narea $y$\n" });
  // An unhandled rejection in the page reaches Playwright as a pageerror.
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const fetches: string[] = [];
  page.on("request", (request) => {
    if (KATEX.test(request.url())) fetches.push(request.url());
  });
  await page.route(KATEX, (route) => route.abort("internetdisconnected"));
  await openApp(page);
  const failed = page.waitForEvent("requestfailed", (request) => KATEX.test(request.url()));
  await openNote(page, "First");
  await failed;
  // Marks this page, so a reload between the two formulas would show.
  await page.evaluate(() => Object.assign(window, { unreloaded: true }));
  await expect(page.locator(".cm-math", { hasText: "x" })).toBeVisible();
  await expect(page.locator(".katex")).toHaveCount(0);

  await page.unroute(KATEX);
  await openNote(page, "Second");
  await expect(page.locator(".cm-math .katex-mathml annotation")).toHaveText("y", {
    timeout: 15_000,
  });
  expect(fetches).toHaveLength(2);
  expect(await page.evaluate(() => "unreloaded" in window)).toBe(true);
  expect(errors).toEqual([]);
});

for (const vim of ["on", "off"]) {
  test(`live preview shows the escapes the import writes as the import meant them, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await vaultWith(stack.vault, { "Escapes.md": "intro\n\n`&#58;`\n\na\\\\-b\n" });
    await openApp(page);
    await openNote(page, "Escapes");
    // The cursor sits on `intro`, so live preview draws both lines.
    const lines = page.locator(".cm-line");
    await expect(lines.nth(2)).toHaveText("&#58;");
    await expect(lines.nth(4)).toHaveText("a\\-b");
  });
}

test("review draws the escapes in a card's side and a cloze's answer as the import meant them", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "03 Flashcards/Capitals.md": "#flashcards/capitals\n\na\\\\-b::back\n\nMark::==a\\\\::b==\n",
  });
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  const question = page.getByTestId("review-question");
  const back = page.getByTestId("review-back");
  await expect(question).toHaveText("a\\-b");
  await page.keyboard.press("Enter");
  await expect(back).toHaveText("back");
  await page.keyboard.press("3");
  await expect(question).toHaveText("Mark");
  await page.keyboard.press("Enter");
  await expect(back).toHaveText("a\\::b");
});
