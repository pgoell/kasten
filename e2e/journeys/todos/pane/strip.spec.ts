import type { Page } from "@playwright/test";
import {
  bodyOf,
  leader,
  noteText,
  openApp,
  phone,
  TODO_ROW,
  tapHeight,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const NOTE = "01 Notes/Errands.md";
const LINES = "# Errands\n\n- [ ] fix the tap\n- [ ] feed the cat\n";
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const cards = (page: Page) => page.locator("[data-card]:visible");
const filter = (page: Page) => page.getByLabel("filter todos");
const pressed = (page: Page, name: string) => button(page, name).getAttribute("aria-pressed");

/** The todo pane by keys, its rows drawn; the palette opens it with vim off, where Space types. */
async function byKeys(page: Page, vault: string, vim = "on") {
  await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
  await vaultWith(vault, { [NOTE]: LINES });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(page.locator(TODO_ROW, { hasText: "fix the tap" })).toBeVisible();
}

test.describe("by mouse and keys (#419)", () => {
  test("A1 I3 the strip names its keys at a line's height and stays out of the tab order", async ({
    page,
    stack,
  }) => {
    await byKeys(page, stack.vault);

    for (const name of ["d done", "n next", "v view", "c board"]) {
      await expect(button(page, name)).toHaveAttribute("tabindex", "-1");
      expect(await tapHeight(button(page, name))).toBeLessThan(44);
    }
  });

  for (const vim of ["on", "off"]) {
    test(`A6 c and the c board button reach the board, vim ${vim}`, async ({ page, stack }) => {
      await byKeys(page, stack.vault, vim);

      await page.keyboard.press("c");
      await expect(cards(page)).not.toHaveCount(0);
      await page.keyboard.press("c");
      await expect(cards(page)).toHaveCount(0);
      await button(page, "c board").click();
      await expect(cards(page)).not.toHaveCount(0);
    });
  }

  test("I1 a click on c board leaves the keys on the board, and c goes back to the list", async ({
    page,
    stack,
  }) => {
    await byKeys(page, stack.vault);

    await button(page, "c board").click();
    await expect(page.locator('[data-card][tabindex="0"]')).toBeFocused();
    await page.keyboard.press("c");

    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator(`${TODO_ROW}[tabindex="0"]`)).toBeFocused();
  });

  test("I2 the list footer names c board on a desktop", async ({ page, stack }) => {
    await byKeys(page, stack.vault);

    await expect(page.getByTestId("todo-footer")).toContainText("c board");
  });

  test("I5 the strip says which of done, next and board is on", async ({ page, stack }) => {
    await byKeys(page, stack.vault);
    expect([
      await pressed(page, "d done"),
      await pressed(page, "n next"),
      await pressed(page, "c board"),
    ]).toEqual(["false", "false", "false"]);

    await page.keyboard.press("d");
    await expect(button(page, "d done")).toHaveAttribute("aria-pressed", "true");
    await expect(button(page, "n next")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("n");
    await expect(button(page, "d done")).toHaveAttribute("aria-pressed", "false");
    await expect(button(page, "n next")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("c");
    await expect(button(page, "c board")).toHaveAttribute("aria-pressed", "true");
  });

  for (const [id, key, open] of [
    ["B1", "i", "a row is an input"],
    ["B2", "b", "picking a blocker"],
  ] as const) {
    test(`${id} a click on the strip while ${open} leaves it be`, async ({ page, stack }) => {
      await byKeys(page, stack.vault);
      await page.keyboard.press(key);
      const held = key === "i" ? page.getByLabel("edit line") : page.getByTestId("todo-pick");
      await expect(held).toBeVisible();

      await button(page, "c board").click();
      await button(page, "d done").click();

      await expect(cards(page)).toHaveCount(0);
      await expect(button(page, "d done")).toHaveAttribute("aria-pressed", "false");
      await expect(held).toBeVisible();
    });
  }
});

test.describe("by touch (#421)", () => {
  test.use(phone);

  /** The pane opened by a tap, vim set as asked. */
  async function byTouch(page: Page, vault: string, vim = "on") {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await vaultWith(vault, { [NOTE]: LINES });
    // The views note is written only once the file listing says the vault lacks it (#2081).
    const listed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/files");
    await page.goto("/");
    await listed;
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    await expect(page.locator(TODO_ROW, { hasText: "fix the tap" })).toBeVisible();
  }

  async function more(page: Page, action: "edit" | "blocked by") {
    await page.getByLabel("more for fix the tap").tap();
    await page.getByLabel(`${action} fix the tap`).tap();
  }

  /**
   * The views read and walked back round to none. The vault is only asked at the first view, so
   * without this a stray tap would change nothing until the answer came.
   */
  async function viewsInHand(page: Page) {
    await button(page, "view").tap();
    await expect(filter(page)).toHaveValue("due:today");
    // One tap for each of the other three default views, and one past the last.
    for (let left = 0; left < 4; left++) await button(page, "view").tap();
    await expect(filter(page)).toHaveValue("");
  }

  /** Every word on the strip tapped once, and none of them moved the list or the view. */
  async function tapStripUnmoved(page: Page) {
    for (const name of ["board", "done", "next", "view"]) await button(page, name).tap();
    await expect(cards(page)).toHaveCount(0);
    await expect(button(page, "done")).toHaveAttribute("aria-pressed", "false");
    await expect(button(page, "next")).toHaveAttribute("aria-pressed", "false");
    await expect(filter(page)).toHaveValue("");
    await expect(page.getByTestId("todo-view")).toHaveCount(0);
  }

  test("A4 the strip stays bare at a tap's height, out of the tab order, on a phone", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault);

    for (const name of ["done", "next", "view", "board"]) {
      await expect(button(page, name)).toHaveAttribute("tabindex", "-1");
      expect(await tapHeight(button(page, name))).toBeGreaterThanOrEqual(44);
    }
    await expect(button(page, "c board")).toHaveCount(0);
  });

  test("A1 I4 a tap on the strip while a row is edited leaves the edit be, vim on", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault, "on");
    await viewsInHand(page);
    await more(page, "edit");
    await expect(page.getByLabel("edit line")).toBeVisible();

    await tapStripUnmoved(page);
    await expect(page.getByLabel("edit line")).toBeVisible();
  });

  test("A2 I4 a tap on the strip while picking a blocker leaves the picker be, vim off", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault, "off");
    await viewsInHand(page);
    await more(page, "blocked by");
    await expect(page.getByTestId("todo-pick")).toBeVisible();

    await tapStripUnmoved(page);
    await expect(page.getByTestId("todo-pick")).toBeVisible();
  });

  for (const key of ["Escape", "Enter"]) {
    test(`I1 once the edit ends by ${key} a tap on the strip works again`, async ({
      page,
      stack,
    }) => {
      await byTouch(page, stack.vault);
      await more(page, "edit");
      await page.getByLabel("edit line").press(key);
      await expect(page.getByLabel("edit line")).toHaveCount(0);

      await button(page, "board").tap();
      await expect(cards(page)).not.toHaveCount(0);
      // Enter writes the line as it stands, so the note keeps it.
      expect(bodyOf(await noteText(stack.vault, NOTE))).toBe(LINES);
    });
  }

  test("I2 once the picker is cancelled a tap on the strip works again", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault);
    await more(page, "blocked by");
    await button(page, "cancel").tap();

    await expect(page.getByTestId("todo-pick")).toHaveCount(0);
    await expect(button(page, "done")).toHaveAttribute("aria-pressed", "false");
    await expect(button(page, "next")).toHaveAttribute("aria-pressed", "false");
    await button(page, "board").tap();
    await expect(cards(page)).not.toHaveCount(0);
  });
});
