import type { Page } from "@playwright/test";
import { noteText, openApp, vaultWith } from "../../harness/app.ts";
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

/** Sits deck `beta` from the palette, which vim off reaches too, and waits for its first card. */
async function sitBeta(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, { [BETA]: NOTE });
  await openApp(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /^Open the review pane/ }).click();
  const beta = page.locator('button[data-deck="beta"]');
  await expect(beta).toBeEnabled();
  await beta.focus();
  await page.keyboard.press("Enter");
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
  });
}
