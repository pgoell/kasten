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

/** Every todo in the store, as `GET /api/todos` renders each one, a line apiece. */
async function store(url: string): Promise<string> {
  const hits = (await (await fetch(`${url}/api/todos`)).json()) as { text: string }[];
  return hits.map((hit) => hit.text).join("\n");
}

test("dragging a card to the doing column sets it doing in the store", async ({ page, stack }) => {
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
    .poll(() => store(stack.url), { timeout: 15_000 })
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

test("folding, the filter, a tag chip, All and c write nothing", async ({ page, stack }) => {
  await vaultWith(stack.vault, {
    "02 Projects/Errands.md": `# Errands\n\n- [ ] call the dentist #client\n- [x] read the spec ✅ ${today()}\n`,
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

  // One real tick last: once it lands, a write the controls sent would have too.
  await cursorTo(page, "buy seed potatoes");
  await page.keyboard.press("X");
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \[x\] buy seed potatoes/m);
  expect(writes.map((write) => write.replace(/ http[^ ]*\/api\//, " "))).toEqual([
    expect.stringMatching(/^POST todos\/kt-[0-9a-f]{6}\/state$/),
  ]);
  // A store write touches no note.
  expect(await notes(stack.vault)).toEqual(before);
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
      await expect(page.locator("[data-card]:visible")).toHaveText([/^draw the chart/]);
    });
  });
});

test.describe("the list's edit row through a redraw that moves its row (#2087)", () => {
  const draft = (page: Page) => page.getByLabel("edit line");

  /** Holds every cycle sent to the store until the call it returns. */
  async function heldCycles(page: Page) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/todos\/kt-[0-9a-f]{6}\/cycle$/, async (route) => {
      await gate;
      await route.fallback();
    });
    return release;
  }

  /** The listing that has the tomatoes doing, which moves their row to the doing group. */
  const moved = (page: Page) =>
    page.waitForResponse(async (response) => {
      if (!/\/api\/todos(\?|$)/.test(response.url())) return false;
      const hits = (await response.json()) as { text: string }[];
      return hits.some((hit) => hit.text.startsWith("- [/] water the tomatoes"));
    });

  /** `x` then `i` on the tomatoes, typing mid-line before and slowly after the redraw, then Enter. */
  async function typeThroughRedraw(page: Page, url: string, release: () => void) {
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
    await expect.poll(() => store(url)).toMatch(/^- \[\/\] water the red ripe tomatoes/m);
    await expect(page.getByTestId("notice")).toHaveCount(0);
  }

  test("x then i keeps the row and every typed key through the redraw, and Enter writes them", async ({
    page,
    stack,
  }) => {
    const release = await heldCycles(page);
    await openApp(page);
    await leader(page, "gt");
    await typeThroughRedraw(page, stack.url, release);
  });

  test("with vim off, x then i keeps the row through the redraw, and Enter writes it", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    const release = await heldCycles(page);
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
    await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
    await typeThroughRedraw(page, stack.url, release);
  });

  const EDITS = "02 Projects/Edits.md";
  const notice = (page: Page) => page.getByTestId("notice");
  /** The line edits go to, for a route to stand in for the store. */
  const LINE_PUT = /\/api\/todos\/kt-[0-9a-f]{6}\/line$/;

  /** `i` on `words` in Edits.md, ` now` typed after the words. */
  async function editing(page: Page, vault: string, lines: string, words: string) {
    await vaultWith(vault, { [EDITS]: lines });
    await openApp(page);
    await leader(page, "gt");
    await cursorTo(page, words);
    await page.keyboard.press("i");
    await expect(draft(page)).toBeFocused();
    await page.keyboard.press("Home");
    for (const _ of `- [ ] ${words}`) await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" now");
  }

  test("an edit that fails with a 500 says so and keeps the text for another Enter", async ({
    page,
    stack,
  }) => {
    await editing(page, stack.vault, "- [ ] mend the fence\n", "mend the fence");
    await page.route(LINE_PUT, (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.fallback(),
    );
    await page.keyboard.press("Enter");
    await expect(notice(page)).toContainText("Nothing moved:");
    await expect(draft(page)).toHaveValue(/^- \[ \] mend the fence now/);
    await page.unrouteAll();
    await page.keyboard.press("Enter");
    await expect.poll(() => store(stack.url)).toMatch(/^- \[ \] mend the fence now /m);
    await expect(notice(page)).toHaveCount(0);
  });

  test("an edit row follows its todo when rows land above it, and Enter writes there", async ({
    page,
    stack,
  }) => {
    await editing(page, stack.vault, "- [ ] sweep the porch\n", "sweep the porch");
    const note = await noteText(stack.vault, EDITS);
    await vaultWith(stack.vault, { [EDITS]: `- [ ] one\n- [ ] two\n${note}` });
    await expect(page.locator(TODO_ROW).filter({ hasText: "two" })).toBeVisible();
    await page.keyboard.type("!", { delay: 100 });
    await page.keyboard.press("Enter");
    await expect.poll(() => store(stack.url)).toMatch(/^- \[ \] sweep the porch now! /m);
    expect(await store(stack.url)).toMatch(/^- \[ \] two /m);
  });

  test("an edit row whose todo left the list closes, keeping its text in the notice, and the keys work again", async ({
    page,
    stack,
  }) => {
    await editing(
      page,
      stack.vault,
      "- [ ] fix the drain\n- [ ] clear the gutter\n",
      "fix the drain",
    );
    const hits = (await (await fetch(`${stack.url}/api/todos`)).json()) as {
      text: string;
      todo: { id: string };
    }[];
    const id = hits.find((hit) => hit.text.includes("fix the drain"))?.todo.id;
    await fetch(`${stack.url}/api/todos/${id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "rejected" }),
    });
    // A store write sends no event; a note written beside it makes the pane read the list again.
    await vaultWith(stack.vault, { "Elsewhere.md": "a write the vault's events carry\n" });
    await expect(notice(page)).toContainText("The edit read: - [ ] fix the drain now");
    await expect(draft(page)).toHaveCount(0);
    expect(await store(stack.url)).toMatch(/^- \[-\] fix the drain /m);
    await cursorTo(page, "clear the gutter");
    await page.keyboard.press("x");
    await expect.poll(() => store(stack.url)).toMatch(/^- \[\/\] clear the gutter/m);
  });
});
