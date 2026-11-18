import type { Locator, Page } from "@playwright/test";
import {
  barsOf,
  findNote,
  leader,
  noteText,
  openApp,
  phone,
  plus,
  recordEvents,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const dailyText = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

test("a beer logged in the log pane shows as an entry and lands under ## Log in today's note", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane).toBeVisible();
  await pane.getByRole("button", { name: "Log alcohol" }).click();
  await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
  await expect
    .poll(() => dailyText(stack.vault), {
      timeout: 15_000,
    })
    .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a beer tapped in the log pane opened from the palette lands under ## Log in today's note", async ({
    page,
    stack,
  }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Open the log/ }).tap();
    const pane = page.getByRole("region", { name: "Log" });
    await pane.getByRole("button", { name: "Log alcohol" }).tap();
    await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
    await expect
      .poll(() => dailyText(stack.vault), { timeout: 15_000 })
      .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
  });
});

const LOG_CONFIG = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1\n- ⚖ weight: kg, last\n";
const PAST = "01 Periodic/00 Daily/2026-10-20.md";
const PAST_NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write\n";

/** Runs the palette's Log weight row, which the config note's `last` kind adds. */
async function logWeight(page: Page): Promise<void> {
  await leader(page, ":");
  await page.getByRole("option", { name: /^Log weight/ }).click();
}

test.describe("the palette's Log weight", () => {
  test.beforeEach(async ({ stack }) => {
    await vaultWith(stack.vault, { "99 Misc/01 Config/log.md": LOG_CONFIG, [PAST]: PAST_NOTE });
  });

  // A past day, so the palette's own ask on the card acts and not the hand-off to today's note.
  test("over a daily note's card asks on that card and writes no line", async ({ page, stack }) => {
    await openApp(page);
    await findNote(page, "2026-10-20");
    const card = page.locator(".cm-log:visible");
    await expect(card.getByRole("button", { name: "Log weight" })).toBeVisible();
    await logWeight(page);
    await expect(card.locator(".cm-log-why")).toHaveText("Type the weight in kg");
    await expect(page.getByRole("tab", { name: "2026-10-20", selected: true })).toBeVisible();
    expect(await noteText(stack.vault, PAST)).toBe(PAST_NOTE);
    expect(await dailyText(stack.vault)).toBe("");
  });

  test("away from a card opens today's note and asks on its card, writing no line", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    await findNote(page, "Welcome");
    await logWeight(page);
    await expect(page.getByRole("tab", { name: today(), selected: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".cm-log:visible .cm-log-why")).toHaveText("Type the weight in kg");
    await expect(page.locator(".cm-log:visible .cm-log-amount")).toBeFocused();
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).not.toBe("");
    expect(await dailyText(stack.vault)).not.toContain("⚖");
  });
});

const daily = (date: string) => `01 Periodic/00 Daily/${date}.md`;
const logged = (...lines: string[]) => `# Day\n\n## Log\n${lines.join("\n")}\n`;
const card = (page: Page, name: string) =>
  page.getByRole("region", { name: "Overview" }).locator("article", {
    has: page.getByRole("heading", { name: new RegExp(`^${name}, open `) }),
  });
const captions = (page: Page) =>
  page.getByRole("region", { name: "Overview" }).locator(".overview-caption");

/** Opens the overview from the editor and waits for its Food card. */
async function overview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "ga");
  await expect(card(page, "Food")).toBeVisible({ timeout: 15_000 });
}

/** How many of a chart's bars draw in the theme's warning colour, which marks a goal passed. */
const warned = (chart: Locator) =>
  chart.evaluate((svg) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--k-warn)";
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    return [...svg.querySelectorAll("rect")].filter((bar) => getComputedStyle(bar).fill === warn)
      .length;
  });

