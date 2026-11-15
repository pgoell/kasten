import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  phone,
  TODO_ROW,
  tapHeight,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("dragging a card to the doing column writes its doing mark", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  // The list first, so `c` turns a loaded list into the board.
  await expect(page.locator('[data-row*=".md:"]', { hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  const card = page.locator("[data-card]", { hasText: "fold the laundry" });
  await expect(card).toBeVisible();
  // The doing cell in the card's own lane, so the drop stays within one project.
  const lane = await card.evaluate((el) => el.closest("[data-column]")?.getAttribute("data-lane"));
  const doing = page.locator(`[data-column="doing"][data-lane="${lane}"]`);
  const from = await card.boundingBox();
  const to = await doing.boundingBox();
  if (!from || !to) throw new Error("the card or the doing cell is not on the screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => noteText(stack.vault, "02 Projects/Home.md"), { timeout: 15_000 })
    .toMatch(/^- \[\/\] fold the laundry/m);
});

test("c flips the todo pane from the list to the board and back", async ({ page }) => {
  await openApp(page);
  await leader(page, "gt");
  const rows = page.locator(TODO_ROW);
  const cards = page.locator("[data-card]");
  await expect(rows.filter({ hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(cards.filter({ hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(cards).toHaveCount(0);
  await expect(rows.filter({ hasText: "fold the laundry" })).toBeVisible();
});

/** Every note in the vault by its path, to see that nothing on disk moved. */
async function notes(vault: string): Promise<Record<string, string>> {
  const all: Record<string, string> = {};
  for (const path of await readdir(vault, { recursive: true }))
    if (path.endsWith(".md")) all[path] = await readFile(join(vault, path), "utf8");
  return all;
}

test("folding, the filter, a tag chip, All, the shared lists toggle and c write nothing", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "02 Projects/Errands.md": `# Errands\n\n- [ ] call the dentist #client\n- [x] read the spec ✅ ${today()}\n`,
    "05 Shared/Einkauf.md": "# Einkauf\n\n- [ ] buy eggs\n",
  });
  await openApp(page);
  await leader(page, "gt");
  const row = (text: string) => page.locator(TODO_ROW, { hasText: text });
  await expect(row("call the dentist")).toBeVisible();
  const before = await notes(stack.vault);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/"))
      writes.push(`${request.method()} ${request.url()}`);
  });

  await page.keyboard.press("c");
  await expect(page.locator("[data-card]").first()).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator("[data-card]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Done this week/ }).click();
  await expect(row("read the spec")).toBeVisible();
  await page.getByLabel("filter todos").fill("buy");
  await expect(row("fold the laundry")).toHaveCount(0);
  await expect(row("buy seed potatoes")).toBeVisible();
  await page.getByRole("button", { name: "#client", exact: true }).click();
  await expect(row("buy seed potatoes")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(row("buy seed potatoes")).toBeVisible();
  await expect(row("buy eggs")).toHaveCount(0);
  await page.getByRole("button", { name: /^Shared lists, 1 hidden/ }).click();
  await expect(row("buy eggs")).toBeVisible();

  // One real tick last: once its line and its done log land, a write the controls sent would have too.
  await cursorTo(page, "buy seed potatoes");
  await page.keyboard.press("X");
  const garden = "02 Projects/Garden.md";
  const daily = `01 Periodic/00 Daily/${today()}.md`;
  await expect
    .poll(() => noteText(stack.vault, garden), { timeout: 15_000 })
    .toMatch(/^- \[x\] buy seed potatoes/m);
  await expect.poll(() => noteText(stack.vault, daily)).toContain("buy seed potatoes");
  expect(
    writes.map((write) => decodeURIComponent(write.replace(/ http[^ ]*\/api\//, " "))),
  ).toEqual([`PUT files/${garden}`, `POST files/${daily}`]);
  // The tick's own: its line, and the daily note it logs to with the folder listings made for it.
  const untouched = (all: Record<string, string>) =>
    Object.entries(all).filter(([path]) => path !== garden && !path.startsWith("01 Periodic/"));
  expect(untouched(await notes(stack.vault))).toEqual(untouched(before));
});

test.describe("on a phone", () => {
  test.use(phone);

  test("every tap target of the board is at least 44 px high: the lane switch, a state tab, a lane's heading, a card and its ⋯", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "board", exact: true }).tap();
    const card = page.locator("[data-card]", { hasText: "fold the laundry" });
    await expect(card).toBeVisible();
    const lane = page
      .locator("[data-lane]", { has: card })
      .getByRole("heading")
      .getByRole("button");
    for (const target of [
      page.getByRole("button", { name: "kind", exact: true }),
      page.getByRole("button", { name: "project", exact: true }),
      page.getByRole("tab", { name: /^Open \d+$/ }),
      lane,
      card,
      page.getByRole("button", { name: "more for fold the laundry" }),
    ])
      expect(await tapHeight(target), `${target}`).toBeGreaterThanOrEqual(44);
  });
});

const PLAN = "02 Projects/FDE/plan.md";

/** A plan whose todos fill the kind lanes, the board open on it with the cards drawn. */
async function board(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, {
    [PLAN]: `# Plan\n\n- [ ] write the deck #internal\n- [/] draw the chart #internal\n- [ ] send the invoice #client\n- [-] drop the logo ❌ ${today()}\n`,
  });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "write the deck" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator("[data-card]", { hasText: "write the deck" })).toBeVisible();
}

/** The button that folds the lane a heading names; the kind filter's pill shares the name. */
const laneButton = (page: Page, name: string) =>
  page.locator("h3", { hasText: new RegExp(`^${name}$`) }).getByRole("button");

/** The lane headings' names; the count is drawn from an attribute, so it is no part of the text. */
const lanes = (page: Page) => page.locator("h3:has(button[data-count])");

const card = (page: Page, words: string) => page.locator("[data-card]", { hasText: words });

test.describe("the board's lanes and folds (#811)", () => {
  test("the project switch draws the lanes by project in place of kind", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    const project = page.getByRole("button", { name: "project", exact: true });
    const kind = page.getByRole("button", { name: "kind", exact: true });
    await expect(project).toHaveAttribute("aria-pressed", "false");
    await expect(lanes(page)).toHaveText(["#client", "#internal", "No kind"]);

    await project.click();

    await expect(project).toHaveAttribute("aria-pressed", "true");
    await expect(kind).toHaveAttribute("aria-pressed", "false");
    await expect(lanes(page)).toHaveText(["No project", "FDE"]);
  });

  test("a click on a lane heading folds the lane, keeping its count, and a second unfolds it", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    const internal = laneButton(page, "#internal");
    await expect(internal).toHaveAttribute("aria-expanded", "true");

    await internal.click();

    await expect(internal).toHaveAttribute("aria-expanded", "false");
    await expect(internal).toHaveAttribute("data-count", "2");
    await expect(card(page, "write the deck")).toHaveCount(0);
    await expect(card(page, "send the invoice")).toBeVisible();

    await internal.click();

    await expect(internal).toHaveAttribute("aria-expanded", "true");
    await expect(card(page, "write the deck")).toBeVisible();
  });

  test("a card let go over a folded lane drops back and writes nothing", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    // Lanes by project, where a drop in another lane refiles the card: a write, if one got through.
    await page.getByRole("button", { name: "project", exact: true }).click();
    const fde = laneButton(page, "FDE");
    await fde.click();
    await expect(fde).toHaveAttribute("aria-expanded", "false");
    const before = await notes(stack.vault);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url());
    });

    const from = await card(page, "fold the laundry").boundingBox();
    const to = await fde.boundingBox();
    if (!from || !to) throw new Error("the card or the folded heading is not on the screen");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
    await expect(page.locator("[data-lifted]")).toHaveCount(1);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator("[data-lifted]")).toHaveCount(0);
    // Another act the next moment, so a refile the folded lane sent would have gone out first.
    await fde.click();
    await expect(fde).toHaveAttribute("aria-expanded", "true");
    expect(writes).toEqual([]);
    await expect(page.getByTestId("notice")).toHaveCount(0);
    expect(await notes(stack.vault)).toEqual(before);
  });

  test("Rejected starts folded on a desktop; a click and l onto it unfold it, and a click and h fold it", async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault);
    const rejected = page.getByRole("button", { name: "Rejected 1" });
    await expect(rejected).toHaveAttribute("aria-expanded", "false");
    await expect(card(page, "drop the logo")).toHaveCount(0);

    await rejected.click();
    await expect(rejected).toHaveAttribute("aria-expanded", "true");
    await expect(card(page, "drop the logo")).toBeVisible();
    await rejected.click();
    await expect(rejected).toHaveAttribute("aria-expanded", "false");
    await expect(card(page, "drop the logo")).toHaveCount(0);

    // From Open, where the cursor starts, to Rejected is six columns.
    for (let step = 0; step < 6; step += 1) await page.keyboard.press("l");
    await expect(rejected).toHaveAttribute("aria-expanded", "true");
    await expect(card(page, "drop the logo")).toBeVisible();
    await page.keyboard.press("h");
    await expect(rejected).toHaveAttribute("aria-expanded", "false");
    await expect(card(page, "drop the logo")).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a lane with nothing in the shown state is folded and cannot be opened", async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, {
        [PLAN]:
          "# Plan\n\n- [ ] write the deck #internal\n- [/] draw the chart #internal\n- [ ] send the invoice #client\n",
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Open the todo pane" }).tap();
      await page.getByRole("button", { name: "board", exact: true }).tap();
      await expect(card(page, "send the invoice")).toBeVisible();

      await page.getByRole("tab", { name: "Doing 1" }).tap();

      await expect(laneButton(page, "#client")).toBeDisabled();
      await expect(laneButton(page, "#client")).toHaveAttribute("aria-expanded", "false");
      await expect(laneButton(page, "#internal")).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("[data-card]:visible")).toHaveText(["draw the chart"]);
    });
  });
});

