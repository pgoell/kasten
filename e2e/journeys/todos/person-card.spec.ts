import type { Page } from "@playwright/test";
import {
  cursorTo,
  findNote,
  leader,
  noteText,
  openApp,
  openNote,
  phone,
  TODO_ROW,
  tapHeight,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const PASCAL = "03 Areas/08 People/Pascal.md";
const ALICIA = "03 Areas/08 People/Alicia.md";
// The todo's words hold no link: only the `👤 [[Pascal]]` field names him.
const NOTES = {
  [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
  "01 Periodic/00 Daily/2026-10-25.md":
    "# 2026-10-25\n\n- [ ] buy paint 👤 [[Pascal]]\n- [ ] fix the gate 👤 [[Alicia]]\n",
  [ALICIA]: "---\ntype: Person\n---\n\n# Alicia\n",
};

/** Opens Pascal's note by its address and returns the card's open todos. */
async function pascalsTodos(page: Page, vault: string) {
  await vaultWith(vault, NOTES);
  await page.goto(`/?note=${encodeURIComponent(PASCAL)}`);
  const todos = page.getByRole("region", { name: "Open todos" });
  // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
  await expect(todos).toBeVisible({ timeout: 15_000 });
  return todos;
}

const listsOnlyHisTodo = async (page: Page, vault: string) => {
  const todos = await pascalsTodos(page, vault);
  // One row: Alicia's todo, the same shape, stays off Pascal's card.
  await expect(todos.getByRole("button")).toHaveText([/buy paint$/]);
};

test("a person note's footer lists the open todo assigned to them by 👤 [[name]], and no one else's", async ({
  page,
  stack,
}) => {
  await listsOnlyHisTodo(page, stack.vault);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a person note's footer lists the open todo assigned to them by 👤 [[name]], and no one else's", async ({
    page,
    stack,
  }) => {
    await listsOnlyHisTodo(page, stack.vault);
  });

  test("a tap on a board card's assignee chip opens the person note", async ({ page, stack }) => {
    const { chip, writes } = await chippedCard(page, stack.vault);
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "board", exact: true }).tap();
    await chip.tap();
    await opensPascal(page, stack.vault, writes, async () => {
      await page.getByRole("button", { name: "Open the todo pane" }).tap();
      await page.getByRole("button", { name: "more for fix the tap" }).tap();
      await page.getByRole("button", { name: "done fix the tap" }).tap();
    });
  });
});

const CHIPS = "02 Projects/Chips.md";
const INVOICE = "- [ ] send the invoice 👤 [[Pascal]] #client";

/** A board card whose assignee has a note, and every write the page sends from here on, by its URL. */
async function chippedCard(page: Page, vault: string) {
  await vaultWith(vault, {
    ...NOTES,
    [CHIPS]: `# Chips\n\n${INVOICE}\n- [ ] fix the tap 👤 Alicia #client\n`,
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url());
  });
  const card = page.locator("[data-card]", { hasText: "send the invoice" });
  const chip = card.locator(`[data-person-path="${PASCAL}"]`);
  return { card, chip, writes };
}

/**
 * The person note fills a tab of its own and the card's note stays shut. Then `tick` checks off the
 * other card for real: todo writes go in turn, so once its two land, a write the chip sent would have too.
 */
