import type { Page } from "@playwright/test";
import { bodyOf, noteText, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { openDecks } from "../review.ts";

const NOT_YET = "<!--SR:!2026-11-05,4,250-->";
/** Two decks with a card to go and one with nothing waiting; the fixture's own deck is emptied. */
const DECKS = {
  "03 Flashcards/Capitals.md": "# Capitals\n",
  "03 Flashcards/alpha.md": "#flashcards/alpha\n\nalpha question::alpha answer\n",
  "03 Flashcards/beta.md": "#flashcards/beta\n\nbeta question::beta answer\n",
  "03 Flashcards/zeta.md": `#flashcards/zeta\n\nzeta q::z ${NOT_YET}\n`,
};
const CLOUDS = "03 Flashcards/Clouds.md";
const CLOUDS_TEXT = "#flashcards/alpha\n\na::b\n\nWhat is a VPC?::A private cloud !suspended\n";

const pane = (page: Page) => page.locator('[aria-label="review"]');
const deck = (page: Page, name: string) => page.locator(`button[data-deck="${name}"]`);
const summary = (page: Page) => page.getByRole("heading", { name: "Review" }).locator("+ p");
const question = (page: Page) => page.getByTestId("review-question");
const press = async (page: Page, keys: string) => {
  for (const key of keys) await page.keyboard.press(key);
};

test.describe("the deck overview's keys", () => {
  test("j and k walk the decks, stop at both ends and never land on a deck with nothing waiting", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, DECKS);
    await expect(deck(page, "zeta")).toBeDisabled();
    await press(page, "k");
    await expect(deck(page, "alpha")).toBeFocused();
    await press(page, "j");
    await expect(deck(page, "beta")).toBeFocused();
    await press(page, "jj");
    await expect(deck(page, "beta")).toBeFocused();
    await press(page, "k");
    await expect(deck(page, "alpha")).toBeFocused();
    await press(page, "k");
    await expect(deck(page, "alpha")).toBeFocused();
  });

  test("l sits the deck under the cursor and leaves the focus in the pane, so Enter shows the answer", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, DECKS);
    await press(page, "jjl");
    await expect(question(page)).toHaveText("beta question");
    // The row it pressed has gone with the overview; without the hand-over the focus falls to the body.
    await expect(pane(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-back")).toHaveText("beta answer");
  });

  test("#517 j and k stop on the toggle of a parent its limit empties, and za, j and l reach and sit the subdeck", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, {
      "03 Flashcards/alpha.md": "#flashcards/alpha\n\na::b\n",
      "03 Flashcards/g.md": "#flashcards/trivia/geography\n\nc::d\n\ne::f\n",
      "99 Misc/01 Config/decks.md": "trivia: 0 new, 0 reviews\ntrivia/geography: 5 new\n",
    });
    await expect(deck(page, "trivia")).toBeDisabled();
    await press(page, "jj");
    await expect(page.getByRole("button", { name: "unfold trivia" })).toBeFocused();
    await press(page, "k");
    await expect(deck(page, "alpha")).toBeFocused();
    await press(page, "jza");
    await expect(deck(page, "trivia/geography")).toBeVisible();
    await expect(deck(page, "trivia")).toBeDisabled();
    await press(page, "j");
    await expect(deck(page, "trivia/geography")).toBeFocused();
    await press(page, "l");
    await expect(question(page)).toHaveText(/^(c|e)$/);
  });
});

