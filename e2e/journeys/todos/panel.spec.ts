import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  localDate,
  noteText,
  openApp,
  readAll,
  TODO_ROW,
  today,
  vaultWith,
} from "../../harness/app.ts";
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

/** `days` after today, as the vault writes a date. */
const plus = (days: number) => localDate(new Date(Date.now() + days * 86_400_000));

/** Opens the todo pane's add prompt, counting the PUTs the page sends from here on. */
async function openPrompt(page: Page) {
  const puts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") puts.push(request.url());
  });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  await page.keyboard.press("a");
  const dialog = page.getByRole("dialog", { name: "Add todo" });
  return { puts, dialog, field: dialog.getByLabel("todo"), preview: dialog.locator("output") };
}

const hints = (page: Page) => page.getByTestId("todo-hint");

test.describe("the todo prompt", () => {
  test("takes the focus, previews the line the vault gets, and Enter writes it into today's note", async ({
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
    await expect
      .poll(() => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => ""))
      .toContain(`## TODOs\n${line}`);
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
    const { puts, dialog, field } = await openPrompt(page);
    await page.keyboard.type("call the dentist");
    await page.keyboard.press("Tab");
    await expect(hints(page).first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("call the dentist due:");
    await expect(dialog).toBeVisible();
    expect(puts).toEqual([]);
  });

  test("Escape closes it and writes nothing; Enter on an empty field writes nothing and previews nothing", async ({
    page,
    stack,
  }) => {
    const { puts, dialog, preview } = await openPrompt(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(preview).toHaveText("");
    await page.keyboard.type("call the dentist");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(puts).toEqual([]);
    // A todo added next lands after any write the Escape sent, so its line shows none came.
    await page.keyboard.press("a");
    await page.keyboard.type("buy milk");
    await page.keyboard.press("Enter");
    const daily = () => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => "");
    await expect.poll(daily).toContain("buy milk");
    expect(await daily()).not.toContain("call the dentist");
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
  expect([group("faraway"), group("farther"), text("rone"), text("rthree")]).toEqual([
    "No date",
    "No date",
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