test.describe("the overview's words", () => {
  test("each chart has a line saying what it shows, and each ring names its macro and grams", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "99 Misc/01 Config/log.md": "- 🍽 food: kcal max 2200, protein min 120\n- 💧 water: 250 ml\n",
      [daily(today())]: logged("- 🍽 🔥 1240 kcal 🥩 84 g"),
    });
    await overview(page);
    await expect(card(page, "Today").locator(".overview-ring-label")).toHaveText([
      "Protein 84 of 120 g",
      "Carbs 0 g",
      "Fat 0 g",
    ]);
    await expect(captions(page)).toHaveText([
      "kcal per day, 14 days",
      "macros against today's goal",
      "weight, 30 days, no weigh-ins yet",
      "water per day, 14 days",
      "cards rated per day, 14 days",
      "todos done per day, 14 days",
      "notes written per day, 14 days",
      "notes written per day this year",
      "sessions per week, 8 weeks",
    ]);
  });

  test("a water max passed is counted in words and not by colour alone", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "99 Misc/01 Config/log.md": "- 💧 water: 250 ml, max 2000\n",
      [daily(plus(-1))]: logged("- 💧 2500 ml"),
      [daily(plus(-2))]: logged("- 💧 1000 ml"),
      [daily(plus(-3))]: logged("- 💧 2100 ml"),
    });
    await overview(page);
    const water = card(page, "Water");
    const chart = water.getByRole("img", {
      name: "water per day over 14 days, goal at most 2,000 ml, 2 days over the goal",
    });
    await expect(chart).toBeVisible();
    await expect(water.locator(".overview-caption")).toHaveText(
      "water per day, 14 days, 2 days over the goal",
    );
    expect(await warned(chart)).toBe(2);
  });

  test("a schedule in a note that is no deck does not count toward the review streak", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "00 Inbox/cards.md": `#flashcards/aws\n\nQ :: A <!--SR:!${plus(4)},4,270-->\n`,
      "00 Inbox/plain.md": `Q :: A <!--SR:!${plus(3)},4,270-->\n`,
    });
    await overview(page);
    const flashcards = card(page, "Flashcards");
    await expect(flashcards.locator(".overview-figure")).toHaveText("1 day");
    await expect(flashcards.locator(".overview-words")).toHaveText(
      "in a row with a review, 1 today",
    );
  });

  for (const width of ["desktop", "phone"]) {
    test.describe(width, () => {
      if (width === "phone") test.use(phone);

      test("a bar card with no logged day says nothing logged in 14 days under its chart", async ({
        page,
      }) => {
        if (width === "phone") {
          await page.goto("/");
          const commands = page.getByRole("toolbar", { name: "Commands" });
          await commands.getByRole("button", { name: "Run a command by name" }).tap();
          await page.getByRole("option", { name: /^Open the overview/ }).tap();
        } else await overview(page);
        for (const name of ["Food", "Water"]) {
          await expect(card(page, name).locator(".overview-caption")).toHaveText(
            "nothing logged in 14 days",
          );
        }
      });
    });
  }
});

test.describe("the overview's Food card counts food days only", () => {
  const CONFIG = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml\n- ⚖ weight: kg, last\n";
  const FED = [
    { ago: 0, stub: false },
    { ago: 2, stub: true },
    { ago: 4, stub: false },
  ];

  test("#1122 a day of drinks or of weight only draws no bar, a 0 kcal line draws a stub, and the log pane draws the same days", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "99 Misc/01 Config/log.md": CONFIG,
      [daily(today())]: logged("- 🍽 🔥 1240 kcal"),
      [daily(plus(-1))]: logged("- 💧 500 ml"),
      [daily(plus(-2))]: logged("- 🍽 🔥 0 kcal"),
      [daily(plus(-3))]: logged("- ⚖ 70 kg"),
      [daily(plus(-4))]: logged("- 🍽 🔥 1800 kcal"),
    });
    await overview(page);
    await expect.poll(() => barsOf(card(page, "Food").getByRole("img"), 14)).toEqual(FED);

    await leader(page, "gf");
    const kcal = page
      .getByRole("region", { name: "Log" })
      .locator(".log-chart", { has: page.getByRole("heading", { name: "Kcal", exact: true }) });
    await expect.poll(() => barsOf(kcal.getByRole("img"), 30)).toEqual(FED);
  });

  test("#1122 a fortnight with logged days but no food line leaves the Food card empty, and the Water card draws the drinks", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "99 Misc/01 Config/log.md": CONFIG,
      [daily(plus(-1))]: logged("- 💧 500 ml"),
      [daily(plus(-2))]: logged("- ⚖ 70 kg"),
    });
    await overview(page);
    await expect
      .poll(() => barsOf(card(page, "Water").getByRole("img"), 14))
      .toContainEqual({ ago: 1, stub: false });
    await expect(card(page, "Food").locator(".overview-caption")).toHaveText(
      "no food logged in 14 days",
    );
    expect(await barsOf(card(page, "Food").getByRole("img"), 14)).toEqual([]);
  });
});

const grid = (page: Page) =>
  page.getByRole("region", { name: "Overview" }).locator(".overview-grid");
/** The card button that holds the focus, by its place in the grid, which is the order Tab walks. */
const focused = (page: Page) =>
  grid(page).evaluate((g) =>
    [...g.querySelectorAll(".overview-open")].indexOf(document.activeElement as Element),
  );
/** The N of the Writing card's "notes in 7 days, N today". */
const writtenToday = async (page: Page) =>
  Number(
    (await card(page, "Writing").locator(".overview-words").textContent())?.match(
      /(\d+) today$/,
    )?.[1],
  );
/** Waits for the written read's answer: the card says 0 today before it, and the seed vault's copied notes date today by mtime. */
const answered = (page: Page) =>
  expect(card(page, "Writing").locator(".overview-words")).toHaveText(/[1-9]\d* today$/, {
    timeout: 15_000,
  });