async function opensPascal(page: Page, vault: string, writes: string[], tick: () => Promise<void>) {
  await expect(page.getByRole("tab", { name: "Pascal", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content:visible", { hasText: "Pascal" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chips" })).toHaveCount(0);
  await tick();
  await expect
    .poll(() => noteText(vault, CHIPS), { timeout: 15_000 })
    .toMatch(/^- \[x\] fix the tap/m);
  const daily = `01 Periodic/00 Daily/${today()}.md`;
  await expect
    .poll(() => writes.map((url) => decodeURIComponent(url.replace(/^.*\/api\//, ""))))
    .toEqual([`files/${CHIPS}`, `files/${daily}`]);
  expect(await noteText(vault, CHIPS)).toContain(INVOICE);
}

test("a click on a board card's assignee chip opens the person note", async ({ page, stack }) => {
  const { chip, writes } = await chippedCard(page, stack.vault);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "send the invoice" })).toBeVisible();
  await page.keyboard.press("c");
  await chip.click();
  await opensPascal(page, stack.vault, writes, async () => {
    await leader(page, "gt");
    await cursorTo(page, "fix the tap");
    await page.keyboard.press("X");
  });
});

test("a drag that starts on a board card's chip moves the card and opens no note", async ({
  page,
  stack,
}) => {
  const { card, chip } = await chippedCard(page, stack.vault);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "send the invoice" })).toBeVisible();
  await page.keyboard.press("c");
  const lane = await card.evaluate((el) => el.closest("[data-column]")?.getAttribute("data-lane"));
  const from = await chip.boundingBox();
  const to = await page.locator(`[data-column="done"][data-lane="${lane}"]`).boundingBox();
  if (!from || !to) throw new Error("the chip or the done cell is not on the screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => noteText(stack.vault, CHIPS), { timeout: 15_000 })
    .toMatch(/^- \[x\] send the invoice/m);
  await expect(page.getByRole("tab", { name: "Pascal" })).toHaveCount(0);
});

const MAX = "03 Areas/08 People/Max Bosch.md";
const MEETING = "02 Projects/FDE/2026-09-28 FDE Check-in.md";
const MET = "[[Max Bosch]] and me, 20 min";
const CARD = {
  [MAX]: "---\ntype: Person\n---\n\n# Max Bosch\n",
  "03 Areas/08 People/Nobody.md": "---\ntype: Person\n---\n\n# Nobody\n",
  [MEETING]: `# FDE Check-in\n\nagenda\n\n${MET}\n\nnext time\n`,
  "Plain.md": "---\ntype: Note\n---\n\n# Plain\n",
  "01 Periodic/00 Daily/2026-09-30.md":
    "# 2026-09-30\n\n- [ ] send [[Max Bosch]] the repo 📅 2026-10-02\n- [ ] something nobody is named in\n- [ ] call [[Plain]]\n- ✅ 2026-09-29 paired with [[Max Bosch]]\n",
};

/** Opens a note of CARD by its address and returns its footer's three sections. */
async function maxCard(page: Page, vault: string, path = MAX) {
  await vaultWith(vault, CARD);
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  const section = (name: string) => page.getByRole("region", { name });
  return {
    todos: section("Open todos"),
    met: section("Last meetings"),
    done: section("Recently done"),
  };
}

test.describe("the person card", () => {
  test("draws the person's open todos, last meetings and done lines, and no card under a note of another type", async ({
    page,
    stack,
  }) => {
    const { todos, met, done } = await maxCard(page, stack.vault);
    // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
    await expect(todos.getByRole("button")).toHaveText(
      [/send Max Bosch the repo\s*📅 2026-10-02$/],
      {
        timeout: 15_000,
      },
    );
    await expect(met.getByRole("button")).toHaveText(["2026-09-28FDE Check-in"]);
    await expect(done.getByRole("button")).toHaveText(["2026-09-29paired with Max Bosch"]);

    // The todo cache is filled now, so a card the Note would draw shows at once.
    await openNote(page, "Plain");
    await expect(page.locator(".cm-content:visible", { hasText: "Plain" })).toBeVisible();
    await expect(page.getByText("call Plain")).toHaveCount(0);
    await expect(todos).toHaveCount(0);
  });

  test("a click on a row opens the note it names with the cursor on that line", async ({
    page,
    stack,
  }) => {
    const { met } = await maxCard(page, stack.vault);
    await met.getByRole("button", { name: /FDE Check-in/ }).click({ timeout: 15_000 });
    await expect(
      page.getByRole("tab", { name: "2026-09-28 FDE Check-in", selected: true }),
    ).toBeVisible();
    await expect(page.locator(".cm-content:focus .cm-activeLine")).toHaveText(
      "Max Bosch and me, 20 min",
    );
  });

  test("a person nothing links gets the sentence that says how the card fills", async ({
    page,
    stack,
  }) => {
    await maxCard(page, stack.vault, "03 Areas/08 People/Nobody.md");
    await expect(
      page.getByText("nothing links [[Nobody]] yet. Write the link into a todo and it shows here."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /open todos|last meetings|recently done/ }),
    ).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("every row of the card is at least 44 px tall", async ({ page, stack }) => {
      const { todos } = await maxCard(page, stack.vault);
      await expect(todos).toBeVisible({ timeout: 15_000 });
      const rows = page.locator("section[aria-label] button");
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) expect(await tapHeight(row)).toBeGreaterThanOrEqual(44);
    });
  });
});

