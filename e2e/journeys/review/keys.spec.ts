import type { Page } from "@playwright/test";
import { noteText, openApp, phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const BETA = "03 Flashcards/beta.md";
const NOTE = "#flashcards/beta\n\nc::d\n\ne::f\n";
/** FSRS's comment on a fresh card's first Good: three days out (#1926). */
const FIRST_GOOD = /<!--SR:!fsrs,[\d-]+T00:00:00\.000Z,3,2\.31,2\.12,2,1,0,0,/;

/** The line of `beta.md` that starts with the card's question. */
async function line(vault: string, question: string): Promise<string> {
  const text = await noteText(vault, BETA);
  return text.split("\n").find((row) => row.startsWith(`${question}::`)) ?? "";
}

/** Fails every GET of beta's note with a 500, which the sitting does not try again. */
const failBeta = (page: Page) =>
  page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${BETA}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback(),
  );

/**
 * Sits deck `beta` from the palette, which vim off reaches too, and waits for its first card;
 * with `failing`, the sitting's read of the note fails and it waits for Try again instead.
 */
async function sitBeta(page: Page, vault: string, failing = false): Promise<void> {
  await vaultWith(vault, { [BETA]: NOTE });
  await openApp(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /^Open the review pane/ }).click();
  const beta = page.locator('button[data-deck="beta"]');
  await expect(beta).toBeEnabled();
  if (failing) await failBeta(page);
  await beta.focus();
  await page.keyboard.press("Enter");
  if (failing) return expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByTestId("review-card")).toContainText("c");
  await expect(page.getByTestId("review-back")).toHaveCount(0);
}

