import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  phone,
  TODO_ROW,
  tapHeight,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("dragging a card to the doing column writes its doing mark", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  // The list first, so `c` turns a loaded list into the board.
  await expect(page.locator('[data-row*=".md:"]', { hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  const card = page.locator("[data-card]", { hasText: "fold the laundry" });
  await expect(card).toBeVisible();
  // The doing cell in the card's own lane, so the drop stays within one project.
  const lane = await card.evaluate((el) => el.closest("[data-column]")?.getAttribute("data-lane"));
  const doing = page.locator(`[data-column="doing"][data-lane="${lane}"]`);
  const from = await card.boundingBox();
  const to = await doing.boundingBox();
  if (!from || !to) throw new Error("the card or the doing cell is not on the screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => noteText(stack.vault, "02 Projects/Home.md"), { timeout: 15_000 })
    .toMatch(/^- \[\/\] fold the laundry/m);
});

test("c flips the todo pane from the list to the board and back", async ({ page }) => {
  await openApp(page);
  await leader(page, "gt");
  const rows = page.locator(TODO_ROW);
  const cards = page.locator("[data-card]");
  await expect(rows.filter({ hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(cards.filter({ hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(cards).toHaveCount(0);
  await expect(rows.filter({ hasText: "fold the laundry" })).toBeVisible();
});

/** Every note in the vault by its path, to see that nothing on disk moved. */
async function notes(vault: string): Promise<Record<string, string>> {
  const all: Record<string, string> = {};
  for (const path of await readdir(vault, { recursive: true }))
    if (path.endsWith(".md")) all[path] = await readFile(join(vault, path), "utf8");
  return all;
}

test("folding, the filter, a tag chip, All, the shared lists toggle and c write nothing", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "02 Projects/Errands.md": `# Errands\n\n- [ ] call the dentist #client\n- [x] read the spec ✅ ${today()}\n`,
    "05 Shared/Einkauf.md": "# Einkauf\n\n- [ ] buy eggs\n",
  });
  await openApp(page);
  await leader(page, "gt");
  const row = (text: string) => page.locator(TODO_ROW, { hasText: text });
  await expect(row("call the dentist")).toBeVisible();
  const before = await notes(stack.vault);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/"))
      writes.push(`${request.method()} ${request.url()}`);
  });

  await page.keyboard.press("c");
  await expect(page.locator("[data-card]").first()).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator("[data-card]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Done this week/ }).click();
  await expect(row("read the spec")).toBeVisible();
  await page.getByLabel("filter todos").fill("buy");
  await expect(row("fold the laundry")).toHaveCount(0);
  await expect(row("buy seed potatoes")).toBeVisible();
  await page.getByRole("button", { name: "#client", exact: true }).click();
  await expect(row("buy seed potatoes")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(row("buy seed potatoes")).toBeVisible();
  await expect(row("buy eggs")).toHaveCount(0);
  await page.getByRole("button", { name: /^Shared lists, 1 hidden/ }).click();
  await expect(row("buy eggs")).toBeVisible();

  // One real tick last: once its line and its done log land, a write the controls sent would have too.
  await cursorTo(page, "buy seed potatoes");
  await page.keyboard.press("X");
  const garden = "02 Projects/Garden.md";
  const daily = `01 Periodic/00 Daily/${today()}.md`;
  await expect
    .poll(() => noteText(stack.vault, garden), { timeout: 15_000 })
    .toMatch(/^- \[x\] buy seed potatoes/m);
  await expect.poll(() => noteText(stack.vault, daily)).toContain("buy seed potatoes");
  expect(
    writes.map((write) => decodeURIComponent(write.replace(/ http[^ ]*\/api\//, " "))),
  ).toEqual([`PUT files/${garden}`, `POST files/${daily}`]);
  // The tick's own: its line, and the daily note it logs to with the folder listings made for it.
  const untouched = (all: Record<string, string>) =>
    Object.entries(all).filter(([path]) => path !== garden && !path.startsWith("01 Periodic/"));
  expect(untouched(await notes(stack.vault))).toEqual(untouched(before));
});

test.describe("on a phone", () => {
  test.use(phone);

  test("every tap target of the board is at least 44 px high: the lane switch, a state tab, a lane's heading, a card and its ⋯", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "board", exact: true }).tap();
    const card = page.locator("[data-card]", { hasText: "fold the laundry" });
    await expect(card).toBeVisible();
    const lane = page
      .locator("[data-lane]", { has: card })
      .getByRole("heading")
      .getByRole("button");
    for (const target of [
      page.getByRole("button", { name: "kind", exact: true }),
      page.getByRole("button", { name: "project", exact: true }),
      page.getByRole("tab", { name: /^Open \d+$/ }),
      lane,
      card,
      page.getByRole("button", { name: "more for fold the laundry" }),
    ])
      expect(await tapHeight(target), `${target}`).toBeGreaterThanOrEqual(44);
  });
});
