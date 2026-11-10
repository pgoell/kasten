import type { Page } from "@playwright/test";
import { panes } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { beside, focusedPane, layout, load, normal, saved, seed } from "./stored.ts";

const LONG = "Long note.md";
const selectedTab = (page: Page) => page.getByRole("tab", { selected: true }).textContent();
const todos = (page: Page) => page.locator("[aria-label='Todos']");
const row = (page: Page, path: string) =>
  page.getByRole("navigation", { name: "Vault" }).locator(`[title='${path}']`);

test.describe("a stored workspace on load", () => {
  test("a todo pane beside a note comes back holding the vault's todos", async ({ page }) => {
    await seed(page, layout([beside({ path: "Welcome.md" }, { todos: true })]));
    await load(page);
    await expect
      .poll(async () => [
        await panes(page).count(),
        await panes(page).filter({ hasText: "front door" }).count(),
        await todos(page).filter({ hasText: "water the tomatoes" }).count(),
      ])
      .toEqual([2, 1, 1]);
  });

  for (const [kind, held] of [
    ["video", { video: LONG }],
    ["person", { person: LONG }],
    ["history", { history: LONG }],
    ["graph", { graph: { around: LONG } }],
  ] as const) {
    test(`a restored ${kind} pane marks the note it was opened from in the tree (#978)`, async ({
      page,
    }) => {
      await seed(page, layout([{ id: "t", root: { id: "a", ...held }, focus: "a" }]));
      await load(page);
      await expect
        .poll(async () => [
          await row(page, LONG).getAttribute("aria-current"),
          await row(page, "Welcome.md").getAttribute("aria-current"),
        ])
        .toEqual(["page", null]);
    });
  }
});

test.describe("a URL naming a note, over a stored workspace", () => {
  test("a note another tab holds goes to that tab", async ({ page }) => {
    await seed(
      page,
      layout([
        { id: "t1", root: { id: "a", path: "Welcome.md" }, focus: "a" },
        { id: "t2", root: { id: "b", path: LONG }, focus: "b" },
      ]),
    );
    await load(page, `/?note=${LONG}`);
    await expect
      .poll(async () => [
        await page.getByRole("tab").count(),
        await selectedTab(page),
        await page.locator(".cm-content", { hasText: "long enough" }).count(),
        await saved(page),
      ])
      .toEqual([2, expect.stringContaining("Long note"), 1, expect.objectContaining({ active: 1 })]);
  });

  test("a note no pane holds opens in the focused pane", async ({ page }) => {
    await seed(page, layout([{ ...beside({ path: "Welcome.md" }, { todos: true }), focus: "b" }]));
    await load(page, `/?note=${LONG}`);
    await expect
      .poll(async () => [
        await panes(page).count(),
        await todos(page).count(),
        await focusedPane(page),
        await saved(page),
      ])
      .toEqual([
        2,
        0,
        1,
        expect.objectContaining({
          tabs: [
            expect.objectContaining({
              focus: 1,
              root: { dir: "row", children: [{ id: 0, path: "Welcome.md" }, { id: 0, path: LONG }] },
            }),
          ],
        }),
      ]);
  });

  test("a plain reload, its URL naming the focused note, changes nothing stored", async ({
    page,
  }) => {
    const entries = layout(
      [
        { id: "t1", root: { id: "a", path: "Welcome.md" }, focus: "a" },
        {
          id: "t2",
          root: { id: "s", dir: "col", children: [{ id: "b", path: LONG }, { id: "c" }] },
          focus: "b",
        },
      ],
      1,
    );
    await seed(page, entries);
    await load(page, `/?note=${LONG}`);
    await expect(page.locator(".cm-content", { hasText: "long enough" })).toBeVisible();
    const before = normal(Object.values(entries)[0]);
    await expect
      .poll(async () => [await saved(page), await selectedTab(page)])
      .toEqual([before, expect.stringContaining("Long note")]);
  });

  test("a line on the focused note jumps to that line over the stored position", async ({
    page,
  }) => {
    await seed(page, {
      ...layout([{ id: "t", root: { id: "a", path: LONG }, focus: "a" }]),
      // Left on line 2 (the stored frontmatter heads the note), which the URL's line must win over.
      "kasten.positions.1": JSON.stringify([[LONG, { anchor: 12, head: 12, top: 0 }]]),
    });
    await load(page, `/?note=${LONG}&line=6`);
    await expect
      .poll(async () => [
        await page.locator(".cm-activeLineGutter").first().textContent(),
        await page.locator(".cm-activeLine").first().textContent(),
      ])
      .toEqual(["6", "A note long enough that its last todo sits past the first screen."]);
  });
});
