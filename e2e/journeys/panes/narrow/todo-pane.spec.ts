import type { Locator, Page } from "@playwright/test";
import {
  bodyOf,
  caretLine,
  hold,
  noteText,
  PANE,
  phone,
  TODO_ROW,
  today,
  toTodoList,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

test.use(phone);

const NOTE = "02 Projects/Taps.md";
const LINES = "- [ ] buy milk\n- [ ] renew the passport\n- [ ] ship it\n";
type Row = { id: string; words: string; state: string; blocked_by: string[] };
/** The store's todos in `note`, where the import put Taps' lines. */
async function rows(url: string, note = NOTE): Promise<Row[]> {
  const answer = await fetch(`${url}/api/todos/rows?note=${encodeURIComponent(note)}`);
  return (await answer.json()) as Row[];
}
const states = async (url: string, note = NOTE) =>
  (await rows(url, note)).map((r) => `${r.state} ${r.words}`);
const OPEN = ["open buy milk", "open renew the passport", "open ship it"];
const idOf = async (url: string, words: string) =>
  (await rows(url)).find((r) => r.words === words)?.id ?? "";
/** `GET /api/todos`, where a running timer is a `## Time` line. */
async function listed(url: string): Promise<string[]> {
  return ((await (await fetch(`${url}/api/todos`)).json()) as { text: string }[]).map(
    (h) => h.text,
  );
}
/** Adds a todo line to Taps as a write from elsewhere would. */
async function addElsewhere(vault: string, line: string): Promise<void> {
  await vaultWith(vault, { [NOTE]: `${await noteText(vault, NOTE)}${line}\n` });
}
const more = (page: Page, name: string) => page.getByRole("button", { name: `more for ${name}` });
const strip = (page: Page, label: string, name: string) =>
  page.getByRole("button", { name: `${label} ${name}`, exact: true });
const draft = (page: Page) => page.getByLabel("edit line");
const row = (page: Page, text: string) => page.locator(TODO_ROW, { hasText: text });
const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The todo pane by touch, over Taps.md, once its rows are drawn; it answers the writes sent from here on. */
async function pane(page: Page, vault: string, lines = LINES, last = "ship it") {
  await vaultWith(vault, { [NOTE]: lines });
  const writes: string[] = [];
  page.on("request", (request) => {
    const write = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method());
    if (write && /\/api\/(files|todos)\//.test(request.url())) writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await toTodoList(page);
  await expect(more(page, last)).toBeVisible();
  return writes;
}

test("a tap on a row opens its note at that line and sets no state", async ({ page, stack }) => {
  const writes = await pane(page, stack.vault);
  await row(page, "renew the passport").tap();
  // The note's embed, drawn as its words or, under the cursor, its id.
  const id = await idOf(stack.url, "renew the passport");
  expect(id).not.toBe("");
  await expect(caretLine(page)).toContainText(new RegExp(`renew the passport|${id}`));
  expect([writes, await states(stack.url)]).toEqual([[], OPEN]);
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
  await expect(draft(page)).toHaveValue(/^- \[ \] renew the passport ➕/);
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
    .poll(() => states(stack.url))
    .toEqual(["open buy milk", "open renew the old passport", "open ship it"]);
});

test("timer starts a session on the strip's row and closes the strip", async ({ page, stack }) => {
  await pane(page, stack.vault);
  await more(page, "ship it").tap();
  await strip(page, "timer", "ship it").tap();
  await expect(strip(page, "timer", "ship it")).toHaveCount(0);
  await expect
    .poll(async () => (await listed(stack.url)).join("\n"))
    .toMatch(/^- \d\d:\d\d-.*ship it/m);
});

test("timer tapped before the file listing answers starts a session in today's note (#2061)", async ({
  page,
  stack,
}) => {
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/files");
  const release = await hold(page, /\/api\/files$/);
  const written = page.waitForResponse((r) =>
    /^\/api\/todos\/kt-\w+\/timer$/.test(new URL(r.url()).pathname),
  );
  await pane(page, stack.vault);
  await asked;
  await more(page, "ship it").tap();
  await strip(page, "timer", "ship it").tap();
  expect(`${(await written).request().method()} ${(await written).status()}`).toBe("POST 200");
  await expect
    .poll(async () => (await listed(stack.url)).join("\n"))
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
  test("then a tap on another row sets the todo blocked by it, and opens nothing", async ({
    page,
    stack,
  }) => {
    await pane(page, stack.vault);
    await more(page, "ship it").tap();
    await strip(page, "blocked by", "ship it").tap();
    await expect(page.getByTestId("todo-pick")).toContainText("⛔ pick what blocks: ship it");
    await row(page, "renew the passport").tap();
    await expect(page.getByTestId("todo-pick")).toHaveCount(0);
    const renew = await idOf(stack.url, "renew the passport");
    await expect
      .poll(async () => (await rows(stack.url)).find((r) => r.words === "ship it")?.blocked_by)
      .toEqual([renew]);
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
    expect([writes, await states(stack.url)]).toEqual([[], OPEN]);
  });
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
  expect([writes, await states(stack.url)]).toEqual([[], OPEN]);
});

test("two presses of a row's state button straight after each other walk it on to done (#2080)", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault);
  const cycle = page.getByRole("button", { name: "cycle buy milk" });
  // Each press is a tap that asks and a tap that writes.
  for (const _ of [1, 2, 3, 4]) await cycle.tap();
  await expect.poll(() => states(stack.url)).toContain("done buy milk");
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

/** Taps `cycle` once, then a write from elsewhere adds `call mom` to the note and the list redraws. */
async function askThenAdd(page: Page, vault: string, cycle: Locator) {
  await cycle.tap();
  await expect(cycle).toHaveAttribute("aria-pressed", "true");
  await addElsewhere(vault, "- [ ] call mom");
  await expect(more(page, "call mom")).toBeVisible();
}

test("a state button's question stays on its todo when a write from elsewhere redraws the list (#2092)", async ({
  page,
  stack,
}) => {
  const writes = await pane(page, stack.vault);
  const cycle = page.getByRole("button", { name: "cycle buy milk" });
  await askThenAdd(page, stack.vault, cycle);
  await expect(cycle).toHaveAttribute("aria-pressed", "true");
  await cycle.tap();
  await expect.poll(() => states(stack.url)).toContain("doing buy milk");
  expect(writes).toHaveLength(1);
});

test("of two todos alike, the question stays on the one tapped, and the next tap walks it", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault, "- [ ] buy milk\n- [ ] buy milk\n- [ ] ship it\n");
  const second = page.getByRole("button", { name: "cycle buy milk" }).nth(1);
  await askThenAdd(page, stack.vault, second);
  await second.tap();
  await expect
    .poll(async () => (await states(stack.url)).filter((r) => r.endsWith("buy milk")))
    .toEqual(["open buy milk", "doing buy milk"]);
});

test("a question leaves with its todo, and the todo drawn in its place asks at its own first tap", async ({
  page,
  stack,
}) => {
  const writes = await pane(page, stack.vault);
  await page.getByRole("button", { name: "cycle buy milk" }).tap();
  // Deleted elsewhere: the passport takes its row.
  const milk = await idOf(stack.url, "buy milk");
  await fetch(`${stack.url}/api/todos/${milk}`, { method: "DELETE" });
  const note = await noteText(stack.vault, NOTE);
  await vaultWith(stack.vault, { [NOTE]: note.replace(`![[${milk}]]\n`, "") });
  await expect(more(page, "buy milk")).toHaveCount(0);
  const renew = page.getByRole("button", { name: "cycle renew the passport" });
  await expect(renew).toHaveAttribute("aria-pressed", "false");
  await renew.tap();
  await expect(renew).toHaveAttribute("aria-pressed", "true");
  expect([writes, await states(stack.url)]).toEqual([[], OPEN.slice(1)]);
});

test("timer tapped straight after a state press starts a session on the todo it walked (#2084)", async ({
  page,
  stack,
}) => {
  const garden = "02 Projects/Garden.md";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The state press's write waits until the timer is tapped, so the timer reads the row as it was listed.
  await page.route(
    (url) => /^\/api\/todos\/kt-\w+\/(cycle|state)$/.test(url.pathname),
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await toTodoList(page);
  const cycle = page.getByRole("button", { name: "cycle water the tomatoes" });
  await cycle.tap();
  await cycle.tap();
  await more(page, "water the tomatoes").tap();
  await strip(page, "timer", "water the tomatoes").tap();
  release();
  await expect
    .poll(async () => (await listed(stack.url)).join("\n"))
    .toMatch(/^- \d\d:\d\d-.*water the tomatoes/m);
  await expect.poll(() => states(stack.url, garden)).toContain("doing water the tomatoes");
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("edit tapped after a state press keeps the row and every typed key through the redraw that moves it (#2087)", async ({
  page,
  stack,
}) => {
  const garden = "02 Projects/Garden.md";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => /^\/api\/todos\/kt-\w+\/(cycle|state)$/.test(url.pathname),
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await toTodoList(page);
  const cycle = page.getByRole("button", { name: "cycle water the tomatoes" });
  await cycle.tap();
  await cycle.tap();
  await more(page, "water the tomatoes").tap();
  await strip(page, "edit", "water the tomatoes").tap();
  await expect(draft(page)).toBeFocused();
  await page.keyboard.press("Home");
  for (const _ of "- [/] water the ") await page.keyboard.press("ArrowRight");
  await page.keyboard.type("red ");
  const walked = page.waitForResponse((r) =>
    /^\/api\/todos\/kt-\w+\/(cycle|state)$/.test(new URL(r.url()).pathname),
  );
  release();
  await walked;
  await page.keyboard.type("ripe ", { delay: 150 });
  await expect(draft(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => states(stack.url, garden)).toContain("doing water the red ripe tomatoes");
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

test("edit by touch on a waiting row that names nobody puts the caret after the wait stamp (#1021)", async ({
  page,
  stack,
}) => {
  await pane(page, stack.vault, "- [w] kettle 👤 2026-10-25\n", "kettle");
  await more(page, "kettle").tap();
  await strip(page, "edit", "kettle").tap();
  await expect(draft(page)).toBeFocused();
  await expect
    .poll(() =>
      draft(page).evaluate((field: HTMLInputElement) =>
        field.value.slice(0, field.selectionStart ?? 0),
      ),
    )
    .toBe("- [w] kettle 👤 2026-10-25");
});

// Without vim the caret goes past the stamp, so the name typed next follows the date (#2094).
test("the palette's waiting by touch puts the name typed next after the wait stamp", async ({
  page,
  stack,
}) => {
  const day = "2026-10-25";
  // A shared list, whose todo lines stay lines the editor's commands act on.
  const list = "05 Shared/Taps.md";
  await vaultWith(stack.vault, { [list]: `- [ ] kettle ⏲ 👤 ${day}\n- [ ] call the plumber\n` });
  await page.clock.setFixedTime(new Date(`${day}T12:00:00`));
  await page.goto(`/?note=${encodeURIComponent(list)}`);
  for (const words of ["kettle", "call the plumber"]) {
    await page.locator(".cm-line", { hasText: words }).tap({ timeout: 15_000 });
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("combobox").fill("waiting on somebody");
    await page.getByRole("option", { name: /waiting on somebody/ }).tap();
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.keyboard.type(" Zoe");
  }
  await expect
    .poll(async () => bodyOf(await noteText(stack.vault, list)), { timeout: 15_000 })
    .toContain(`- [w] kettle 👤 ${day} Zoe ⏲ 👤 ${day}\n- [w] call the plumber 👤 ${day} Zoe`);
});
