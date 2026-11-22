import type { Page } from "@playwright/test";
import { leader, onPhone, phone, runCommand, vaultWith } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { tile } from "../log.ts";
import {
  CONFIG_PATH,
  card,
  daily,
  figure,
  GOALS,
  logged,
  NOW,
  overview,
  warned,
  words,
} from "./overview.ts";

const kcal = (n: number) => logged(`- 🍽 🔥 ${n} kcal`);

/** Writes the notes, pins the clock to the 20th and opens the overview, on a phone by the palette. */
async function over(page: Page, vault: string, notes: Record<string, string>): Promise<void> {
  await vaultWith(vault, notes);
  await page.clock.setFixedTime(NOW);
  if (!onPhone(page)) return overview(page);
  await page.goto("/");
  await runCommand(page, /^Open the overview/);
}

/** A deck note of these flashcard lines, each its own paragraph. */
const deck = (...lines: string[]) => ({
  "00 Inbox/cards.md": `#flashcards/aws\n\n${lines.join("\n\n")}\n`,
});
const fsrs = (name: string, last: string) =>
  `<!--SR:${name}!fsrs,2026-11-01T00:00:00.000Z,9,9.10,5.00,2,3,0,0,${last}-->`;

test.describe("the food streak", () => {
  for (const width of ["desktop", "phone"]) {
    test.describe(width, () => {
      if (width === "phone") test.use(phone);

      test("#806 A6 counts days within the kcal goal and a day with no log ends it", async ({
        page,
        stack,
      }) => {
        // Three days within the goal, a gap on the 16th, then more days. Today has no log yet.
        await over(page, stack.vault, {
          [CONFIG_PATH]: GOALS,
          [daily("2026-10-19")]: kcal(1500),
          [daily("2026-10-18")]: kcal(2000),
          [daily("2026-10-17")]: kcal(2100),
          [daily("2026-10-15")]: kcal(1000),
          [daily("2026-10-14")]: kcal(1100),
        });
        await expect(figure(page, "Food")).toHaveText("3 days");
        await expect(words(page, "Food")).toHaveText("in a row within at most 2,200 kcal");
      });
    });
  }

  test("#1012 A3 the log pane's Trends and the overview's Food card read the same streak on drinks-only days", async ({
    page,
    stack,
  }) => {
    // Today and the 18th have drinks only. The 19th and 17th have food within the goal.
    await over(page, stack.vault, {
      [CONFIG_PATH]: GOALS,
      [daily("2026-10-20")]: logged("- 💧 250 ml"),
      [daily("2026-10-19")]: kcal(1500),
      [daily("2026-10-18")]: logged("- 💧 250 ml"),
      [daily("2026-10-17")]: kcal(1500),
    });
    await expect(figure(page, "Food")).toHaveText("1 day");
    await leader(page, "gf");
    const pane = page.getByRole("region", { name: "Trends" });
    await pane.getByRole("button", { name: "90d" }).click();
    await expect(tile(pane, "Streak").first()).toHaveText("1 day");
  });
});

test.describe("the food chart", () => {
  test("#806 I3 days over a max goal are drawn in the warning colour and counted in the chart's words", async ({
    page,
    stack,
  }) => {
    await over(page, stack.vault, {
      [CONFIG_PATH]: GOALS,
      [daily("2026-10-19")]: kcal(2500),
      [daily("2026-10-18")]: kcal(2300),
      [daily("2026-10-17")]: kcal(2000),
    });
    const chart = card(page, "Food").getByRole("img", {
      name: "kcal per day over 14 days, goal at most 2,200 kcal, 2 days over the goal",
    });
    await expect(chart).toBeVisible();
    expect(await warned(chart)).toBe(2);
    await expect(card(page, "Food").locator(".overview-caption")).toHaveText(
      "kcal per day, 14 days, 2 days over the goal",
    );
  });

  test("#806 I3 a floor goal never warns", async ({ page, stack }) => {
    await over(page, stack.vault, {
      [CONFIG_PATH]: "- 🍽 food: kcal min 1800\n",
      [daily("2026-10-19")]: kcal(1000),
      [daily("2026-10-18")]: kcal(900),
    });
    const chart = card(page, "Food").getByRole("img", {
      name: "kcal per day over 14 days, goal at least 1,800 kcal",
      exact: true,
    });
    await expect(chart).toBeVisible();
    await expect.poll(() => chart.locator("rect").count()).toBe(2);
    expect(await warned(chart)).toBe(0);
  });
});

test.describe("the flashcard streak", () => {
  test("#806 A6 counts days in a row with a review, read off due less interval, every cloze schedule counting", async ({
    page,
    stack,
  }) => {
    // A review on each of the 20th, 19th, 18th and 17th, none on the 16th, one on the 15th.
    await over(
      page,
      stack.vault,
      deck(
        "Q :: A <!--SR:!2026-10-24,4,270-->",
        "Q2 :: A <!--SR:!2026-10-23,4,270-->",
        "Q3 :: A <!--SR:!2026-10-22,4,270-->",
        // The 17th comes from the second cloze schedule alone: its first is rated today.
        "{{c1::p}} and {{c2::q}} <!--SR:c1!2026-10-25,5,250--> <!--SR:c2!2026-10-21,4,250-->",
        "Q5 :: A <!--SR:!2026-10-20,5,270-->",
      ),
    );
    await expect(figure(page, "Flashcards")).toHaveText("4 days");
    await expect(words(page, "Flashcards")).toHaveText("in a row with a review, 2 today");
  });

  test("#806 I8 a line with two cloze schedules counts on both days", async ({ page, stack }) => {
    // The 20th from one cloze schedule and the 17th from its other, with a review on each of the 19th and 18th.
    await over(
      page,
      stack.vault,
      deck(
        "{{c1::p}} and {{c2::q}} <!--SR:c1!2026-10-22,2,250--> <!--SR:c2!2026-10-19,2,250-->",
        "Q2 :: A <!--SR:!2026-10-23,4,270-->",
        "Q3 :: A <!--SR:!2026-10-22,4,270-->",
      ),
    );
    await expect(figure(page, "Flashcards")).toHaveText("4 days");
    await expect(words(page, "Flashcards")).toHaveText("in a row with a review, 1 today");
  });

  test("#1926 I4 an FSRS comment counts on its last answer, plain or a cloze's, and one with none counts nowhere", async ({
    page,
    stack,
  }) => {
    await over(
      page,
      stack.vault,
      deck(
        `Q :: A ${fsrs("", "2026-10-20T00:00:00.000Z")}`,
        `{{c1::p}} and {{c2::q}} ${fsrs("c1", "2026-10-19T00:00:00.000Z")} <!--SR:c2!2026-10-19,2,250-->`,
        "Q3 :: A <!--SR:!2026-10-22,4,270-->",
        `Q4 :: A ${fsrs("", "-")}`,
      ),
    );
    await expect(figure(page, "Flashcards")).toHaveText("4 days");
    await expect(words(page, "Flashcards")).toHaveText("in a row with a review, 1 today");
  });
});
