import type { Page } from "@playwright/test";
import { noteText, phone, today, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

test.use(phone);

const NOTE = "02 Projects/Taps.md";
const LINES = "- [ ] buy milk\n- [ ] renew the passport\n- [ ] ship it\n";
const disk = (vault: string) =>
  noteText(vault, NOTE).then((t) => t.replace(/^---\n[\s\S]*?\n---\n/, ""));
const more = (page: Page, name: string) => page.getByRole("button", { name: `more for ${name}` });
const strip = (page: Page, label: string, name: string) =>
  page.getByRole("button", { name: `${label} ${name}`, exact: true });
const draft = (page: Page) => page.getByLabel("edit line");

/** The todo pane by touch, over Taps.md, once its rows are drawn; it answers the note writes sent from here on. */
async function pane(page: Page, vault: string) {
  await vaultWith(vault, { [NOTE]: LINES });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method()) && request.url().includes("/api/files/"))
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await expect(more(page, "ship it")).toBeVisible();
  return writes;
}

test("a tap on a row opens its note at that line and sets no state", async ({ page, stack }) => {
  const writes = await pane(page, stack.vault);
  await page.getByRole("button", { name: "renew the passport", exact: true }).tap();
  await expect(page.locator(".cm-activeLine")).toContainText("renew the passport");
  expect([writes, await disk(stack.vault)]).toEqual([[], LINES]);
});

test("the strip opens one row at a time, its buttons out of the tab order, and a second tap closes it", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  const [milk, ship] = [more(page, "buy milk"), more(page, "ship it")];
  await expect(milk).toHaveAttribute("aria-expanded", "false");
  await expect(milk).toHaveAttribute("tabindex", "-1");
  await expect(strip(page, "timer", "buy milk")).toHaveCount(0);
  await milk.tap();
  await expect(milk).toHaveAttribute("aria-expanded", "true");
  await expect(strip(page, "timer", "buy milk")).toHaveAttribute("tabindex", "-1");
  await ship.tap();
  await expect(milk).toHaveAttribute("aria-expanded", "false");
  await expect(strip(page, "timer", "buy milk")).toHaveCount(0);
  await expect(strip(page, "timer", "ship it")).toBeVisible();
  await ship.tap();
  await expect(ship).toHaveAttribute("aria-expanded", "false");
  await expect(strip(page, "timer", "ship it")).toHaveCount(0);
});

test("edit turns the tapped row into its line at 16px, Enter writes it, and edit on another row keeps the draft", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  await more(page, "renew the passport").tap();
  await strip(page, "edit", "renew the passport").tap();
  // The row tapped, not the row the cursor is on.
  await expect(draft(page)).toHaveValue("- [ ] renew the passport");
  await expect(draft(page)).toBeFocused();
  // Under 16px Safari zooms into a focused field.
  for (const field of [draft(page), page.getByLabel("filter todos")])
    await expect(field).toHaveCSS("font-size", "16px");
  await draft(page).fill("- [ ] renew the old passport");
  await more(page, "ship it").tap();
  await strip(page, "edit", "ship it").tap();
  await expect(draft(page)).toHaveValue("- [ ] renew the old passport");
  await draft(page).press("Enter");
  await expect(draft(page)).toHaveCount(0);
  await expect
    .poll(() => disk(stack.vault))
    .toBe("- [ ] buy milk\n- [ ] renew the old passport\n- [ ] ship it\n");
});

test("timer starts a session on the strip's row and closes the strip", async ({ page, stack }) => {
  await pane(page, stack.vault);
  await more(page, "ship it").tap();
  await strip(page, "timer", "ship it").tap();
  await expect(strip(page, "timer", "ship it")).toHaveCount(0);
  await expect
    .poll(() => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => ""))
    .toMatch(/^- \d\d:\d\d-.*ship it/m);
});

test("part opens the part prompt under the strip's row and closes the strip", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  await more(page, "renew the passport").tap();
  await strip(page, "part", "renew the passport").tap();
  await expect(page.getByRole("dialog", { name: "Add part" })).toContainText(
    "under renew the passport",
  );
  await expect(page.getByRole("dialog", { name: "Add todo" })).toHaveCount(0);
  await expect(strip(page, "part", "renew the passport")).toHaveCount(0);
});

test.describe("blocked by", () => {
  test("then a tap on another row writes ⛔ and its new id into the two lines, and opens nothing", async ({
    page,
    stack,
  }) => {
    await pane(page, stack.vault);
    await more(page, "ship it").tap();
    await strip(page, "blocked by", "ship it").tap();
    await expect(page.getByTestId("todo-pick")).toContainText("⛔ pick what blocks: ship it");
    await page.getByRole("button", { name: "renew the passport", exact: true }).first().tap();
    await expect(page.getByTestId("todo-pick")).toHaveCount(0);
    await expect
      .poll(() => disk(stack.vault))
      .toMatch(
        /^- \[ \] buy milk\n- \[ \] renew the passport 🆔 (kt-\w{6})\n- \[.\] ship it ⛔ \1\n$/,
      );
    // The pane is still the todo pane: no note opened over it.
    await expect(more(page, "buy milk")).toBeVisible();
    await expect(page.locator(".cm-activeLine")).toHaveCount(0);
  });

  test("then cancel gives the list back and writes nothing, there being no Escape under a finger", async ({
    page,
    stack,
  }) => {
    const writes = await pane(page, stack.vault);
    await more(page, "ship it").tap();
    await strip(page, "blocked by", "ship it").tap();
    await expect(page.getByTestId("todo-pick")).toBeVisible();
    await page.getByRole("button", { name: "cancel" }).tap();
    await expect(page.getByTestId("todo-pick")).toHaveCount(0);
    // A pick would be a tap on a row now; the list is back and takes it as an open.
    await expect(more(page, "buy milk")).toBeVisible();
    expect([writes, await disk(stack.vault)]).toEqual([[], LINES]);
  });
});