const CHORES = "02 Projects/Chores.md";
const CHORE_LINES = [
  "- [ ] buy paint 👤 [[Pascal]]",
  "- [/] mend the fence 👤 [[Alicia]]",
  "- [w] hang the door 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]]",
  "- [ ] paint the hall 👤 [[03 Areas/08 People/Pascal]]",
  "- [ ] wash the car 👤 [[Pascal|P]]",
  "- [ ] sweep the yard 👤 [[Nobody]]",
  "- [ ] rake the leaves 👤 Alicia",
];

/** The todo pane over Chores.md on 2026-10-25, five days after the waiting row was written. */
async function chorePane(page: Page, vault: string) {
  await vaultWith(vault, {
    [PASCAL]: NOTES[PASCAL],
    [ALICIA]: NOTES[ALICIA],
    [CHORES]: `# Chores\n\n${CHORE_LINES.join("\n")}\n`,
  });
  await page.clock.setFixedTime(new Date("2026-10-25T12:00:00"));
  const row = (words: string) => page.locator(TODO_ROW, { hasText: words });
  return { row, chip: (words: string) => row(words).locator("[data-person]") };
}
const body = async (vault: string) =>
  (await noteText(vault, CHORES)).replace(/^---\n[\s\S]*?\n---\n/, "");

