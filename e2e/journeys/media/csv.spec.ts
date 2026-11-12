import type { Page } from "@playwright/test";
import { openApp, phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const ATTACK = `<img src=x onerror="fetch('/csv-ran-img')">`;
const SCRIPT = `<script>fetch('/csv-ran-script')</script>`;

/** A semicolon file behind a BOM, as Excel writes one, with a quoted cell and two that try html. */
const SALES = `﻿Product;Region;Amount;Note\r\n"Apples; red";North;1,50;${ATTACK}\r\nPears;South;2,25;${SCRIPT}\r\nPlums;East;3,00;"say ""hi"""\r\n`;

const NOTE = "# Sales\n\nThe table:\n\n![[sales.csv]]\n\n[[sales.csv]] opens it.\n";

/** Every request a cell would send if its html ran, so a test can say none went. */
function ranRequests(page: Page): string[] {
  const ran: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/csv-ran")) ran.push(request.url());
  });
  return ran;
}

async function seeded(vault: string): Promise<void> {
  await vaultWith(vault, { "data/sales.csv": SALES, "01 Notes/Sales.md": NOTE });
}

async function openSales(page: Page): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent("01 Notes/Sales.md")}`);
  await expect(page.getByText("The table:")).toBeVisible({ timeout: 15_000 });
}

/** The table inside `scope`, its cells read back as text and no element made from any of them. */
async function expectTable(page: Page, scope: string): Promise<void> {
  const table = page.locator(`${scope} table.cm-table-grid`);
  await expect(table).toBeVisible();
  await expect(table.locator("th")).toHaveText(["Product", "Region", "Amount", "Note"]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(0).locator("td")).toHaveText([
    "Apples; red",
    "North",
    "1,50",
    ATTACK,
  ]);
  await expect(table.locator("tbody tr").nth(1).locator("td").nth(3)).toHaveText(SCRIPT);
  await expect(table.locator("tbody tr").nth(2).locator("td").nth(3)).toHaveText('say "hi"');
  await expect(table.locator("img, script")).toHaveCount(0);
}

test("a csv draws in live preview as a table whose cells are text", async ({ page, stack }) => {
  await seeded(stack.vault);
  const ran = ranRequests(page);
  await openSales(page);

  await expectTable(page, ".cm-embed-csv");
  await page.screenshot({ path: test.info().outputPath("csv-desktop.png") });
  expect(ran).toEqual([]);
});

test("gf on a csv link opens the table in the pane", async ({ page, stack }) => {
  await seeded(stack.vault);
  const ran = ranRequests(page);
  await openSales(page);

  await page.keyboard.type("7Ggf");

  await expectTable(page, "[data-csv-table]");
  await expect(page.locator("[data-image-pane]")).toHaveAttribute("aria-label", "table");
  expect(ran).toEqual([]);
});

test("a csv opens from the file tree as a table", async ({ page, stack }) => {
  await seeded(stack.vault);
  await openApp(page);

  await page.getByRole("button", { name: "data", exact: true }).click();
  await page.getByRole("button", { name: "sales.csv", exact: true }).click();

  await expectTable(page, "[data-csv-table]");
});

test("in a short pane the last row and the side scroll of a long csv can be reached", async ({
  page,
  stack,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  const rows = Array.from({ length: 300 }, (_, i) => `row ${i + 1},${"wide ".repeat(60)}`);
  await vaultWith(stack.vault, { "data/long.csv": `n,text\n${rows.join("\n")}\n` });
  await openApp(page);

  await page.getByRole("button", { name: "data", exact: true }).click();
  await page.getByRole("button", { name: "long.csv", exact: true }).click();
  const scroll = page.locator("[data-csv-table] .cm-table-scroll");
  await expect(scroll.locator("tbody tr")).toHaveCount(300);
  await scroll.evaluate((box) => box.scrollTo(box.scrollWidth, box.scrollHeight));

  const pane = await page.locator("[data-image-pane]").boundingBox();
  const shown = await scroll.boundingBox();
  const last = await scroll.locator("tbody tr").last().boundingBox();
  expect((shown?.y ?? 0) + (shown?.height ?? 0)).toBeLessThanOrEqual(
    (pane?.y ?? 0) + (pane?.height ?? 0) + 1,
  );
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(
    (shown?.y ?? 0) + (shown?.height ?? 0) + 1,
  );
});

test("the raw csv opened in a tab is text, never html", async ({ page, stack }) => {
  await seeded(stack.vault);
  const ran = ranRequests(page);

  const answer = await page.request.get("/api/assets/data/sales.csv");

  expect(answer.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(answer.headers()["x-content-type-options"]).toBe("nosniff");
  expect(ran).toEqual([]);
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("a csv draws in live preview, and ctrl and a click on its link opens the table", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    const ran = ranRequests(page);
    await openSales(page);

    await expectTable(page, ".cm-embed-csv");
    await page.locator(".cm-wikilink", { hasText: "sales.csv" }).click({ modifiers: ["Control"] });

    await expectTable(page, "[data-csv-table]");
    expect(ran).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a csv draws at 414 px, scrolls inside its box, and a tap on its link opens it", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    const ran = ranRequests(page);
    await openSales(page);

    await expectTable(page, ".cm-embed-csv");
    await page.screenshot({ path: test.info().outputPath("csv-phone.png") });
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(414);

    await page.locator(".cm-wikilink", { hasText: "sales.csv" }).tap();
    await expectTable(page, "[data-csv-table]");
    expect(ran).toEqual([]);
  });
});
