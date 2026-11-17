import type { Locator, Page } from "@playwright/test";
import {
  findNote,
  leader,
  noteText,
  openApp,
  phone,
  plus,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

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

/** Each bar a chart draws, as days before the range's last day, and whether it is the one-unit stub of a logged zero. */
const barsOf = (chart: Locator, slots: number) =>
  chart.evaluate((svg: SVGSVGElement, n) => {
    const slot = svg.viewBox.baseVal.width / n;
    return [...svg.querySelectorAll("rect")]
      .map((bar) => bar.getBBox())
      .map((box) => ({ ago: n - 1 - Math.floor(box.x / slot), stub: box.height <= 1 }))
      .sort((a, b) => a.ago - b.ago);
  }, slots);

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