test.describe("the assignee chip on a todo pane row", () => {
  test("names the person on open, doing and waiting rows, an alias by its words, and links only a name with a note", async ({
    page,
    stack,
  }) => {
    const { row, chip } = await chorePane(page, stack.vault);
    await openApp(page);
    await leader(page, "gt");
    await expect(chip("buy paint")).toHaveText("Pascal");
    await expect(chip("mend the fence")).toHaveText("Alicia");
    await expect(chip("hang the door")).toHaveText("Pascal");
    await expect(row("hang the door")).toContainText("👤 5d Alicia");
    await expect(chip("paint the hall")).toHaveText("Pascal");
    await expect(chip("wash the car")).toHaveText("P");
    for (const words of ["buy paint", "hang the door", "paint the hall", "wash the car"])
      await expect(chip(words)).toHaveAttribute("data-person-path", PASCAL);
    await expect(chip("sweep the yard")).toHaveText("Nobody");
    await expect(chip("rake the leaves")).toHaveText("Alicia");
    await expect(chip("sweep the yard")).not.toHaveAttribute("data-person-path");
    await expect(chip("rake the leaves")).not.toHaveAttribute("data-person-path");
  });

  test("a click on a chip opens the person note by name, path or alias, and on a row or an unlinked chip the todo's note", async ({
    page,
    stack,
  }) => {
    const { row, chip } = await chorePane(page, stack.vault);
    await openApp(page);
    const opens = async (click: () => Promise<void>, tab: string, line?: string) => {
      await leader(page, "gt");
      await click();
      await expect(page.getByRole("tab", { name: tab, selected: true })).toBeVisible();
      if (line) await expect(page.locator(".cm-content:focus .cm-activeLine")).toContainText(line);
    };
    await opens(() => chip("buy paint").click(), "Pascal");
    await expect(page.getByRole("tab", { name: "Chores" })).toHaveCount(0);
    await opens(() => row("buy paint").click(), "Chores", "buy paint");
    await opens(() => chip("paint the hall").click(), "Pascal");
    await opens(() => chip("rake the leaves").click(), "Chores", "rake the leaves");
    await opens(() => chip("wash the car").click(), "Pascal");
    await opens(() => chip("sweep the yard").click(), "Chores", "sweep the yard");
    await expect(page.getByRole("tab", { name: "Nobody" })).toHaveCount(0);
  });

  test("a click on a chip while picking a blocker picks that chip's row and opens no note", async ({
    page,
    stack,
  }) => {
    const { chip } = await chorePane(page, stack.vault);
    await openApp(page);
    await leader(page, "gt");
    await cursorTo(page, "buy paint");
    await page.keyboard.press("b");
    await expect(page.getByTestId("todo-pick")).toBeVisible();
    await chip("mend the fence").click();
    await expect.poll(() => body(stack.vault)).toMatch(/buy paint 👤 \[\[Pascal\]\] ⛔ kt-\w{6}\n/);
    const id = (await body(stack.vault)).match(/⛔ (kt-\w{6})/)?.[1];
    expect(await body(stack.vault)).toContain(`- [/] mend the fence 👤 [[Alicia]] 🆔 ${id}\n`);
    await expect(page.getByRole("tab", { name: /Alicia|Chores/ })).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on a chip opens the person note and sets no state on its row", async ({
      page,
      stack,
    }) => {
      const { chip } = await chorePane(page, stack.vault);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET" && request.url().includes("/api/"))
          writes.push(request.url());
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
      await chip("buy paint").tap();
      await expect(page.getByRole("tab", { name: "Pascal", selected: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Chores" })).toHaveCount(0);
      // One real tick last: todo writes go in turn, so a write the tap sent would land first.
      await page.getByRole("button", { name: "Open the todo pane" }).tap();
      await page.getByRole("button", { name: "more for rake the leaves" }).tap();
      await page.getByRole("button", { name: "done rake the leaves" }).tap();
      await expect
        .poll(() => body(stack.vault), { timeout: 15_000 })
        .toMatch(/^- \[x\] rake the leaves/m);
      expect(writes.map((url) => decodeURIComponent(url.replace(/^.*\/api\//, "")))).toEqual([
        `files/${CHORES}`,
        "files/01 Periodic/00 Daily/2026-10-25.md",
      ]);
      expect(await body(stack.vault)).toContain(`\n${CHORE_LINES[0]}\n`);
    });
  });
});

test.describe("the name place after a field that takes the 👤 (#1021)", () => {
  const PLACE = "02 Projects/Place.md";
  const DAY = "2026-10-25";
  const MARKS = { kettle: "⏲", lamp: "⏱", mop: "🆔", nail: "⛔" };
  const waiting = (words: string, mark: string) => `- [w] ${words} ${mark} 👤 ${DAY} 👤 ${DAY}`;
  const named = (words: string, mark: string) => `- [w] ${words} 👤 ${DAY} Zoe ${mark} 👤 ${DAY}`;
  const placeBody = async (vault: string) =>
    (await noteText(vault, PLACE)).replace(/^---\n[\s\S]*?\n---\n/, "");

  /** Place.md with a todo per mark, open or already waiting, on `DAY`. */
  async function placeNote(
    page: Page,
    vault: string,
    line: (words: string, mark: string) => string,
  ) {
    const lines = Object.entries(MARKS).map(([words, mark]) => line(words, mark));
    await vaultWith(vault, { [PLACE]: `# Place\n\n${lines.join("\n")}\n` });
    await page.clock.setFixedTime(new Date(`${DAY}T12:00:00`));
  }

  test("Space s w puts the cursor after the wait stamp it wrote, so a name typed there follows the stamp", async ({
    page,
    stack,
  }) => {
    await placeNote(page, stack.vault, (words, mark) => `- [ ] ${words} ${mark} 👤 ${DAY}`);
    await openApp(page);
    await findNote(page, "Place");
    for (const words of Object.keys(MARKS)) {
      await page.keyboard.press("/");
      await page.keyboard.type(words);
      await page.keyboard.press("Enter");
      await leader(page, "sw");
      await page.keyboard.press("a");
      await page.keyboard.type(" Zoe");
      await page.keyboard.press("Escape");
    }
    const want = Object.entries(MARKS).map(([words, mark]) => named(words, mark));
    await expect.poll(() => placeBody(stack.vault), { timeout: 15_000 }).toContain(want.join("\n"));
  });

  /** A stamp with a field after it and one at the line's end, `vim` on or off. */
  async function plumber(page: Page, vault: string, vim: string) {
    await page.addInitScript((on) => localStorage.setItem("kasten.vim", on), vim);
    await vaultWith(vault, { [PLACE]: `- [ ] kettle ⏲ 👤 ${DAY}\n- [ ] call the plumber\n` });
    await page.clock.setFixedTime(new Date(`${DAY}T12:00:00`));
    await page.goto(`/?note=${encodeURIComponent(PLACE)}`);
  }
  const plumbed = `- [w] kettle 👤 ${DAY} Zoe ⏲ 👤 ${DAY}\n- [w] call the plumber 👤 ${DAY} Zoe`;

  /** Clicks the line, presses `keys`, then runs the palette's waiting by keys. */
  async function paletteWaits(page: Page, words: string, ...keys: string[]) {
    await page.locator(".cm-line", { hasText: words }).click({ timeout: 15_000 });
    for (const key of [...keys, "Control+Shift+P"]) await page.keyboard.press(key);
    await page.keyboard.type("Set this todo to waiting on somebody");
    await page.keyboard.press("Enter");
  }

  test("with vim off, the palette's waiting puts the cursor after the wait stamp (#2094)", async ({
    page,
    stack,
  }) => {
    await plumber(page, stack.vault, "off");
    await paletteWaits(page, "kettle");
    await page.keyboard.type(" Zoe");
    await paletteWaits(page, "call the plumber");
    await page.keyboard.type(" Zoe");
    await expect.poll(() => placeBody(stack.vault), { timeout: 15_000 }).toContain(plumbed);
  });

  // Normal mode leaves the cursor on the last digit for `a`; insert mode types at the caret.
  test("with vim on, the palette's waiting then a, or in insert mode, puts the name after the stamp", async ({
    page,
    stack,
  }) => {
    await plumber(page, stack.vault, "on");
    await paletteWaits(page, "kettle", "Escape");
    await page.keyboard.type("a Zoe");
    await paletteWaits(page, "call the plumber", "Escape", "i");
    await page.keyboard.type(" Zoe");
    await expect.poll(() => placeBody(stack.vault), { timeout: 15_000 }).toContain(plumbed);
  });

  test("i in the todo pane on a waiting row puts the caret after the wait stamp", async ({
    page,
    stack,
  }) => {
    await placeNote(page, stack.vault, waiting);
    await openApp(page);
    await leader(page, "gt");
    const input = page.getByLabel("edit line");
    for (const [words, mark] of Object.entries(MARKS)) {
      await cursorTo(page, words);
      await page.keyboard.press("i");
      await expect(input).toHaveValue(waiting(words, mark));
      await expect
        .poll(() => input.evaluate((field: HTMLInputElement) => field.selectionStart))
        .toBe(waiting(words, mark).length);
      await page.keyboard.press("Escape");
      await expect(input).toHaveCount(0);
    }
  });
});
