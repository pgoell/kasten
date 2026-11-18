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

  test("#523 A9 the strip's agent adds #agent", async ({ page, stack }) => {
    await byTouch(page, stack.vault);
    await page.getByLabel("more for fix the tap").tap();
    await page.getByLabel("agent fix the tap").tap();
    const tagged = LINES.replace("fix the tap", "fix the tap #agent");
    await expect.poll(async () => bodyOf(await noteText(stack.vault, NOTE))).toBe(tagged);
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
      const writes: string[] = [];
      page.on("request", (request) => {
        const path = decodeURIComponent(new URL(request.url()).pathname);
        if (request.method() !== "GET" && path.endsWith(NOTE)) writes.push(path);
      });
      await more(page, "edit");
      await page.getByLabel("edit line").press(key);
      await expect(page.getByLabel("edit line")).toHaveCount(0);

      await button(page, "board").tap();
      await expect(cards(page)).not.toHaveCount(0);
      // Enter writes the line as it stands, and Escape writes nothing; the note keeps its text.
      await expect.poll(() => writes.length).toBe(key === "Enter" ? 1 : 0);
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

test.describe("the board by touch (#394, #429)", () => {
  test.use(phone);
  const PLAN = "02 Projects/FDE/plan.md";
  const lanes = (page: Page) => page.locator("h3:has(button[data-count])");
  const cursor = (page: Page) => page.locator('[data-card][tabindex="0"]');
  const KINDS = ["#client", "#internal", "No kind"];

  /** The board by taps over a todo each kind and lane, the fixture's own todos written over. */
  async function board(page: Page, vault: string) {
    await vaultWith(vault, {
      "02 Projects/Garden.md": "# Garden\n",
      "02 Projects/Home.md": "# Home\n",
      [NOTE]: LINES,
      "01 Notes/Work.md": "- [ ] send the invoice #client\n",
      [PLAN]: "- [ ] write the deck #internal\n  - [/] draw the chart\n",
      "02 Projects/FDE/index.md": "# FDE\n",
      "02 Projects/Kasten/plan.md": "- [ ] send the deck #p/fde\n",
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    await expect(page.locator(TODO_ROW, { hasText: "send the deck" })).toBeVisible();
    await button(page, "board").tap();
    await expect(cards(page).first()).toBeVisible();
  }

  test("A1 A3 #394 board and back, lanes by project with the cursor and focus on the top card, and the tagged card opens", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    expect(await pressed(page, "board")).toBe("true");
    await button(page, "board").tap();
    await expect(page.locator("[data-card]")).toHaveCount(0);
    expect(await pressed(page, "board")).toBe("false");
    await button(page, "board").tap();
    await expect(lanes(page)).toHaveText(KINDS);
    await cursor(page).focus();
    await page.keyboard.press("j");
    await expect(cursor(page)).toContainText("write the deck");

    await button(page, "project").tap();
    await expect(lanes(page)).toHaveText(["No project", "FDE"]);
    await expect(cursor(page)).toContainText("fix the tap");
    await expect(page.locator("[data-card]:focus")).toContainText("fix the tap");
    await button(page, "kind").tap();
    await expect(lanes(page)).toHaveText(KINDS);
    await button(page, "project").tap();
    await expect(lanes(page).filter({ hasText: "FDE" }).locator("..")).toContainText(
      "send the deck",
    );
    await cards(page).filter({ hasText: "send the deck" }).tap();
    await expect(page.locator(".cm-activeLine")).toContainText("send the deck");
  });

  test("#429 A4 the strip names the states in order, sets review on one tap, and the Review tab shows the card", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    await page.getByRole("tab", { name: "Doing 1" }).tap();
    await page.getByLabel("more for draw the chart").tap();
    const states = ["open", "doing", "review", "done", "blocked", "waiting", "rejected"];
    const labels = await page
      .getByRole("button", { name: / draw the chart$/ })
      .evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
    expect(
      labels.filter((label) => states.some((one) => label === `${one} draw the chart`)),
    ).toEqual(states.map((one) => `${one} draw the chart`));
    await page.getByLabel("review draw the chart").tap();
    await expect
      .poll(async () => bodyOf(await noteText(stack.vault, PLAN)))
      .toContain("  - [r] draw the chart\n");
    await page.getByRole("tab", { name: "Review 1" }).tap();
    await expect(cards(page)).toHaveText([/draw the chart/]);
  });
});

test.describe("twins by touch (#530)", () => {
  test.use(phone);

  test("done on the strip of the second of two twins sets that twin after a line above shifted both", async ({
    page,
    stack,
  }) => {
    const twins = "- [ ] water the fern\n- [ ] water the fern\n";
    // The stream held, so the list stays as listed while the note moves under it.
    await page.route("**/api/events", () => new Promise(() => {}));
    await vaultWith(stack.vault, { [NOTE]: `# Errands\n\n${twins}` });
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    await expect(page.getByLabel("more for water the fern")).toHaveCount(2);
    await vaultWith(stack.vault, { [NOTE]: `# Errands\n\n- [ ] buy milk\n${twins}` });
    await page.getByLabel("more for water the fern").nth(1).tap();
    await page.getByLabel("done water the fern").tap();
    await expect
      .poll(async () =>
        bodyOf(await noteText(stack.vault, NOTE))
          .split("\n")
          .slice(2, 5),
      )
      .toEqual([
        "- [ ] buy milk",
        "- [ ] water the fern",
        expect.stringMatching(/^- \[x\] water the fern/),
      ]);
  });
});