import type { Page } from "@playwright/test";
import { hold, noteText, PANE, phone, TODO_ROW, today, vaultWith } from "../../../harness/app.ts";
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
async function pane(page: Page, vault: string, lines = LINES, last = "ship it") {
  await vaultWith(vault, { [NOTE]: lines });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method()) && request.url().includes("/api/files/"))
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await expect(more(page, last)).toBeVisible();
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

test("timer tapped before the file listing answers starts a session in today's note (#2061)", async ({
  page,
  stack,
}) => {
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/files");
  const release = await hold(page, /\/api\/files$/);
  const written = page.waitForResponse(
    (r) => decodeURIComponent(new URL(r.url()).pathname) === `/api/files/${NOTE}` && r.request().method() !== "GET",
  );
  await pane(page, stack.vault);
  await asked;
  await more(page, "ship it").tap();
  await strip(page, "timer", "ship it").tap();
  expect(`${(await written).request().method()} ${(await written).status()}`).toBe("PUT 200");
  await expect
    .poll(() => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => ""))
    .toMatch(/^- \d\d:\d\d-.*ship it/m);
  await release();
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

const row = (page: Page, text: string) => page.locator(TODO_ROW, { hasText: text });
const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("#541 #544 a row holds on an id an open and a done todo carry, and not on one both closed todos carry", async ({
  page,
  stack,
}) => {
  const done = `✅ ${today()}`;
  await pane(
    page,
    stack.vault,
    `- [ ] ship the release 🆔 kt-aaaaaa\n- [x] cut the branch ${done} 🆔 kt-aaaaaa\n- [b] write the docs ⛔ kt-aaaaaa\n- [x] a ${done} 🆔 kt-bbbbbb\n- [-] a ❌ ${today()} 🆔 kt-bbbbbb\n- [b] chase it ⛔ kt-bbbbbb\n`,
    "chase it",
  );
  await expect(row(page, "write the docs")).toContainText("⛔ kt-aaaaaa");
  await expect(row(page, "chase it")).not.toContainText("⛔");
});

test("the row is the only tab stop, its state button out of the tab order", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  const stops = page.locator(`${PANE} button[title]:not([title=""])[tabindex="0"]`);
  await expect(stops).toHaveCount(1);
  await expect(page.getByRole("button", { name: "cycle buy milk" })).toHaveAttribute(
    "tabindex",
    "-1",
  );
});

test("add todo opens the add prompt", async ({ page, stack }) => {
  await pane(page, stack.vault);
  await page.getByRole("button", { name: "add todo" }).tap();
  await expect(page.getByRole("dialog", { name: "Add todo" })).toBeVisible();
});

test("done swaps the list for the finished work and back, as d does", async ({ page, stack }) => {
  await pane(page, stack.vault, `${LINES}- [x] pack the bag ✅ ${today()}\n`);
  await expect(tab(page, "done")).toHaveAttribute("aria-pressed", "false");
  await tab(page, "done").tap();
  await expect(tab(page, "done")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "pack the bag")).toBeVisible();
  await expect(row(page, "buy milk")).toHaveCount(0);
  await tab(page, "done").tap();
  await expect(row(page, "buy milk")).toBeVisible();
  await expect(tab(page, "done")).toHaveAttribute("aria-pressed", "false");
});

test("next shows one next action per todo, named under its todo, as n does", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault, "- [ ] pack\n  - [ ] socks\n  - [ ] shirts\n", "shirts");
  await tab(page, "next").tap();
  await expect(row(page, "shirts")).toHaveCount(0);
  await expect(row(page, "socks")).toContainText("pack");
  await expect(tab(page, "next")).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "done")).toHaveAttribute("aria-pressed", "false");
});

test("view walks the views as v does, and writes the views note once in a vault with none", async ({
  page,
  stack,
}) => {
  // The views note is written only once the file listing says the vault lacks it (#2081).
  const listed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/files");
  const writes = await pane(page, stack.vault);
  await listed;
  await tab(page, "view").tap();
  await expect(page.getByTestId("todo-view")).toHaveText("today");
  await expect(page.getByLabel("filter todos")).toHaveValue("due:today");
  await expect(row(page, "buy milk")).toHaveCount(0);
  await tab(page, "view").tap();
  await expect(page.getByTestId("todo-view")).toHaveText("doing");
  expect(writes.filter((url) => decodeURIComponent(url).endsWith("/todo-views.md"))).toHaveLength(
    1,
  );
});

