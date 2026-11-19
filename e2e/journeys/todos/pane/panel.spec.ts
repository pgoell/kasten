import type { Page, Route } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  plus,
  readAll,
  TODO_ROW,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { openPanel } from "../../../harness/search.ts";
import { expect, test } from "../../../harness/stack.ts";

type Listed = { path: string; line: number; text: string };

const TODOS = (potatoes: Listed) => [
  potatoes,
  { path: "02 Projects/Home.md", line: 4, text: "- [/] write the docs" },
  { path: "02 Projects/Home.md", line: 5, text: "- [x] read the spec" },
  // A `## Time` line comes back from the endpoint too, and is no todo.
  { path: "02 Projects/Home.md", line: 9, text: "- 09:12-10:32 wire up the pane" },
];

test("the todos panel draws the open todos with their state, narrows on the answer in hand, and Enter opens the line", async ({
  page,
  stack,
}) => {
  const listed: Listed[] = await (await fetch(`${stack.url}/api/todos`)).json();
  const potatoes = listed.find((hit) => hit.text.includes("buy seed potatoes"));
  if (potatoes === undefined) throw new Error("the seed vault lists no potatoes todo");
  let asks = 0;
  await page.route("**/api/todos?**", async (route) => {
    asks += 1;
    await route.fulfill({ json: TODOS(potatoes) });
  });
  await openApp(page);
  await openPanel(page, "ft", "todos");
  const rows = page.getByRole("dialog", { name: "Todos" }).getByRole("option");
  await expect(rows).toHaveText([/☐.*buy seed potatoes/, /◐.*write the docs/]);
  const before = asks;
  await page.keyboard.type("docs");
  // One poll: the list narrows and the vault was not asked again.
  await expect.poll(async () => [await rows.count(), asks]).toEqual([1, before]);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  await expect(rows).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("buy seed potatoes");
});

/** The store's todos in today's daily note, as lines. */
const daily = async (url: string): Promise<string[]> =>
  ((await (await fetch(`${url}/api/todos`)).json()) as { path: string; text: string }[])
    .filter((hit) => hit.path === `01 Periodic/00 Daily/${today()}.md`)
    .map((hit) => hit.text);

/** Opens the todo pane's add prompt, counting the note and todo writes the page sends from here on. */
async function openPrompt(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(files|todos)\//.test(request.url()))
      writes.push(request.url());
  });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  await page.keyboard.press("a");
  const dialog = page.getByRole("dialog", { name: "Add todo" });
  return { writes, dialog, field: dialog.getByLabel("todo"), preview: dialog.locator("output") };
}

const hints = (page: Page) => page.getByTestId("todo-hint");

