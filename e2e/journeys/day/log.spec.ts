import type { Page } from "@playwright/test";
import { findNote, leader, noteText, openApp, phone, today, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const dailyText = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

test("a beer logged in the log pane shows as an entry and lands under ## Log in today's note", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane).toBeVisible();
  await pane.getByRole("button", { name: "Log alcohol" }).click();
  await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
  await expect
    .poll(() => dailyText(stack.vault), {
      timeout: 15_000,
    })
    .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a beer tapped in the log pane opened from the palette lands under ## Log in today's note", async ({
    page,
    stack,
  }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Open the log/ }).tap();
    const pane = page.getByRole("region", { name: "Log" });
    await pane.getByRole("button", { name: "Log alcohol" }).tap();
    await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
    await expect
      .poll(() => dailyText(stack.vault), { timeout: 15_000 })
      .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
  });
});

const LOG_CONFIG = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1\n- ⚖ weight: kg, last\n";
const PAST = "01 Periodic/00 Daily/2026-10-20.md";
const PAST_NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write\n";

/** Runs the palette's Log weight row, which the config note's `last` kind adds. */
async function logWeight(page: Page): Promise<void> {
  await leader(page, ":");
  await page.getByRole("option", { name: /^Log weight/ }).click();
}

test.describe("the palette's Log weight", () => {
  test.beforeEach(async ({ stack }) => {
    await vaultWith(stack.vault, { "99 Misc/01 Config/log.md": LOG_CONFIG, [PAST]: PAST_NOTE });
  });

  // A past day, so the palette's own ask on the card acts and not the hand-off to today's note.
  test("over a daily note's card asks on that card and writes no line", async ({ page, stack }) => {
    await openApp(page);
    await findNote(page, "2026-10-20");
    const card = page.locator(".cm-log");
    await expect(card.getByRole("button", { name: "Log weight" })).toBeVisible();
    await logWeight(page);
    await expect(card.locator(".cm-log-why")).toHaveText("Type the weight in kg");
    await expect(page.getByRole("tab", { name: "2026-10-20", selected: true })).toBeVisible();
    expect(await noteText(stack.vault, PAST)).toBe(PAST_NOTE);
    expect(await dailyText(stack.vault)).toBe("");
  });

  test("away from a card opens today's note and asks on its card, writing no line", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    await findNote(page, "Welcome");
    await logWeight(page);
    await expect(page.getByRole("tab", { name: today(), selected: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".cm-log .cm-log-why")).toHaveText("Type the weight in kg");
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).not.toBe("");
    expect(await dailyText(stack.vault)).not.toContain("⚖");
  });
});
