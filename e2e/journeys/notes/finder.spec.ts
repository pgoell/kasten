import { findNote, leader, openApp, phone } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("the finder opens the note it finds", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Garden");
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});

test("a query the finder reads into nothing says so, and Enter opens nothing", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("zzz");
  await expect(finder.getByRole("status")).toHaveText("no notes match");
  await expect(finder.getByRole("option")).toHaveCount(0);
  // An empty list is where Tab would leave the panel and never come back.
  await page.keyboard.press("Tab");
  await expect(finder.getByRole("combobox")).toBeFocused();
  const tabs = await page.getByRole("tab").count();
  await page.keyboard.press("Enter");
  await expect(finder).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test("the finder's keys walk the list, and Enter opens the row the highlight is on", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  const input = finder.getByRole("combobox");
  const options = finder.getByRole("option");
  const selected = finder.getByRole("option", { selected: true });
  await expect(options.nth(2)).toBeVisible();
  // Read, not assumed: the walk holds whatever order the vault ranks in.
  const names = await options.allTextContents();
  const walk: [string, number][] = [
    ["ArrowDown", 1],
    ["Control+n", 2],
    ["ArrowUp", 1],
    ["Control+p", 0],
    ["Control+j", 1],
    ["Control+k", 0],
    ["Control+k", 0],
    ["Tab", 1],
    ["Tab", 2],
    ["Shift+Tab", 1],
  ];
  for (const [key, row] of walk) {
    await page.keyboard.press(key);
    await expect(selected, key).toHaveText(names[row]);
  }
  await expect(input).toBeFocused();

  await page.keyboard.type("o");
  await expect(options.nth(1)).toBeVisible();
  await expect(selected).toHaveText((await options.first().textContent()) ?? "");
  await input.fill("");
  await expect(selected).toHaveText(names[0]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const name = names[1].replace(/^.*\//, "").replace(/\.md$/, "");
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
});

test("the finder's Enter opens the row it ranks first, not the text typed", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  // `grdn` names no note; `02 Projects/Garden.md` reads into it.
  await page.keyboard.type("grdn");
  await expect(page.getByRole("option", { selected: true })).toHaveText("02 Projects/Garden.md");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
});

test("Escape closes the finder and opens nothing", async ({ page }) => {
  await openApp(page);
  const tabs = await page.getByRole("tab").count();
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(finder).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test("a content search opens the note on the line it matches", async ({ page }) => {
  await openApp(page);
  await leader(page, "fg");
  await page.keyboard.type("far away letter");
  await expect(page.getByRole("option", { name: /far away letter/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  const line = page.locator(".cm-line", {
    hasText: "reply to the far away letter",
  });
  await expect(line).toBeInViewport();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

test.describe("on a phone", () => {
  test.use(phone);

  test("the finder opened from the thumb row opens the note it finds", async ({ page }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("Garden");
    await finder
      .getByRole("option", { name: /Garden/ })
      .first()
      .tap();
    await expect(finder).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
  });

  test("the finder gives its list the screen's width and each row a thumb's height", async ({
    page,
  }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const list = page.getByRole("dialog", { name: "Find note" }).getByRole("listbox");
    await expect(list.getByRole("option").first()).toBeVisible();
    const [listWidth, panelWidth] = await list.evaluate((el) => [
      el.getBoundingClientRect().width,
      el.parentElement?.getBoundingClientRect().width ?? 0,
    ]);
    expect(listWidth).toBeCloseTo(panelWidth, 0);
    // The rule, not the box: a row's padding alone may already reach 44 px.
    const minHeight = await list
      .getByRole("option")
      .first()
      .evaluate((el) => getComputedStyle(el).minHeight);
    expect(minHeight).toBe("44px");
  });
});
