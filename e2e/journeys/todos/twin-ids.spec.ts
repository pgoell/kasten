import type { Page } from "@playwright/test";
import {
  cursorTo,
  findNote,
  leader,
  localDate,
  noteText,
  openApp,
  phone,
  readAll,
  TODO_ROW,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// Two todo lines carrying one 🆔, as a pasted copy leaves them, and a todo waiting on that id.
const LINE = "- [/] twin task 🆔 kt-aaaaaa";
const NOTES = {
  "Twins.md": `${LINE}\n${LINE}\n`,
  "Deps.md": "- [b] wait on the twin ⛔ kt-aaaaaa\n",
};
const notice = (page: Page) => page.getByTestId("notice");
const daily = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

/** What a press names: the other twin's 1-based line in `path` as the disk now has it. */
async function names(vault: string, path: string, words: string, nth: number) {
  const lines = (await noteText(vault, path)).split("\n");
  const at = lines.map((line, i) => (line.includes(words) ? i + 1 : 0)).filter((i) => i > 0);
  return `Nothing moved: 🆔 kt-aaaaaa is on another todo too: ${path} line ${at[nth]}`;
}

/** Twins, Deps and today's note as the disk holds them, to show a press wrote nothing. */
const disk = async (vault: string) => [
  await noteText(vault, "Twins.md"),
  await noteText(vault, "Deps.md"),
  await daily(vault),
];

// A todo, an open blocker carrying an id, and that blocker's done twin in another note.
const BLOCKING = {
  "Block.md": "- [ ] write the docs\n- [ ] ship the release 🆔 kt-aaaaaa\n",
  "Twins.md": "- [x] ship the release 🆔 kt-aaaaaa\n",
};
const blockDisk = async (vault: string) => [
  await noteText(vault, "Block.md"),
  await noteText(vault, "Twins.md"),
];

/** The todo pane over the twins, its cursor on the second. */
async function paneOnSecond(page: Page, vault: string) {
  await vaultWith(vault, NOTES);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "twin task" })).toHaveCount(2);
  await cursorTo(page, "twin task", 1);
}

// One test per key, so each starts with no notice and the notice read is its own.
for (const key of ["t", "X"]) {
  test(`${key} in the todo pane on the second of two twins writes nothing and names the first`, async ({
    page,
    stack,
  }) => {
    await paneOnSecond(page, stack.vault);
    const before = await disk(stack.vault);
    const first = await names(stack.vault, "Twins.md", "twin task", 0);
    await expect(notice(page)).toHaveCount(0);
    await page.keyboard.press(key);
    await expect
      .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
      .toEqual([first, ...before]);
  });
}

test("t in the todo pane says Nothing moved and why when its search fails, and writes nothing", async ({
  page,
  stack,
}) => {
  await page.route("**/api/search?**", (route) =>
    route.request().url().includes("kt-aaaaaa")
      ? route.fulfill({ status: 500, json: { detail: "refused by the test" } })
      : route.fallback(),
  );
  await paneOnSecond(page, stack.vault);
  const before = await disk(stack.vault);
  await page.keyboard.press("t");
  await expect
    .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
    .toEqual([expect.stringMatching(/^Nothing moved: .*500/), ...before]);
});

test("<leader>x on a twin cycles its own line on disk, logs and unblocks nothing, and names the other", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, NOTES);
  await openApp(page);
  await findNote(page, "Twins");
  const deps = await noteText(stack.vault, "Deps.md");
  const second = await names(stack.vault, "Twins.md", "twin task", 1);
  await leader(page, "x");
  await expect
    .poll(
      async () => [
        await notice(page).textContent(),
        (await noteText(stack.vault, "Twins.md")).includes("- [x] twin task ✅"),
        await noteText(stack.vault, "Deps.md"),
        (await daily(stack.vault)).includes("twin task"),
      ],
      { timeout: 15_000 },
    )
    .toEqual([second, true, deps, false]);
});

