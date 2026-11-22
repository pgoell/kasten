import type { Locator, Page } from "@playwright/test";
import {
  leader,
  openApp,
  phone,
  plus,
  readAll,
  TODO_ROW,
  vaultWith,
} from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";

// The rows of #811: what each row, the legend and the done fold draw, read off the screen.
const NOTE = "02 Projects/Kasten/Plan.md";
const row = (page: Page, words: string) => page.locator(TODO_ROW, { hasText: words });
const shown = (date: string) => date.slice(5);

/** Writes `lines` to one note and cuts the list's answer to it, so no fixture todo shows. */
async function rows(page: Page, vault: string, lines: string[]): Promise<void> {
  await vaultWith(vault, { [NOTE]: `# Kasten\n\n${lines.join("\n")}\n` });
  await page.route(
    (url) => url.pathname === "/api/todos",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const hits: { path: string }[] = await response.json();
      await route.fulfill({ response, json: hits.filter((hit) => hit.path === NOTE) });
    },
  );
}

/** The computed colour a theme token draws text in. */
const token = (page: Page, name: string) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.color = `var(--k-${name})`;
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
const colour = (target: Locator) => target.evaluate((node) => getComputedStyle(node).color);

/** The fold of the done rows: it names its count, and a click or a tap opens it on that many rows. */
async function fold(page: Page, open: (fold: Locator) => Promise<void>) {
  const heading = page.getByRole("button", { name: /^Done this week/ });
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await expect(heading).toContainText("Done this week 2");
  await expect(row(page, "read the spec")).toHaveCount(0);
  await open(heading);
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "read the spec")).toBeVisible();
  await expect(row(page, "write it")).toBeVisible();
}

const DONE = [`- [x] read the spec ✅ ${plus(0)}`, `- [x] write it ✅ ${plus(0)}`];

test("#811 a row draws its state box, words and meta line, its date by the clock, the cursor as an outline, and the legend each state's box", async ({
  page,
  stack,
}) => {
  await rows(page, stack.vault, [
    "- [/] wire the pane",
    `- [w] wire the API #client ⏱ 1h 👤 ${plus(-5)} [[Alicia]] ⛔ kt-aaaaaa`,
    "  - [x] part one",
    "  - [ ] part two",
    "  - [ ] part three",
    "- [ ] ship it 🆔 kt-aaaaaa",
    "- [ ] file #work the expense report #client",
    `- [ ] late thing 📅 ${plus(-3)}`,
    `- [ ] later thing 📅 ${plus(7)}`,
    "- [ ] buy milk 👤 [[Pascal]]",
    ...DONE,
  ]);
  await openApp(page);
  await leader(page, "gt");
  await expect(row(page, "buy milk")).toBeVisible();

  await expect(row(page, "wire the pane").locator('svg[data-state="doing"]')).toHaveCount(1);
  const api = row(page, "wire the API");
  for (const part of ["Kasten", "#client", "👤 5d Alicia", "⛔ ship it", "1/3", "⏱ 1h"]) {
    await expect(api).toContainText(part);
  }
  const report = row(page, "expense report");
  await expect(report.getByText("file #work the expense report", { exact: true })).toBeVisible();
  await expect(report.getByText("#work #client", { exact: true })).toBeVisible();
  await expect(report).toHaveAttribute("title", new RegExp(`^${NOTE}:\\d+$`));
  const chips = row(page, "buy milk").locator("[data-person]");
  await expect(chips).toHaveCount(1);
  await expect(chips).toHaveAttribute("data-person", "[[Pascal]]");
  await expect(chips.locator("..")).toContainText("Kasten");

  const late = row(page, "late thing").getByText(shown(plus(-3)), { exact: true });
  const later = row(page, "later thing").getByText(shown(plus(7)), { exact: true });
  expect(await colour(late)).toBe(await token(page, "danger"));
  expect(await colour(later)).toBe(await token(page, "muted"));
  // No ground from the date up to its row is the surface's: the danger text sits on the pane's.
  const grounds = await late.evaluate((date) => {
    const out: string[] = [];
    for (
      let node: Element | null = date;
      node && !node.matches("[data-row]");
      node = node.parentElement
    )
      out.push(getComputedStyle(node).backgroundColor);
    return [...out, getComputedStyle(date.closest("[data-row]") as Element).backgroundColor];
  });
  expect(grounds).not.toContain(await token(page, "surface").then((c) => c));

  // The cursor row carries an outline and no tint; the others carry neither.
  const looks = await readAll(page, TODO_ROW, (all) =>
    all.map((node) => [
      node.getAttribute("tabindex"),
      getComputedStyle(node).outlineStyle,
      getComputedStyle(node).backgroundColor,
      getComputedStyle(node).outlineColor,
    ]),
  );
  const cursor = looks.filter(([tab]) => tab === "0");
  expect(cursor).toHaveLength(1);
  // Solid in the accent: a focused button with no outline of its own still gets the browser's ring.
  expect(cursor[0]?.[1]).toBe("solid");
  expect(cursor[0]?.[3]).toBe(await token(page, "accent"));
  expect(looks.map(([, , ground]) => ground)).toEqual(looks.map(() => "rgba(0, 0, 0, 0)"));
  expect(looks.filter(([tab, outline]) => tab !== "0" && outline !== "none")).toEqual([]);

  // Seven boxes, each its state's own and none drawn like another.
  const legend = await readAll(page, '[aria-label="legend"] li', (all) =>
    all.map((li) => [
      li.title,
      li.querySelector("svg")?.getAttribute("data-state"),
      li.querySelector("svg")?.innerHTML,
    ]),
  );
  expect(legend.map(([state]) => state)).toEqual([
    "open",
    "doing",
    "review",
    "waiting",
    "blocked",
    "done",
    "rejected",
  ]);
  expect(legend.map(([, box]) => box)).toEqual(legend.map(([state]) => state));
  expect(new Set(legend.map(([, , drawing]) => drawing)).size).toBe(7);

  await fold(page, (heading) => heading.click());
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#811 the state button draws its box and asks with the next one, overdue dates stay danger on a muted row, and a done row draws the done box", async ({
    page,
    stack,
  }) => {
    const due = plus(-3);
    await rows(page, stack.vault, [
      `- [r] write the parser 📅 ${plus(3)}`,
      `- [b] ship it 📅 ${due}`,
      `- [ ] buy milk 📅 ${due}`,
      ...DONE,
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();

    const state = page.getByRole("button", { name: "cycle write the parser" });
    await expect(state.locator('svg[data-state="review"]')).toHaveCount(1);
    await state.tap();
    await expect(state.locator('svg[data-state="done"]')).toHaveCount(1);
    await expect(state).toHaveText("?");

    const danger = await token(page, "danger");
    for (const words of ["ship it", "buy milk"]) {
      expect(await colour(row(page, words).getByText(shown(due), { exact: true }))).toBe(danger);
    }

    await fold(page, (heading) => heading.tap());
    const done = row(page, "read the spec").locator("..");
    await expect(done.locator('svg[data-state="done"]')).toHaveCount(1);
  });
});