test.describe("the deck overview's rows", () => {
  test("a subdeck sits under its parent by its last part, indented, and the header counts its card once", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, {
      "03 Flashcards/pg.md": "#flashcards/databases/postgres\n\npg q::p\n",
    });
    await expect(summary(page)).toHaveText("1 card to go today in 1 deck.");
    await page.getByRole("button", { name: "unfold databases" }).click();
    const child = deck(page, "databases/postgres");
    await expect(child).toHaveAccessibleName(/postgres/);
    await expect(child).not.toHaveAccessibleName(/databases/);
    await expect(deck(page, "databases")).toHaveAccessibleName(/^databases/);
    expect(await child.evaluate((row) => row.style.paddingLeft)).toBe("1.5rem");
    expect(await deck(page, "databases").evaluate((row) => row.style.paddingLeft)).not.toBe(
      "1.5rem",
    );
  });

  test("parked cards count in the header and its link, a row says how many of its own are parked, and a deck of only parked cards cannot be sat", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, {
      "03 Flashcards/a.md": "#flashcards/alpha\n\na::b\n\nc::d !suspended\n",
      "03 Flashcards/b.md": "#flashcards/beta\n\ne::f !suspended\n",
    });
    await expect(summary(page)).toHaveText("1 card to go today in 1 deck. 2 parked.");
    await expect(page.getByRole("button", { name: "2 parked cards" })).toBeVisible();
    await expect(deck(page, "alpha")).toContainText("1 parked");
    await expect(deck(page, "alpha")).toBeEnabled();
    await expect(deck(page, "beta")).toBeDisabled();
  });

  test("A11 a folded parent draws the counts its own decks.md line allows, and each subdeck its own once unfolded", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, {
      "03 Flashcards/g.md": "#flashcards/trivia/geography\n\na::b\n\nc::d\n",
      "03 Flashcards/h.md": "#flashcards/trivia/history\n\ne::f\n\ng::h\n",
      "99 Misc/01 Config/decks.md": "trivia: 3 new\ntrivia/geography: 1 new\n",
    });
    await expect(deck(page, "trivia")).toContainText("3 new");
    await expect(deck(page, "trivia/geography")).toHaveCount(0);
    await page.getByRole("button", { name: "unfold trivia" }).click();
    await expect(deck(page, "trivia/geography")).toContainText("1 new");
    await expect(deck(page, "trivia/history")).toContainText("2 new");
  });
});

test.describe("the parked screen's keys", () => {
  const parkedRow = (page: Page) => page.locator("button[data-parked]");

  async function openParked(page: Page, vault: string) {
    await openDecks(page, vault, { [CLOUDS]: CLOUDS_TEXT });
    await press(page, "p");
    await expect(page.getByText("What is a VPC?")).toBeVisible();
  }

  test("p opens the parked list with no deck rows, j walks the parked rows, and h goes back to the decks", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    await expect(page.locator("button[data-deck]")).toHaveCount(0);
    await press(page, "j");
    await expect(parkedRow(page)).toBeFocused();
    await press(page, "h");
    await expect(deck(page, "alpha")).toBeVisible();
    await expect(parkedRow(page)).toHaveCount(0);
  });

  test("u puts the focused row back on disk and leaves the focus in the pane, so h still goes back", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    await press(page, "ju");
    await expect(page.getByText("What is a VPC?")).toHaveCount(0);
    await expect
      .poll(async () => bodyOf(await noteText(stack.vault, CLOUDS)))
      .toBe(CLOUDS_TEXT.replace(" !suspended", ""));
    await expect(pane(page)).toBeFocused();
    await press(page, "h");
    await expect(deck(page, "alpha")).toBeVisible();
  });

  test("o opens the note the focused row is written in", async ({ page, stack }) => {
    await openParked(page, stack.vault);
    await press(page, "jo");
    await expect(page.getByRole("tab", { name: "Clouds", selected: true })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on a deck sits it, and a deck of only parked cards takes no tap", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/Capitals.md": "# Capitals\n",
      "03 Flashcards/a.md": "#flashcards/alpha\n\na::b\n",
      "03 Flashcards/b.md": "#flashcards/beta\n\ne::f !suspended\n",
    });
    await page.goto("/");
    await page.getByRole("button", { name: /cards? waiting/ }).tap();
    await expect(deck(page, "beta")).toBeDisabled();
    await deck(page, "beta").tap({ force: true });
    await expect(question(page)).toHaveCount(0);
    await deck(page, "alpha").tap();
    await expect(question(page)).toHaveText("a");
  });
});