test("<leader>x in today's note on a todo whose 🆔 another note carries moves only its line", async ({
  page,
  stack,
}) => {
  const path = `01 Periodic/00 Daily/${today()}.md`;
  await vaultWith(stack.vault, {
    [path]: "- [/] daily twin 🆔 kt-aaaaaa\n- [b] daily wait ⛔ kt-aaaaaa\n\n## Done\n",
    "Twin elsewhere.md": "- [/] far twin 🆔 kt-aaaaaa\n",
  });
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  await expect(page.locator(".cm-content", { hasText: "daily twin" })).toBeVisible({
    timeout: 15_000,
  });
  // The press asks the page's listing of the todos, so the todos panel reads one first.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await leader(page, "ft");
  await expect(
    page.getByRole("dialog", { name: "Todos" }).getByRole("option").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".cm-line", { hasText: "daily twin" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  const other = await names(stack.vault, "Twin elsewhere.md", "far twin", 0);
  await leader(page, "x");
  await expect
    .poll(async () => [await notice(page).textContent(), await daily(stack.vault)], {
      timeout: 15_000,
    })
    .toEqual([
      other,
      expect.stringMatching(
        /- \[x\] daily twin ✅ \S+ 🆔 kt-aaaaaa\n- \[b\] daily wait ⛔ kt-aaaaaa\n\n## Done\n$/,
      ),
    ]);
});

test("b in the todo pane picking a twinned blocker writes nothing and names the other", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, BLOCKING);
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "write the docs");
  const before = await blockDisk(stack.vault);
  const other = await names(stack.vault, "Twins.md", "ship the release", 0);
  await page.keyboard.press("b");
  await cursorTo(page, "ship the release");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => [await notice(page).textContent(), ...(await blockDisk(stack.vault))])
    .toEqual([other, ...before]);
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("the palette's cycle on a twin cycles its own line, logs nothing and names the other", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, NOTES);
    await page.goto("/?note=Twins.md");
    await expect(page.locator(".cm-content", { hasText: "twin task" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator(".cm-line", { hasText: "twin task" }).first().click();
    const second = await names(stack.vault, "Twins.md", "twin task", 1);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Cycle the todo on this line/ }).click();
    await expect
      .poll(
        async () => [
          await notice(page).textContent(),
          (await noteText(stack.vault, "Twins.md")).includes("- [x] twin task ✅"),
          (await daily(stack.vault)).includes("twin task"),
        ],
        { timeout: 15_000 },
      )
      .toEqual([second, true, false]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  for (const action of ["timer", "done"]) {
    test(`the strip's ${action} on the second of two twins writes nothing and names the first`, async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, NOTES);
      await page.goto("/");
      await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
      await expect(page.getByLabel("more for twin task")).toHaveCount(2);
      const before = await disk(stack.vault);
      const first = await names(stack.vault, "Twins.md", "twin task", 0);
      await page.getByLabel("more for twin task").nth(1).tap();
      await page.getByLabel(`${action} twin task`).tap();
      await expect
        .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
        .toEqual([first, ...before]);
    });
  }

  test("the menu's blocked by picking a twinned blocker writes nothing and names the other", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, BLOCKING);
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    const before = await blockDisk(stack.vault);
    const other = await names(stack.vault, "Twins.md", "ship the release", 0);
    await page.getByLabel("more for write the docs").tap();
    await page.getByLabel("blocked by write the docs").tap();
    await page.getByRole("button", { name: "ship the release", exact: true }).first().tap();
    await expect
      .poll(async () => [await notice(page).textContent(), ...(await blockDisk(stack.vault))])
      .toEqual([other, ...before]);
  });
});

/** The todo pane over `note` as Waits.md, once its row on line `last` is drawn. */
async function paneOver(page: Page, vault: string, note: string, last: number) {
  await vaultWith(vault, { "Waits.md": note });
  await openApp(page);
  await leader(page, "gt");
  await expect(at(page, last)).toBeVisible();
}
const at = (page: Page, line: number) => page.locator(`[data-row="Waits.md:${line}"]`);

test("b in the todo pane picking a blocker the todo names already keeps the picker and writes nothing", async ({
  page,
  stack,
}) => {
  const note = "- [b] write the docs ⛔ kt-c0ffee\n- [ ] ship the release 🆔 kt-c0ffee\n";
  await paneOver(page, stack.vault, note, 2);
  await cursorTo(page, "write the docs");
  await page.keyboard.press("b");
  await cursorTo(page, "ship the release", 1);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("todo-pick")).toHaveText("⛔ pick what blocks: write the docs");
  expect((await noteText(stack.vault, "Waits.md")).replace(/^---\n[\s\S]*?\n---\n/, "")).toBe(note);
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
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, 4);
  await expect(at(page, 1)).toContainText("→ 2");
  await expect(at(page, 2)).toContainText("⛔ ship the release");
  // Two blockers are a count, and the title names both, one to a line.
  await expect(at(page, 3)).toContainText("⛔ 2");
  await expect(at(page, 3).getByTitle("waits for:\nship the release\nkt-ffffff")).toHaveCount(1);
  // A blocker already closed holds nothing.
  await expect(at(page, 4)).not.toContainText("⛔");
});

test("#541 the todo pane holds a row on an id an open and a done todo carry, the open one first", async ({
  page,
  stack,
}) => {
  const note = `- [ ] ship the release 🆔 kt-aaaaaa\n- [x] cut the branch ✅ ${today()} 🆔 kt-aaaaaa\n- [b] write the docs ⛔ kt-aaaaaa\n`;
  await paneOver(page, stack.vault, note, 3);
  await expect(at(page, 3)).toContainText("⛔ kt-aaaaaa");
  await expect(at(page, 1)).toContainText("→ 1");
  await expect(at(page, 3).getByTitle("waits for:\nkt-aaaaaa")).toHaveCount(1);
  await expect(page.getByTitle(/cut the branch/)).toHaveCount(0);
});