test.describe("the todo prompt", () => {
  test("takes the focus, previews the line the vault gets, and Enter adds it to today's note", async ({
    page,
    stack,
  }) => {
    const { dialog, field, preview } = await openPrompt(page);
    await expect(field).toBeFocused();
    const typed = `call the dentist due:${plus(3)} !high #health`;
    await page.keyboard.type(typed);
    const line = `- [ ] call the dentist #health 📅 ${plus(3)} ⏫ ➕ ${today()}`;
    await expect(preview).toHaveText(line);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    // The store answers its own field order, with the id it gave.
    await expect
      .poll(() => daily(stack.url))
      .toEqual([
        expect.stringMatching(
          `^- \\[ \\] call the dentist #health ⏫ ➕ ${today()} 📅 ${plus(3)} 🆔 kt-\\w{6}$`,
        ),
      ]);
  });

  test("offers the terms the input has not used, writes the one taken, then offers its days", async ({
    page,
  }) => {
    const { field, preview } = await openPrompt(page);
    await page.keyboard.type(`call the dentist due:${plus(3)}`);
    // The due date is written, so it is not on offer; the glyph sits beside the name.
    await expect(hints(page)).toHaveText([
      "⏳ scheduled",
      "🛫 start",
      "🔺 highest",
      "⏫ high",
      "🔼 medium",
      "🔽 low",
      "⏬ lowest",
      "🔁 daily",
      "🔁 weekly",
      "🔁 monthly",
      "🔁 repeat",
      "⏲ estimate",
    ]);
    await field.fill("call the dentist");
    await hints(page)
      .filter({ hasText: /^⏳ scheduled$/ })
      .click();
    await expect(field).toHaveValue("call the dentist sched:");
    await hints(page)
      .filter({ hasText: `${plus(1)} tomorrow` })
      .click();
    await expect(field).toHaveValue(`call the dentist sched:${plus(1)}`);
    await expect(preview).toContainText(`⏳ ${plus(1)}`);
    await expect(field).toBeFocused();
  });

  test("Enter on a hint takes the hint and writes no todo", async ({ page }) => {
    const { writes, dialog, field } = await openPrompt(page);
    await page.keyboard.type("call the dentist");
    await page.keyboard.press("Tab");
    await expect(hints(page).first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("call the dentist due:");
    await expect(dialog).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("Escape closes it and writes nothing; Enter on an empty field writes nothing and previews nothing", async ({
    page,
    stack,
  }) => {
    const { writes, dialog, preview } = await openPrompt(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(preview).toHaveText("");
    await page.keyboard.type("call the dentist");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(writes).toEqual([]);
    // A todo added next lands after any write the Escape sent, so its line shows none came.
    await page.keyboard.press("a");
    await page.keyboard.type("buy milk");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await daily(stack.url)).join("\n")).toContain("buy milk");
    expect((await daily(stack.url)).join("\n")).not.toContain("call the dentist");
  });

  test("is drawn at the narrow prompts' width", async ({ page }) => {
    const { dialog } = await openPrompt(page);
    // min(36rem, 90vw) on a 1280 px window: the panel the note and dump prompts use too.
    expect((await dialog.locator("> div").boundingBox())?.width).toBe(576);
  });

  test("opened by s on a row, it says which todo the part goes under", async ({ page }) => {
    await openApp(page);
    await leader(page, "gt");
    await cursorTo(page, "water the tomatoes");
    await page.keyboard.press("s");
    const dialog = page.getByRole("dialog", { name: "Add part" });
    await expect(dialog).toContainText("under water the tomatoes");
    await expect(dialog.getByLabel("part")).toBeFocused();
  });
});

const WORDS = [
  "wirepane",
  "writeit",
  "story",
  "stepone",
  "steptwo",
  "safari",
  "checklist",
  "packbag",
  "bread",
  "rone",
  "faraway",
  "rtwo",
  "near",
  "rthree",
  "farther",
  "jeep",
  "spec",
  "argue",
];

test("the todo pane counts parts on their todo, indents them under it, names one its date moves, and a heading or list item stops them", async ({
  page,
  stack,
}) => {
  const t = `📅 ${plus(0)}`;
  const note = [
    "# Parts",
    `- [/] wirepane ${t}`,
    `  - [x] spec ✅ ${plus(0)}`,
    "  - [-] argue",
    "  - [ ] writeit",
    "- [/] story",
    "  - [ ] stepone",
    "    - [ ] steptwo",
    `- [/] safari ${t} ⏫`,
    `  - [ ] checklist 📅 ${plus(4)}`,
    "  - [ ] packbag",
    `- [/] holdback 🛫 ${plus(1)}`,
    "  - [ ] jeep",
    "- [ ] bread",
    `- [ ] rone ${t} ⏫ #client`,
    "- plain",
    "  - [ ] faraway",
    "## Other",
    `- [ ] rtwo ${t} ⏫ #client`,
    "  - [ ] near",
    `- [ ] rthree ${t} ⏫ #client`,
    "## Stop",
    "  - [ ] farther",
  ];
  await vaultWith(stack.vault, { "02 Projects/Parts.md": `${note.join("\n")}\n` });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "farther" })).toBeVisible();
  // Each row by its own words (the last known word in it), with its text, group and indent, read at once.
  const rows = await readAll(
    page,
    '[data-row*="Parts.md:"]',
    (all, words) =>
      Object.fromEntries(
        all.map((row) => {
          const text = row.textContent ?? "";
          const own = [...words].sort((a, b) => text.lastIndexOf(b) - text.lastIndexOf(a))[0];
          const group = row.parentElement?.querySelector("h3")?.textContent?.replace(/ \d+$/, "");
          return [own, [text, group, Number.parseFloat(row.style.paddingLeft)]];
        }),
      ) as Record<string, [string, string, number]>,
    WORDS,
  );
  const text = (k: string) => rows[k]?.[0];
  const group = (k: string) => rows[k]?.[1];
  const pad = (k: string) => rows[k]?.[2] ?? 0;
  // The closed parts, the waiting todo and its part are off the list.
  expect(Object.keys(rows).sort()).toEqual(WORDS.slice(0, 15).sort());
  expect(text("wirepane")).toContain("2/3");
  expect(text("writeit")).not.toContain("/");
  expect(pad("writeit")).toBeGreaterThan(pad("wirepane"));
  expect(pad("stepone")).toBeGreaterThan(pad("story"));
  expect(pad("steptwo")).toBeGreaterThan(pad("stepone"));
  expect([group("checklist"), text("checklist"), pad("checklist")]).toEqual([
    "This week",
    expect.stringContaining("safari"),
    pad("story"),
  ]);
  expect([group("packbag"), text("packbag")]).toEqual([
    "Today",
    expect.stringMatching(`⏫.*${plus(0).slice(5)}`),
  ]);
  // The import gives an undated todo its soft due date, two weeks out.
  expect([group("faraway"), group("farther"), text("rone"), text("rthree")]).toEqual([
    "Later",
    "Later",
    expect.not.stringContaining("0/1"),
    expect.not.stringContaining("0/1"),
  ]);
  expect(text("faraway") + text("farther")).not.toMatch(/⏫|◆|rone|rthree/);
  expect([group("near"), text("rtwo"), text("near")]).toEqual([
    "Today",
    expect.stringContaining("0/1"),
    expect.stringMatching(/⏫.*◆/),
  ]);
});

