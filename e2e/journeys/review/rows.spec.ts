import type { Page } from "@playwright/test";
import { leader, openApp, readAll, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** Opens the review pane on its overview, with the focus in it. */
async function openReview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
}

test.describe("Enter on the review pane's rows (#1166)", () => {
  test("Enter on a deck row reached by j sits that deck, and the next Enter shows the answer", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/alpha.md": "#flashcards/alpha\n\nalpha question::alpha answer\n",
      "03 Flashcards/beta.md": "#flashcards/beta\n\nbeta question::beta answer\n",
    });
    await openReview(page);
    await expect(page.locator('button[data-deck="beta"]')).toBeEnabled();

    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.locator('button[data-deck="beta"]')).toBeFocused();
    await page.keyboard.press("Enter");

    const card = page.getByTestId("review-card");
    await expect(card).toContainText("beta question");
    await expect(page.getByTestId("review-back")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-back")).toHaveText("beta answer");
  });

  test("Enter on a parked row reached by j opens its note, as o does", async ({ page, stack }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/Clouds.md":
        "#flashcards/aws\n\nWhat is a VPC?::A private cloud !suspended <!--SR:!2026-08-20,4,270-->\n",
    });
    await openReview(page);
    await page.keyboard.press("p");
    await expect(page.getByText("What is a VPC?")).toBeVisible();

    await page.keyboard.press("j");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("tab", { name: "Clouds", selected: true })).toBeVisible();
    await expect(page.locator(".cm-content").getByText("What is a VPC?")).toBeVisible();
  });

  test("Enter on a focused fold arrow neither folds it nor sits a deck", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/postgres.md":
        "#flashcards/databases/postgres\n\nWhat is MVCC?::Many versions\n",
    });
    await openReview(page);
    const toggle = page.getByRole("button", { name: "unfold databases" });
    await toggle.focus();

    await page.keyboard.press("Enter");

    // The browser turns an unstopped Enter on a button into its click, which would fold it.
    await expect(page.getByRole("button", { name: "unfold databases" })).toBeFocused();
    await expect(page.getByRole("button", { name: "fold databases", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("review-card")).toHaveCount(0);
  });
});

test.describe("the review overview's words and rows", () => {
  const ALPHA = { "03 Flashcards/alpha.md": "#flashcards/alpha\n\nalpha question::alpha answer\n" };
  const ZETA = {
    "03 Flashcards/zeta.md": "#flashcards/zeta\n\nzeta q::z <!--SR:!2026-11-05,4,250-->\n",
  };
  const DECKS = {
    ...ALPHA,
    ...ZETA,
    "03 Flashcards/pg.md":
      "#flashcards/databases/postgres\n\npg q::p <!--SR:!2026-10-20,4,250-->\n",
    "03 Flashcards/aardvark.md": "#flashcards/aardvark\n\nparked question::a !suspended\n",
  };
  const summary = (page: Page) => page.getByRole("heading", { name: "Review" }).locator("+ p");

  /** Saturday the 24th of October 2026 at noon, with the fixture's own deck emptied, so the counts are these decks'. */
  async function openDecks(page: Page, vault: string, decks: Record<string, string>) {
    await vaultWith(vault, { "03 Flashcards/Capitals.md": "# Capitals\n", ...decks });
    await page.clock.setFixedTime(new Date(2026, 9, 24, 12));
    await openReview(page);
  }

  test("counts what goes today, draws the decks with nothing due last, and opens the parked cards from their link", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, DECKS);
    await expect(summary(page)).toHaveText("2 cards to go today in 2 decks. 1 parked.");
    const zeta = page.locator('button[data-deck="zeta"]');
    await expect(zeta).toBeDisabled();
    await expect(zeta).toContainText("due next Thursday");
    await expect
      .poll(() => readAll(page, "button[data-deck]", (rows) => rows.map((row) => row.dataset.deck)))
      .toEqual(["alpha", "databases", "aardvark", "zeta"]);
    // The import sits after the last deck.
    expect(
      await zeta.evaluate((row) => {
        const entry = [...document.querySelectorAll("*")].find(
          (el) => el.textContent === "Import an Anki deck",
        );
        return entry !== undefined && !!(row.compareDocumentPosition(entry) & 4);
      }),
    ).toBe(true);

    await page.getByRole("button", { name: "unfold databases" }).click();
    await expect(page.locator('button[data-deck="databases/postgres"]')).toContainText(
      "/ postgres",
    );
    await page.getByRole("button", { name: "1 parked card" }).click();
    await expect(page.getByText("parked question")).toBeVisible();
  });

  test("Start with sits the first deck drawn with cards to go", async ({ page, stack }) => {
    await openDecks(page, stack.vault, DECKS);
    await page.getByRole("button", { name: "Start with alpha" }).click();
    await expect(page.getByTestId("review-question")).toHaveText("alpha question");
  });

  test("says card and deck in the singular, and leaves the parked part out when none is", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, ALPHA);
    await expect(summary(page)).toHaveText("1 card to go today in 1 deck.");
  });

  test("says Nothing to go today and offers no start when no card is due", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, ZETA);
    await expect(page.locator('button[data-deck="zeta"]')).toBeVisible();
    await expect(summary(page)).toHaveText("Nothing to go today.");
    await expect(page.getByRole("button", { name: /^Start with/ })).toHaveCount(0);
  });
});
