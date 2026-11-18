import type { Page } from "@playwright/test";
import { cursorTo, leader, openApp, plus, readAll, today, vaultWith } from "../../harness/app.ts";
import { expect, type Stack, test } from "../../harness/stack.ts";

const notice = (page: Page) => page.getByTestId("notice");

interface Row {
  id: string;
  words: string;
  state: string;
  note: string;
  blocked_by: string[];
  version: number;
}

/** The store's row of the todo whose words are `words`. */
async function rowOf(stack: Stack, words: string): Promise<Row> {
  const rows: Row[] = await (await fetch(`${stack.url}/api/todos/rows`)).json();
  const row = rows.find((each) => each.words === words);
  if (row === undefined) throw new Error(`no todo says ${words}`);
  return row;
}

/** The running sessions, as the `## Time` lines `GET /api/todos` draws them. */
async function sessions(stack: Stack): Promise<string[]> {
  const hits: { line: number; text: string }[] = await (
    await fetch(`${stack.url}/api/todos`)
  ).json();
  return hits.filter((hit) => hit.line > 100_000).map((hit) => hit.text);
}

/** The todo pane over `note` as Waits.md, once the row of `last` is drawn. */
async function paneOver(page: Page, vault: string, note: string, last: string) {
  await vaultWith(vault, { "Waits.md": note });
  await openApp(page);
  await leader(page, "gt");
  await expect(at(page, last)).toBeVisible();
}
/** The row of `words` in Waits.md, by its name after its state, priority and client mark: a row names its blocker's words too. */
const at = (page: Page, words: string) =>
  page
    .getByRole("button", { name: new RegExp(`^(\\S+ ){1,3}${words}`) })
    .and(page.locator('[data-row^="Waits.md:"]'));

test("b in the todo pane picking a blocker the todo names already keeps the picker and writes nothing", async ({
  page,
  stack,
}) => {
  const note = "- [b] write the docs ⛔ kt-c0ffee\n- [ ] ship the release 🆔 kt-c0ffee\n";
  await paneOver(page, stack.vault, note, "ship the release");
  const before = await rowOf(stack, "write the docs");
  await cursorTo(page, "write the docs");
  await page.keyboard.press("b");
  await cursorTo(page, "ship the release", 1);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("todo-pick")).toHaveText("⛔ pick what blocks: write the docs");
  expect(await rowOf(stack, "write the docs")).toEqual(before);
});

test("the todo pane says on a row what it waits for and how many wait for it", async ({
  page,
  stack,
}) => {
  const note = [
    "- [/] ship the release 🆔 kt-000001",
    "- [b] write the docs ⛔ kt-000001",
    "- [b] write the post ⛔ kt-000001 ⛔ kt-ffffff",
    "- [ ] tag it ⛔ kt-000002",
    `- [x] cut the branch ✅ ${today()} 🆔 kt-000002`,
  ];
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, "tag it");
  await expect(at(page, "ship the release")).toContainText("→ 2");
  await expect(at(page, "write the docs")).toContainText("⛔ ship the release");
  // Two blockers are a count, and the title names both, one to a line.
  await expect(at(page, "write the post")).toContainText("⛔ 2");
  await expect(
    at(page, "write the post").getByTitle("waits for:\nship the release\nkt-ffffff"),
  ).toHaveCount(1);
  // A blocker already closed holds nothing.
  await expect(at(page, "tag it")).not.toContainText("⛔");
});

const NEXT_YEAR = `${new Date().getFullYear() + 1}-03-01`;
/** The todo pane's group headings, each with its count, in the order drawn. */
const headings = (page: Page) => page.getByRole("heading").allTextContents();

test("the todo pane draws one heading per group in order with its count, a todo under its scheduled day, and leaves out what is not work yet", async ({
  page,
  stack,
}) => {
  const note = [
    `- [ ] pay the fine 📅 ${plus(-3)}`,
    `- [ ] buy milk 📅 ${plus(3)} ⏳ ${plus(0)}`,
    `- [ ] call the dentist 📅 ${plus(0)} 🛫 ${plus(0)}`,
    `- [ ] file the tax 📅 ${plus(3)}`,
    `- [ ] renew the passport 📅 ${NEXT_YEAR}`,
    `- [ ] wait for spring 📅 ${plus(3)} 🛫 ${plus(1)}`,
    `- [x] read the spec ✅ ${plus(0)}`,
    "## Time",
    "- 09:12-10:32 wire up the pane",
  ];
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, "renew the passport");
  // Today holds the scheduled milk and the started dentist. The import gave the fixture vault's
  // undated todos a soft due day two weeks out, so they join the passport in Later.
  await expect
    .poll(() => headings(page))
    .toEqual([
      "Overdue 1",
      "Today 2",
      "This week 1",
      expect.stringMatching(/^Later \d+$/),
      "›Done this week 1",
    ]);
  // A date in this year drops its year; one outside it keeps it.
  await expect(at(page, "call the dentist")).toContainText(plus(0).slice(5));
  await expect(at(page, "call the dentist")).not.toContainText(plus(0));
  await expect(at(page, "renew the passport")).toContainText(NEXT_YEAR);
  // Not work yet, finished, or no todo at all.
  await expect(at(page, "wait for spring")).toHaveCount(0);
  await expect(at(page, "read the spec")).toHaveCount(0);
  await expect(at(page, "wire up the pane")).toHaveCount(0);
});