/** Opens the overview with the vim mode given: by the leader, or by the palette with vim off. */
async function overviewWith(page: Page, vim: string): Promise<void> {
  if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  if (vim === "on") await leader(page, "ga");
  else {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the overview/ }).click();
  }
  await expect(card(page, "Food")).toBeVisible({ timeout: 15_000 });
}

test.describe("the overview's keys", () => {
  for (const vim of ["on", "off"]) {
    test(`#806 I4 h j k l and the arrows move between the cards and Enter opens the Food card's log, vim ${vim}`, async ({
      page,
    }) => {
      await overviewWith(page, vim);
      const row = await grid(page).evaluate(
        (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length,
      );
      expect(row).toBeGreaterThan(1);
      await page.getByRole("button", { name: "Food, open the log" }).focus();
      const walk: [string, number][] = [
        ["l", 1],
        ["j", 1 + row],
        ["k", 1],
        ["h", 0],
        ["ArrowRight", 1],
        ["ArrowDown", 1 + row],
        ["ArrowUp", 1],
        ["ArrowLeft", 0],
      ];
      for (const [key, at] of walk) {
        await page.keyboard.press(key);
        expect(await focused(page), key).toBe(at);
      }
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "Log" })).toBeVisible();
    });

    test(`#806 A7 Space g a opens the overview from the ${vim === "on" ? "editor" : "log pane"} and Space q in it closes it, vim ${vim}`, async ({
      page,
    }) => {
      if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
      await openApp(page);
      if (vim === "off") {
        // Vim off, the editor takes no leader, so it starts from the log pane the palette opens.
        await page.keyboard.press("Control+Shift+P");
        await page.getByRole("option", { name: /^Open the log/ }).click();
        await expect(page.getByRole("region", { name: "Log" })).toBeVisible();
      }
      await leader(page, "ga");
      const overview = page.getByRole("region", { name: "Overview" });
      await expect(overview).toBeVisible({ timeout: 15_000 });
      await leader(page, "q");
      await expect(overview).toBeHidden();
    });
  }

  for (const width of ["desktop", "phone"]) {
    test.describe(width, () => {
      if (width === "phone") test.use(phone);

      test("#806 A7 the home screen's Overview button opens the overview, and its Food card opens the log", async ({
        page,
      }) => {
        await page.goto("/");
        const button = page.locator("[data-today]").getByRole("button", { name: "Overview" });
        await expect(button).toBeVisible({ timeout: 15_000 });
        if (width === "phone") await button.tap();
        else await button.click();
        const food = page.getByRole("button", { name: "Food, open the log" });
        if (width === "phone") await food.tap();
        else await food.click();
        await expect(page.getByRole("region", { name: "Log" })).toBeVisible();
      });
    });
  }
});

test.describe("the overview's Writing card", () => {
  test("#806 I5 a new note written on disk counts today", async ({ page, stack }) => {
    await overview(page);
    await answered(page);
    const before = await writtenToday(page);
    await vaultWith(stack.vault, { "00 Inbox/new idea.md": "# new idea\n" });
    await expect.poll(() => writtenToday(page), { timeout: 15_000 }).toBe(before + 1);
  });

  test("#806 I5 a note the app creates beside the overview counts today", async ({ page }) => {
    await openApp(page);
    // A split keeps the overview drawn while the editor beside it makes the note.
    await leader(page, "%");
    await leader(page, "ga");
    await answered(page);
    const before = await writtenToday(page);
    await page.locator(".cm-content:visible").first().locator(".cm-line").last().click();
    await page.keyboard.press("Escape");
    await leader(page, "cf");
    const prompt = page.getByRole("dialog", { name: "New note" });
    await prompt.getByRole("combobox").fill("made here");
    await page.keyboard.press("Enter");
    await expect(prompt).toBeHidden();
    await expect.poll(() => writtenToday(page), { timeout: 15_000 }).toBe(before + 1);
  });

  test("#806 I5 a write to a note already listed does not ask GET /api/written again", async ({
    page,
    stack,
  }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/written") asked.push(request.url());
    });
    // So the journey knows the page has read a vault event.
    const seen = await recordEvents(page);
    await overview(page);
    await answered(page);
    const [before, count] = [await writtenToday(page), asked.length];

    await vaultWith(stack.vault, { "01 Notes/Seeds.md": "# Seeds\n\nchanged\n" });
    await expect.poll(seen, { timeout: 15_000 }).toContain("01 Notes/Seeds.md");
    // A new note after it asks once, so a count past one means the listed note asked too.
    await vaultWith(stack.vault, { "00 Inbox/new idea.md": "# new idea\n" });
    await expect.poll(() => writtenToday(page), { timeout: 15_000 }).toBe(before + 1);
    expect(asked.length).toBe(count + 1);
  });
});
