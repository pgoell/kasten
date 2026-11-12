import type { Page } from "@playwright/test";
import { phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const PASCAL = "03 Areas/08 People/Pascal.md";
// The todo's words hold no link: only the `👤 [[Pascal]]` field names him.
const NOTES = {
  [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
  "01 Periodic/00 Daily/2026-10-25.md":
    "# 2026-10-25\n\n- [ ] buy paint 👤 [[Pascal]]\n- [ ] fix the gate 👤 [[Alicia]]\n",
  "03 Areas/08 People/Alicia.md": "---\ntype: Person\n---\n\n# Alicia\n",
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
});
