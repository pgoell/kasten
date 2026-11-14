import type { Page } from "@playwright/test";
import { leader, openApp, vaultWith } from "../../harness/app.ts";
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