test("the todo pane puts higher priority first in a group, client work first within one, parts under their todo, and marks each", async ({
  page,
  stack,
}) => {
  const t = `📅 ${plus(0)}`;
  const note = [
    `- [ ] buy milk ${t} 🔽`,
    `- [ ] file the tax ${t}`,
    `- [ ] call the dentist ${t} 🔺`,
    `  - [ ] find the number ${t} ⏬`,
    `- [ ] tidy the wiki ${t} ⏫`,
    `- [ ] send the offer #client ${t}`,
    "  - [ ] check the numbers",
    `- [ ] review the draft #client ${t} ⏫`,
  ];
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, "review the draft");
  const order = [
    "call the dentist",
    "find the number",
    "review the draft",
    "tidy the wiki",
    "send the offer",
    "check the numbers",
    "file the tax",
    "buy milk",
  ];
  const rows = await readAll(page, '[data-row^="Waits.md:"]', (all) =>
    all.map((row) => row.textContent ?? ""),
  );
  const words = rows.map((text) => order.find((each) => text.includes(each)));
  expect(words).toEqual(order);
  const text = Object.fromEntries(rows.map((row, i) => [words[i], row])) as Record<string, string>;
  // Client work and its part carry the mark, nothing else; a row draws its own priority.
  const client = ["review the draft", "send the offer", "check the numbers"];
  expect(order.map((each) => text[each]?.includes("◆"))).toEqual(
    order.map((each) => client.includes(each)),
  );
  expect([text["call the dentist"], text["buy milk"], text["find the number"]]).toEqual([
    expect.stringContaining("🔺"),
    expect.stringContaining("🔽"),
    expect.stringContaining("⏬"),
  ]);
  expect(text["file the tax"]).not.toMatch(/[🔺⏫🔼🔽⏬]/u);
  // Groups with no rows draw no heading.
  await expect
    .poll(() => headings(page))
    .toEqual(["Today 8", expect.stringMatching(/^Later \d+$/)]);
});

test.describe("a key straight after an x, before the x's write answers (#2084)", () => {
  const TOMATOES = "water the tomatoes";
  const PLAN = "02 Projects/FDE/plan.md";

  /** `x` on the row of `words`, with every store write on its todo held until `release`. */
  async function pressX(page: Page, stack: Stack, words = TOMATOES) {
    const { id } = await rowOf(stack, words);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname.startsWith(`/api/todos/${id}/`),
      async (route) => {
        if (route.request().method() !== "GET") await gate;
        await route.fallback();
      },
    );
    await openApp(page);
    await leader(page, "gt");
    await cursorTo(page, words);
    await page.keyboard.press("x");
    return release;
  }

  test("@ hands the todo the x walked to the agent", async ({ page, stack }) => {
    const release = await pressX(page, stack);
    await page.keyboard.press("@");
    release();
    await expect
      .poll(async () => {
        const row = await rowOf(stack, `${TOMATOES} #agent`).catch(() => null);
        return row?.state;
      })
      .toBe("doing");
    await expect(notice(page)).toHaveCount(0);
  });

  test("i writes the edit onto the todo the x walked", async ({ page, stack }) => {
    const release = await pressX(page, stack);
    // The row as drawn: an `i` opened in the same frame as the `x` is typed over the old words, and writes nothing.
    await expect(page.getByRole("button", { name: `doing ${TOMATOES}` })).toBeVisible();
    await page.keyboard.press("i");
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    await page.keyboard.press("Enter");
    release();
    await expect
      .poll(async () => (await rowOf(stack, `${TOMATOES} now`).catch(() => null))?.state)
      .toBe("doing");
  });

  test("b makes the todo the x walked wait on the one picked", async ({ page, stack }) => {
    const laundry = await rowOf(stack, "fold the laundry");
    const release = await pressX(page, stack);
    await page.keyboard.press("b");
    await cursorTo(page, "fold the laundry");
    await page.keyboard.press("Enter");
    release();
    await expect
      .poll(async () => {
        const row = await rowOf(stack, TOMATOES);
        return [row.state, row.blocked_by];
      })
      .toEqual(["doing", [laundry.id]]);
    await expect(notice(page)).toHaveCount(0);
  });

  test("m moves the todo the x walked into its project's note", async ({ page, stack }) => {
    await vaultWith(stack.vault, { [PLAN]: "# Plan\n\n- [ ] ship the deck\n" });
    const release = await pressX(page, stack, "ship the deck");
    await page.keyboard.press("m");
    release();
    await expect(notice(page)).toContainText("Moved into 02 Projects/FDE/index.md");
    const row = await rowOf(stack, "ship the deck");
    expect([row.state, row.note]).toEqual(["doing", "02 Projects/FDE/index.md"]);
  });
});

test.describe("with vim off, a key straight after an x (#2084)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("t starts a session on the todo the x walked", async ({ page, stack }) => {
    await openApp(page);
    // The palette, since the leader is vim's.
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
    await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
    await page.keyboard.press("x");
    await page.keyboard.press("t");
    await expect
      .poll(() => sessions(stack))
      .toEqual([expect.stringMatching(/^- \d\d:\d\d- water the tomatoes kt-/)]);
    expect((await rowOf(stack, "water the tomatoes")).state).toBe("doing");
    await expect(notice(page)).toHaveCount(0);
  });
});
