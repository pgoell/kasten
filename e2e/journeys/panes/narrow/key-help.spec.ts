import type { Locator } from "@playwright/test";
import { openApp, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** The left edge and top of each box, rounded to the pixel. */
const corners = (all: Locator): Promise<[number, number][]> =>
  all.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return [Math.round(box.x), Math.round(box.y)] as [number, number];
    }),
  );

test("the which-key panel sets its groups side by side, and an open group flows its rows into columns", async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press("Space");
  const panel = page.getByRole("dialog", { name: "Leader keys" });
  await expect(panel.getByRole("heading", { name: "Find" })).toBeVisible();
  const groups = await corners(panel.locator("section:has(> h3)"));
  const firstRow = groups.filter(([, y]) => y === groups[0]?.[1]);
  expect(firstRow.length).toBeGreaterThan(1);

  await page.keyboard.press("g");
  await expect(panel.getByRole("heading", { name: "Go to" })).toBeVisible();
  const rows = await corners(panel.locator("section:has(> h3) button"));
  expect(new Set(rows.map(([x]) => x)).size).toBeGreaterThan(1);
});

test.describe("the key help on a phone", () => {
  test.use(phone);

  test("opens from the palette as a sheet the whole screen tall with a grabber, the filter focused and one column", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: "Show the keys" }).tap();
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    // The grabber, not the header: a drag on either moves the sheet.
    await expect(help.locator("[data-sheet-drag]:not(:has(input))")).toBeVisible();
    await expect(help.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
    // Once the rise ends: the top of the screen, past the 88% a capped sheet stops at.
    await expect
      .poll(async () => {
        const box = await help.boundingBox();
        return box !== null && box.y < 1 && box.height > 890;
      })
      .toBe(true);
    const [space, rest] = await corners(
      help.getByRole("heading", { name: /^(After Space|Vim and the rest)$/, level: 2 }),
    );
    expect(
      space !== undefined && rest !== undefined && space[0] === rest[0] && rest[1] > space[1],
    ).toBe(true);
    await expect(help.getByText("Drag down or tap outside to close")).toBeInViewport();
  });

  // `?` on a phone with a keyboard, from a tapped tab: the palette's own field opens it from the palette.
  test("Esc takes the sheet down and gives the focus back to the tab that held it", async ({
    page,
  }) => {
    await page.goto("/");
    const tab = page.getByRole("tab", { selected: true });
    await tab.tap();
    await expect(tab).toBeFocused();
    await page.keyboard.press("?");
    await expect(page.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tab).toBeFocused();
  });
});