const VIEWS = "99 Misc/01 Config/todo-views.md";
const DUE = {
  "02 Projects/Due.md": `- [ ] pay the rent 📅 ${plus(0)}\n- [ ] mow the lawn 📅 ${plus(0)}\n- [/] paint the fence\n`,
};

/** Opens the todo pane on the vault as it stands, counting the creates of the views note. */
async function viewsPane(page: Page) {
  const creates: string[] = [];
  page.on("request", (request) => {
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (request.method() === "POST" && path === `/api/files/${VIEWS}`) creates.push(path);
  });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  const rows = page.locator(TODO_ROW);
  const all = await rows.count();
  const view = page.getByTestId("todo-view");
  return { creates, rows, all, view, filter: page.getByLabel("filter todos") };
}

/** Routes the views note's requests of one method to `answer`, leaving the rest alone. */
async function holdViews(page: Page, method: string, answer: (route: Route) => Promise<void>) {
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${VIEWS}`,
    (route) => (route.request().method() === method ? answer(route) : route.fallback()),
  );
}

test.describe("the todo pane's views", () => {
  test("v puts each view of the vault's note in the filter line in turn, gives the whole list back past the last, and typing takes the name away", async ({
    page,
    stack,
  }) => {
    const note = "# Views\n\n- soon: due:today\n- doing: /doing\n- urgent: !highest !high\n";
    await vaultWith(stack.vault, { ...DUE, [VIEWS]: note });
    const { creates, rows, all, view, filter } = await viewsPane(page);
    await page.keyboard.press("v");
    await expect(view).toHaveText("soon");
    await expect(filter).toHaveValue("due:today");
    await expect(rows).toHaveText([/pay the rent/, /mow the lawn/]);
    await page.keyboard.press("v");
    await expect(view).toHaveText("doing");
    await expect(filter).toHaveValue("/doing");
    await expect(rows).toHaveText([/paint the fence/]);
    await page.keyboard.press("v");
    await expect(view).toHaveText("urgent");
    await page.keyboard.press("v");
    await expect(view).toBeHidden();
    await expect(filter).toHaveValue("");
    await expect(rows).toHaveCount(all);
    await page.keyboard.press("v");
    await expect(view).toHaveText("soon");
    await filter.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" #garden");
    await expect(view).toBeHidden();
    await expect(filter).toHaveValue("due:today #garden");
    expect(creates).toEqual([]);
  });

  test("the first v in a vault with no views note writes the defaults, once however fast a second v comes", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, DUE);
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    await holdViews(page, "POST", async (route) => {
      await held;
      await route.fallback();
    });
    const { creates, rows, view, filter } = await viewsPane(page);
    await page.keyboard.press("v");
    await page.keyboard.press("v");
    await expect.poll(() => creates.length).toBe(1);
    release();
    await expect(view).toHaveText("doing");
    await expect(filter).toHaveValue("/doing");
    await expect
      .poll(() => noteText(stack.vault, VIEWS).catch(() => ""))
      .toContain("- today: due:today");
    for (const _ of ["review", "important", "", "today"]) await page.keyboard.press("v");
    await expect(view).toHaveText("today");
    await expect(filter).toHaveValue("due:today");
    await expect(rows).toHaveText([/pay the rent/, /mow the lawn/]);
    expect(creates).toHaveLength(1);
  });

  const BLANK: [string, Record<string, string>, ((page: Page) => Promise<void>) | null][] = [
    [
      "a views note the vault cannot read",
      { [VIEWS]: "- today: due:today\n" },
      (page) =>
        holdViews(page, "GET", (route) =>
          route.fulfill({ status: 404, json: { detail: "Not found" } }),
        ),
    ],
    [
      "a views note holding no line it can read",
      { [VIEWS]: "# Todo views\n\nNone written yet.\n" },
      null,
    ],
    [
      "a refused create",
      {},
      (page) =>
        holdViews(page, "POST", (route) => route.fulfill({ status: 500, json: { detail: "no" } })),
    ],
  ];
  for (const [name, notes, refuse] of BLANK) {
    test(`says no views and narrows nothing for ${name}`, async ({ page, stack }) => {
      await vaultWith(stack.vault, { ...DUE, ...notes });
      await refuse?.(page);
      const { rows, all, view, filter } = await viewsPane(page);
      await page.keyboard.press("v");
      await expect(view).toHaveText("no views");
      await expect(filter).toHaveValue("");
      await expect(rows).toHaveCount(all);
    });
  }
});

const BLOCKS = "02 Projects/Blocks.md";
const PICK = "write the docs";

/** The todo pane over a note of `lines`, with `b` pressed on the row holding `on`. */
async function picker(page: Page, vault: string, lines: string[], on = PICK) {
  await vaultWith(vault, { [BLOCKS]: `${lines.join("\n")}\n` });
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, on);
  await page.keyboard.press("b");
  return page.getByTestId("todo-pick");
}

const BLOCK_LINES = ["- [ ] write the docs", "- [ ] ship the release", "- [ ] tag it"];
type Row = { id: string; words: string; state: string; blocked_by: string[] };
/** The note's todos in the store, by their words. */
async function blocks(url: string): Promise<Record<string, Row>> {
  const rows: Row[] = await (
    await fetch(`${url}/api/todos/rows?note=${encodeURIComponent(BLOCKS)}`)
  ).json();
  return Object.fromEntries(rows.map((row) => [row.words, row]));
}

test.describe("the todo pane's b picker", () => {
  test("names the row, Enter writes ⛔ and the blocker's new id into the two lines, and opens nothing", async ({
    page,
    stack,
  }) => {
    const pick = await picker(page, stack.vault, BLOCK_LINES);
    await expect(pick).toHaveText(`⛔ pick what blocks: ${PICK}`);
    await expect(page.getByText("Enter pick")).toBeVisible();
    await cursorTo(page, "ship the release");
    await page.keyboard.press("Enter");
    await expect(pick).toBeHidden();
    await expect
      .poll(async () => {
        const rows = await blocks(stack.url);
        return [rows[PICK]?.blocked_by, rows["tag it"]?.blocked_by];
      })
      .toEqual([[(await blocks(stack.url))["ship the release"]?.id], []]);
    // Enter outside the picker opens the row's note in a tab of its own.
    await expect(page.getByRole("tab", { name: "Blocks" })).toHaveCount(0);
  });

  test("Enter on the row itself keeps the picker, and Escape gives the list back, both writing nothing", async ({
    page,
    stack,
  }) => {
    const pick = await picker(page, stack.vault, BLOCK_LINES);
    await page.keyboard.press("Enter");
    await expect(pick).toBeVisible();
    await cursorTo(page, "ship the release");
    await page.keyboard.press("Escape");
    await expect(pick).toBeHidden();
    // The cycle lands after any write the two presses sent.
    await cursorTo(page, "tag it");
    await page.keyboard.press("x");
    await expect.poll(async () => (await blocks(stack.url))["tag it"]?.state).toBe("doing");
    expect(Object.values(await blocks(stack.url)).flatMap((row) => row.blocked_by)).toEqual([]);
  });

  test("keeps every key that acts on a row off the picker", async ({ page, stack }) => {
    const pick = await picker(page, stack.vault, BLOCK_LINES);
    const rows = await page.locator(TODO_ROW).count();
    for (const key of ["x", "X", "t", "a", "s", "i", "d", "q"]) await page.keyboard.press(key);
    await expect(pick).toBeVisible();
    await expect(page.locator(TODO_ROW)).toHaveCount(rows);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("edit line")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await cursorTo(page, "tag it");
    await page.keyboard.press("x");
    await expect.poll(async () => (await blocks(stack.url))["tag it"]?.state).toBe("doing");
    const after = await blocks(stack.url);
    expect([
      after[PICK]?.state,
      after["ship the release"]?.state,
      Object.keys(after).length,
    ]).toEqual(["open", "open", 3]);
    expect(await daily(stack.url)).toEqual([]);
  });

  test("offers a todo that cannot start yet, which the list leaves out", async ({
    page,
    stack,
  }) => {
    const later = page.locator(TODO_ROW, { hasText: "start later" });
    const pick = await picker(page, stack.vault, [
      ...BLOCK_LINES,
      `- [ ] start later 🛫 ${plus(5)}`,
    ]);
    await expect(pick).toBeVisible();
    await expect(later).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(later).toHaveCount(0);
  });

  test("b on a finished row opens no picker", async ({ page, stack }) => {
    await picker(page, stack.vault, [...BLOCK_LINES, `- [x] done thing ✅ ${plus(0)}`]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("d");
    await cursorTo(page, "done thing");
    await page.keyboard.press("b");
    // A picker opened there would hold, and the next b on an open row would not name it.
    await page.keyboard.press("d");
    await cursorTo(page, "tag it");
    await page.keyboard.press("b");
    await expect(page.getByTestId("todo-pick")).toHaveText("⛔ pick what blocks: tag it");
  });
});