for (const vim of ["on", "off"]) {
  test.describe(`the review keys, vim ${vim}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    });

    test("Enter shows the answer, a second Enter grades it Good, and the next card shows", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault);

      await page.keyboard.press("Enter");
      await expect(page.getByTestId("review-back")).toHaveText("d");
      await page.keyboard.press("Enter");

      await expect.poll(() => line(stack.vault, "c")).toMatch(FIRST_GOOD);
      await expect(page.getByTestId("review-card")).toContainText("e");
      expect(await line(stack.vault, "e")).toBe("e::f");
    });

    test("the grades show the interval each writes, 1 sends the card to the back, and 3 grades the next", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault);

      await page.keyboard.press("Enter");
      // FSRS's first Again is a day out (#1926); the sitting still asks it again.
      await expect(page.getByRole("button", { name: "Again" })).toHaveAccessibleDescription("1d");
      await page.keyboard.press("1");
      await expect.poll(() => line(stack.vault, "c")).toContain("<!--SR:!fsrs,");
      await expect(page.getByTestId("review-card")).toContainText("e");

      await page.keyboard.press("Enter");
      await page.keyboard.press("3");
      await expect.poll(() => line(stack.vault, "e")).toMatch(FIRST_GOOD);
      // Again put `c` at the back, so it comes round once `e` is graded.
      await expect(page.getByTestId("review-card")).toContainText("c");
    });

    test("s parks the card and the next one shows, and n opens a new question", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault);

      await expect(page.getByRole("button", { name: "Park this card" })).toBeVisible();
      await page.keyboard.press("s");
      await expect(page.getByTestId("review-card")).toContainText("e");
      await expect.poll(() => line(stack.vault, "c")).toBe("c::d !suspended");
      expect(await line(stack.vault, "e")).toBe("e::f");

      await page.keyboard.press("n");
      await expect(page.getByRole("textbox", { name: "a new question" })).toBeVisible();
    });

    test("Good is the default grade, u takes back the rating, and h goes back to the decks", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault);

      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Good" })).toHaveAttribute("data-default");
      await page.keyboard.press("3");
      await expect.poll(() => line(stack.vault, "c")).toMatch(FIRST_GOOD);
      await expect(page.getByTestId("review-card")).toContainText("e");

      await page.keyboard.press("u");
      await expect(page.getByTestId("review-card")).toContainText("c");
      await expect.poll(() => line(stack.vault, "c")).toBe("c::d");

      await page.keyboard.press("h");
      await expect(page.getByTestId("review-card")).toHaveCount(0);
      await expect(page.locator('button[data-deck="beta"]')).toBeVisible();
    });

    test("I4 B1 Enter on a focused Try again reads the deck again, and the next Enter shows the answer (#1163)", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault, true);
      const again = page.getByRole("button", { name: "Try again" });
      await again.focus();
      await page.unrouteAll({ behavior: "wait" });

      await page.keyboard.press("Enter");
      await expect(page.getByTestId("review-question")).toHaveText("c");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("review-back")).toHaveText("d");
    });

    test("B2 Enter on Center left focused on the done screen presses nothing, and a click does (#1163)", async ({
      page,
      stack,
    }) => {
      await sitBeta(page, stack.vault);
      for (const _ of "ce") {
        await page.keyboard.press("Enter");
        await page.keyboard.press("3");
      }
      await expect(page.getByTestId("review-done")).toBeVisible();
      const center = page.getByRole("button", { name: "Center" });
      await center.focus();

      await page.keyboard.press("Enter");
      await expect(page.getByTestId("review-done")).toBeVisible();
      await expect(center).toHaveAttribute("aria-pressed", "false");
      await center.click();
      await expect(center).toHaveAttribute("aria-pressed", "true");
    });
  });
}

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on Try again reads the deck note again and asks the card (#1163)", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [BETA]: NOTE });
    await page.goto("/");
    await page.getByRole("button", { name: /cards waiting$/ }).tap();
    const beta = page.locator('button[data-deck="beta"]');
    await expect(beta).toBeEnabled();
    await failBeta(page);
    await beta.tap();
    const again = page.getByRole("button", { name: "Try again" });
    await expect(again).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
    await again.tap();
    await expect(page.getByTestId("review-question")).toHaveText("c");
  });
});

test.describe("folding the deck list (#517)", () => {
  /** A parent with one due, one new and one parked card below it, and a deck after it. */
  const TREE = {
    "03 Flashcards/Capitals.md": "# Capitals\n",
    "03 Flashcards/d.md":
      "#flashcards/databases/postgres\n\na::b\n\nc::d <!--SR:!2000-01-01,4,250-->\n\ne::f !suspended\n",
    "03 Flashcards/z.md": "#flashcards/zz\n\ng::h\n",
  };
  const row = (page: Page, name: string) => page.locator(`button[data-deck="${name}"]`);
  const press = async (page: Page, keys: string) => {
    for (const key of keys) await page.keyboard.press(key);
  };

  /** Opens the decks from the palette, which vim off reaches too, with the focus in the pane. */
  async function openDecks(page: Page, vault: string, notes: Record<string, string> = TREE) {
    await vaultWith(vault, notes);
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the review pane/ }).click();
    await expect(page.locator("button[data-deck]").last()).toBeVisible();
    await page.getByRole("heading", { name: "Review" }).click();
  }
  /** Starts with `databases` unfolded, as a fold the pane stored. */
  const unfolded = (page: Page) =>
    page.addInitScript(() => localStorage.setItem("kasten.review.folds.1", '["databases"]'));

  test("A1 A2 a deck's subdecks sit folded behind a toggle at first, the folded row counts all under it, and a reload keeps the fold", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault);
    await expect(row(page, "databases/postgres")).toHaveCount(0);
    for (const count of ["1 due", "1 new", "1 parked"])
      await expect(row(page, "databases")).toContainText(count);
    const toggle = page.getByRole("button", { name: "unfold databases" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /fold zz/ })).toHaveCount(0);

    await toggle.click();
    await expect(row(page, "databases/postgres")).toBeVisible();
    const fold = page.getByRole("button", { name: "fold databases", exact: true });
    await expect(fold).toHaveAttribute("aria-expanded", "true");

    await page.reload();
    // The workspace brings the review pane back with the reload.
    await expect(row(page, "databases/postgres")).toBeVisible({ timeout: 15_000 });
    await fold.click();
    await expect(row(page, "databases/postgres")).toHaveCount(0);
  });

  for (const vim of ["on", "off"]) {
    test(`A3 za folds and unfolds the deck under the cursor, vim ${vim}`, async ({
      page,
      stack,
    }) => {
      await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
      await unfolded(page);
      await openDecks(page, stack.vault);

      await press(page, "j");
      await expect(row(page, "databases")).toBeFocused();
      await press(page, "za");
      await expect(row(page, "databases/postgres")).toHaveCount(0);
      await expect(row(page, "databases")).toBeFocused();
      await press(page, "za");
      await expect(row(page, "databases/postgres")).toBeVisible();
    });
  }

  test("A3 a z followed by another key leaves that key its own", async ({ page, stack }) => {
    await unfolded(page);
    await openDecks(page, stack.vault);
    await press(page, "jzj");
    await expect(row(page, "databases/postgres")).toBeFocused();
    await press(page, "kza");
    await expect(row(page, "databases/postgres")).toHaveCount(0);
  });

  test("I4 za on a subdeck folds its parent and moves the cursor to the parent's row", async ({
    page,
    stack,
  }) => {
    await unfolded(page);
    await openDecks(page, stack.vault);
    await press(page, "jj");
    await expect(row(page, "databases/postgres")).toBeFocused();
    await press(page, "za");
    await expect(row(page, "databases/postgres")).toHaveCount(0);
    await expect(row(page, "databases")).toBeFocused();
  });

  test("I4 za on a subdeck under a parent with nothing to offer moves the cursor to its toggle", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.review.folds.1", '["trivia"]'));
    // A limit on the parent disables it above a subdeck whose own line lets it be sat.
    await openDecks(page, stack.vault, {
      "03 Flashcards/Capitals.md": "# Capitals\n",
      "03 Flashcards/t.md": "#flashcards/trivia/geography\n\nq::a\n",
      "99 Misc/01 Config/decks.md": "trivia: 0 new, 0 reviews\ntrivia/geography: 5 new\n",
    });
    await expect(row(page, "trivia")).toBeDisabled();

    // The first `j` stops on the disabled parent's toggle, the second on the subdeck.
    await press(page, "jj");
    await expect(row(page, "trivia/geography")).toBeFocused();
    await press(page, "za");
    await expect(row(page, "trivia/geography")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "unfold trivia" })).toBeFocused();

    // From the toggle, `l` unfolds and keeps the cursor there, and `j` walks on.
    await press(page, "l");
    await expect(page.getByRole("button", { name: "fold trivia", exact: true })).toBeFocused();
    await press(page, "j");
    await expect(row(page, "trivia/geography")).toBeFocused();
  });

  test("I5 j skips the rows a fold hides, and l on a folded deck sits all of it", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault);
    await press(page, "jj");
    await expect(row(page, "zz")).toBeFocused();
    await press(page, "kl");
    await expect(page.getByTestId("review-question")).toHaveText(/^[ac]$/);
  });

  test("I6 unreadable fold storage leaves everything below the top level folded", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("site data is blocked", "SecurityError");
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    });
    await openDecks(page, stack.vault);
    await expect(row(page, "databases/postgres")).toHaveCount(0);
    await page.getByRole("button", { name: "unfold databases" }).click();
    await expect(row(page, "databases/postgres")).toBeVisible();
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on the fold arrow shows the subdecks and a second hides them", async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, TREE);
      await page.goto("/");
      await page.getByRole("button", { name: /cards waiting$/ }).tap();
      await page.getByRole("button", { name: "unfold databases" }).tap();
      await expect(row(page, "databases/postgres")).toBeVisible();
      await page.getByRole("button", { name: "fold databases", exact: true }).tap();
      await expect(row(page, "databases/postgres")).toHaveCount(0);
    });
  });
});
