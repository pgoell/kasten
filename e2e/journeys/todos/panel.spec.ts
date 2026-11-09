import { openApp } from "../../harness/app.ts";
import { lineOf, openPanel } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const TODOS = (potatoes: number) => [
  { path: "02 Projects/Garden.md", line: potatoes, text: "- [ ] wire up the pane 📅 2026-08-14" },
  { path: "02 Projects/Home.md", line: 4, text: "- [/] write the docs" },
  { path: "02 Projects/Home.md", line: 5, text: "- [x] read the spec" },
  // A `## Time` line comes back from the endpoint too, and is no todo.
  { path: "02 Projects/Home.md", line: 9, text: "- 09:12-10:32 wire up the pane" },
];

test("the todos panel draws the open todos with their state, narrows on the answer in hand, and Enter opens the line", async ({
  page,
  stack,
}) => {
  let asks = 0;
  await page.route("**/api/todos?**", async (route) => {
    asks += 1;
    const potatoes = await lineOf(stack.vault, "02 Projects/Garden.md", "buy seed potatoes");
    await route.fulfill({ json: TODOS(potatoes) });
  });
  await openApp(page);
  await openPanel(page, "ft", "todos");
  const rows = page.getByRole("dialog", { name: "Todos" }).getByRole("option");
  await expect(rows).toHaveText([/☐.*wire up the pane.*2026-08-14/, /◐.*write the docs/]);
  const before = asks;
  await page.keyboard.type("docs");
  // One poll: the list narrows and the vault was not asked again.
  await expect.poll(async () => [await rows.count(), asks]).toEqual([1, before]);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(rows).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("buy seed potatoes");
});