test.describe("the list's edit row through a redraw that moves its line (#2087)", () => {
  const GARDEN = "02 Projects/Garden.md";
  const garden = (vault: string) => noteText(vault, GARDEN);
  const draft = (page: Page) => page.getByLabel("edit line");

  /** Holds every save of Garden.md until the call it returns. */
  async function heldSaves(page: Page) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${GARDEN}`,
      async (route) => {
        if (route.request().method() === "PUT") await gate;
        await route.fallback();
      },
    );
    return release;
  }

  /** The listing that puts the tomatoes off line 5, where the note first had them. */
  const moved = (page: Page) =>
    page.waitForResponse(async (response) => {
      if (!response.url().includes("/api/todos")) return false;
      const hits = (await response.json()) as { path: string; line: number; text: string }[];
      return hits.some((hit) => hit.path === GARDEN && hit.text.includes("tomatoes") && hit.line !== 5);
    });

  /** `x` then `i` on the tomatoes, typing mid-line before and slowly after the redraw, then Enter. */
  async function typeThroughRedraw(page: Page, vault: string, release: () => void) {
    await cursorTo(page, "water the tomatoes");
    await page.keyboard.press("x");
    await expect(page.getByRole("button", { name: "doing water the tomatoes" })).toBeVisible();
    await page.keyboard.press("i");
    await expect(draft(page)).toBeFocused();
    // Mid-line, so a caret the redraw put back at the end would show in the words.
    await page.keyboard.press("Home");
    for (const _ of "- [/] water the ") await page.keyboard.press("ArrowRight");
    await page.keyboard.type("red ");
    const listed = moved(page);
    release();
    await listed;
    await page.keyboard.type("ripe ", { delay: 150 });
    await expect(draft(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => garden(vault)).toMatch(/^- \[\/\] water the red ripe tomatoes/m);
    await expect(page.getByTestId("notice")).toHaveCount(0);
  }

  test("x then i keeps the row and every typed key through the redraw, and Enter writes them", async ({
    page,
    stack,
  }) => {
    const release = await heldSaves(page);
    await openApp(page);
    await leader(page, "gt");
    await typeThroughRedraw(page, stack.vault, release);
  });

  test("with vim off, x then i keeps the row through the redraw, and Enter writes it", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    const release = await heldSaves(page);
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
    await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
    await typeThroughRedraw(page, stack.vault, release);
  });

  const EDITS = "02 Projects/Edits.md";
  const edits = (vault: string) => noteText(vault, EDITS);
  const notice = (page: Page) => page.getByTestId("notice");

  /** `i` on `words` in Edits.md, ` now` typed at its end; answers the note as listed. */
  async function editing(page: Page, vault: string, lines: string, words: string, nth = 0) {
    await vaultWith(vault, { [EDITS]: lines });
    await openApp(page);
    await leader(page, "gt");
    await cursorTo(page, words, nth);
    await page.keyboard.press("i");
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    return edits(vault);
  }

  test("an edit whose line changed writes nothing, says so, keeps the text, and goes once the line reads as before", async ({
    page,
    stack,
  }) => {
    const listed = await editing(page, stack.vault, "- [ ] call the plumber\n", "call the plumber");
    await vaultWith(stack.vault, { [EDITS]: listed.replace("plumber", "plumber today") });
    await page.keyboard.press("Enter");
    await expect(notice(page)).toHaveText("Nothing moved: that line has changed since the edit opened");
    await expect(draft(page)).toHaveValue("- [ ] call the plumber now");
    await expect(draft(page)).toBeFocused();
    expect(await edits(stack.vault)).toMatch(/^- \[ \] call the plumber today$/m);
    await vaultWith(stack.vault, { [EDITS]: listed });
    await page.keyboard.press("Enter");
    await expect.poll(() => edits(stack.vault)).toMatch(/^- \[ \] call the plumber now$/m);
  });

  test("an edit that fails with a 500 says so and keeps the text for another Enter", async ({ page, stack }) => {
    await editing(page, stack.vault, "- [ ] mend the fence\n", "mend the fence");
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${EDITS}`,
      (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.fallback(),
    );
    await page.keyboard.press("Enter");
    await expect(notice(page)).toContainText("Nothing moved:");
    await expect(draft(page)).toHaveValue("- [ ] mend the fence now");
    await page.unrouteAll();
    await page.keyboard.press("Enter");
    await expect.poll(() => edits(stack.vault)).toMatch(/^- \[ \] mend the fence now$/m);
  });

  test("an edit row follows its todo when lines land above it, and Enter writes there", async ({ page, stack }) => {
    const listed = await editing(page, stack.vault, "- [ ] sweep the porch\n", "sweep the porch");
    await vaultWith(stack.vault, { [EDITS]: listed.replace("- [ ] sweep", "- [ ] one\n- [ ] two\n- [ ] sweep") });
    await expect(page.locator(TODO_ROW).filter({ hasText: "two" })).toBeVisible();
    await page.keyboard.type("!", { delay: 100 });
    await page.keyboard.press("Enter");
    await expect.poll(() => edits(stack.vault)).toMatch(/^- \[ \] two\n- \[ \] sweep the porch now!$/m);
  });

  test("of two twins, an edit row whose twin left closes, keeping its text in the notice, and the keys work again", async ({
    page,
    stack,
  }) => {
    const listed = await editing(page, stack.vault, "- [ ] same\n- [ ] same\n", "same", 1);
    await vaultWith(stack.vault, { [EDITS]: listed.replace("- [ ] same\n", "") });
    await expect(notice(page)).toContainText("The edit read: - [ ] same now");
    await expect(draft(page)).toHaveCount(0);
    expect(await edits(stack.vault)).toMatch(/^- \[ \] same$/m);
    await cursorTo(page, "same");
    await page.keyboard.press("x");
    await expect.poll(() => edits(stack.vault)).toMatch(/^- \[\/\] same/m);
  });
});