test("#544 the todo pane holds no row on an id whose two todos are both closed", async ({
  page,
  stack,
}) => {
  const note = `- [x] a ✅ ${today()} 🆔 kt-aaaaaa\n- [-] a ❌ ${today()} 🆔 kt-aaaaaa\n- [b] chase it ⛔ kt-aaaaaa\n`;
  await paneOver(page, stack.vault, note, 3);
  await expect(at(page, 3)).not.toContainText("⛔");
  await expect(page.getByTitle(/waits for/)).toHaveCount(0);
});

/** `days` after today, as the vault writes a date. */
const plus = (days: number) => localDate(new Date(Date.now() + days * 86_400_000));
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
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, 5);
  // Today holds the scheduled milk and the started dentist; the fixture vault's own todos have no date.
  await expect
    .poll(() => headings(page))
    .toEqual([
      "Overdue 1",
      "Today 2",
      "This week 1",
      "Later 1",
      expect.stringMatching(/^No date \d+$/),
      "›Done this week 1",
    ]);
  // A date in this year drops its year; one outside it keeps it.
  await expect(at(page, 3)).toContainText(plus(0).slice(5));
  await expect(at(page, 3)).not.toContainText(plus(0));
  await expect(at(page, 5)).toContainText(NEXT_YEAR);
  // Not work yet, finished, or no todo at all.
  await expect(at(page, 6)).toHaveCount(0);
  await expect(at(page, 7)).toHaveCount(0);
  await expect(at(page, 9)).toHaveCount(0);
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
  await paneOver(page, stack.vault, `${note.join("\n")}\n`, 8);
  const order = [3, 4, 8, 5, 6, 7, 2, 1];
  const rows = await readAll(page, '[data-row*="Waits.md:"]', (all) =>
    all.map((row) => [Number(row.getAttribute("data-row")?.split(":")[1]), row.textContent ?? ""]),
  );
  expect(rows.map(([line]) => line)).toEqual(order);
  const text = Object.fromEntries(rows) as Record<number, string>;
  // Client work and its part carry the mark, nothing else; a row draws its own priority.
  expect(order.map((line) => text[line]?.includes("◆"))).toEqual(
    order.map((l) => [8, 6, 7].includes(l)),
  );
  expect([text[3], text[1], text[4]]).toEqual([
    expect.stringContaining("🔺"),
    expect.stringContaining("🔽"),
    expect.stringContaining("⏬"),
  ]);
  expect(text[2]).not.toMatch(/[🔺⏫🔼🔽⏬]/u);
  // Groups with no rows draw no heading.
  await expect
    .poll(() => headings(page))
    .toEqual(["Today 8", expect.stringMatching(/^No date \d+$/)]);
});

test.describe("a key straight after an x, on a note's first save (#2084)", () => {
  const GARDEN = "02 Projects/Garden.md";
  const PLAN = "02 Projects/FDE/plan.md";
  const garden = (vault: string) => noteText(vault, GARDEN);

  /** `x` on the row of `words`, with every save of `path` held until `release`. */
  async function pressX(page: Page, path = GARDEN, words = "water the tomatoes") {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${path}`,
      async (route) => {
        if (route.request().method() === "PUT") await gate;
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
    const release = await pressX(page);
    await page.keyboard.press("@");
    release();
    await expect.poll(() => garden(stack.vault)).toMatch(/^- \[\/\] water the tomatoes.*#agent/m);
    await expect(notice(page)).toHaveCount(0);
  });

  test("i writes the edit onto the line the x wrote", async ({ page, stack }) => {
    const release = await pressX(page);
    // The row as drawn: an `i` opened in the same frame as the `x` is typed over the old words, and writes nothing.
    await expect(page.getByRole("button", { name: "doing water the tomatoes" })).toBeVisible();
    await page.keyboard.press("i");
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    await page.keyboard.press("Enter");
    release();
    await expect.poll(() => garden(stack.vault)).toMatch(/^- \[\/\] water the tomatoes now$/m);
  });

  test("b writes the ⛔ onto the line the x wrote", async ({ page, stack }) => {
    const release = await pressX(page);
    await page.keyboard.press("b");
    await cursorTo(page, "fold the laundry");
    await page.keyboard.press("Enter");
    release();
    await expect.poll(() => garden(stack.vault)).toMatch(/^- \[\/\] water the tomatoes ⛔ kt-\w+$/m);
    await expect(notice(page)).toHaveCount(0);
  });

  test("m moves the todo the x walked into its project's note", async ({ page, stack }) => {
    await vaultWith(stack.vault, { [PLAN]: "# Plan\n\n- [ ] ship the deck\n" });
    const release = await pressX(page, PLAN, "ship the deck");
    await page.keyboard.press("m");
    release();
    await expect(notice(page)).toContainText("Moved into 02 Projects/FDE/index.md");
    expect(await noteText(stack.vault, "02 Projects/FDE/index.md")).toMatch(/^- \[\/\] ship the deck$/m);
    expect(await noteText(stack.vault, PLAN)).not.toMatch(/^- \[.\] ship the deck/m);
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
    await expect.poll(() => daily(stack.vault).catch(() => "")).toMatch(/^- \d\d:\d\d-.*water the tomatoes/m);
    await expect(notice(page)).toHaveCount(0);
  });
});