test("#773 Enter on a focused state button arms it and opens no note", async ({ page, stack }) => {
  const writes = await pane(page, stack.vault);
  const cycle = page.getByRole("button", { name: "cycle buy milk" });
  await cycle.focus();
  await page.keyboard.press("Enter");
  await expect(cycle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cm-activeLine")).toHaveCount(0);
  expect([writes, await disk(stack.vault)]).toEqual([[], LINES]);
});

test("two presses of a row's state button straight after each other walk it on to done (#2080)", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  const cycle = page.getByRole("button", { name: "cycle buy milk" });
  // Each press is a tap that asks and a tap that writes.
  for (const _ of [1, 2, 3, 4]) await cycle.tap();
  await expect.poll(() => disk(stack.vault)).toMatch(/^- \[x\] buy milk ✅/m);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("timer tapped straight after a state press starts a session on the todo it walked (#2084)", async ({
  page,
  stack,
}) => {
  // The vault's own note: one written here is stamped before it is listed, so no press moves it.
  const garden = "02 Projects/Garden.md";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The state press's save waits until the timer is tapped, so the timer reads the row as it was listed.
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${garden}`,
    async (route) => {
      if (route.request().method() === "PUT") await gate;
      await route.fallback();
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  const cycle = page.getByRole("button", { name: "cycle water the tomatoes" });
  await cycle.tap();
  await cycle.tap();
  await more(page, "water the tomatoes").tap();
  await strip(page, "timer", "water the tomatoes").tap();
  release();
  await expect
    .poll(() => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => ""))
    .toMatch(/^- \d\d:\d\d-.*water the tomatoes/m);
  expect(await noteText(stack.vault, garden)).toMatch(/^- \[\/\] water the tomatoes 🆔 kt-\w+$/m);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("edit tapped after a state press keeps the row and every typed key through the redraw that moves it (#2087)", async ({
  page,
  stack,
}) => {
  // The vault's own note, with no frontmatter: the press's save stamps three lines on top.
  const garden = "02 Projects/Garden.md";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${garden}`,
    async (route) => {
      if (route.request().method() === "PUT") await gate;
      await route.fallback();
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  const cycle = page.getByRole("button", { name: "cycle water the tomatoes" });
  await cycle.tap();
  await cycle.tap();
  await more(page, "water the tomatoes").tap();
  await strip(page, "edit", "water the tomatoes").tap();
  await expect(draft(page)).toBeFocused();
  await page.keyboard.press("Home");
  for (const _ of "- [/] water the ") await page.keyboard.press("ArrowRight");
  await page.keyboard.type("red ");
  const moved = page.waitForResponse(async (response) => {
    if (!response.url().includes("/api/todos")) return false;
    const hits = (await response.json()) as { path: string; line: number; text: string }[];
    return hits.some((hit) => hit.path === garden && hit.text.includes("tomatoes") && hit.line !== 5);
  });
  release();
  await moved;
  await page.keyboard.type("ripe ", { delay: 150 });
  await expect(draft(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => noteText(stack.vault, garden)).toMatch(/^- \[\/\] water the red ripe tomatoes/m);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("a tap on a kind chip narrows the list, a part going with its parent's kind, and narrows the board", async ({
  page,
  stack,
}) => {
  const lines =
    "- [ ] write the deck #internal\n  - [ ] draw the chart\n- [ ] send the invoice #client\n";
  await pane(page, stack.vault, lines, "send the invoice");
  const row = (text: string) => page.locator(TODO_ROW, { hasText: text });
  // The scope strip's own: a lane's heading and a row's buttons carry the same words.
  const chip = (name: string) =>
    page.locator("[data-todo-scope]").getByRole("button", { name, exact: true });
  await chip("#internal").tap();
  await expect(row("draw the chart")).toBeVisible();
  await expect(row("write the deck")).toBeVisible();
  await expect(row("send the invoice")).toHaveCount(0);
  await expect(row("fold the laundry")).toHaveCount(0);

  await chip("All").tap();
  await page.getByRole("button", { name: "board", exact: true }).tap();
  const card = (line: number) => page.locator(`[data-card="${NOTE}:${line}"]`);
  await expect(card(1)).toBeVisible();
  await chip("#client").tap();
  await expect(card(3)).toBeVisible();
  await expect(card(1)).toHaveCount(0);
  await expect(page.locator("[data-card]", { hasText: "fold the laundry" })).toHaveCount(0);
});
