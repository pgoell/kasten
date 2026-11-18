import type { Locator, Page } from "@playwright/test";
import { bodyOf, leader, noteText, openApp, plus, today, vaultWith } from "../../../harness/app.ts";
import { expect } from "../../../harness/stack.ts";

export const CONFIG_PATH = "99 Misc/01 Config/log.md";
export const CONFIG = `- 💧 water: 250 ml, min 2000
- ☕ coffee: 1, max 3
- 🍺 alcohol: 1
- 🥤 juice: 200 ml, max 500
- 🍽 food: kcal max 2000, protein min 100
`;
export const OATS = "- 🍽 breakfast: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g";
/** Today's log: two drinks, a kind of your own, and food under a meal and under none. */
export const DAY = ["- 💧 500 ml", "- ☕ 2", "- 🥤 200 ml", OATS, "- 🍽 apple 🔥 80 kcal"];
export const TODAY = today();
export const PAST = plus(-1);
export const daily = (date: string) => `01 Periodic/00 Daily/${date}.md`;
// Stamped as kasten writes a note: a first save stamps a bare one, which moves its lines and fails an undo (#2173).
const STAMP =
  "---\nid: 1\ncreated: 2026-11-01T00:00:00+00:00\ntype: note\nmodified: 2026-11-01T00:00:00+00:00\n---\n";
export const note = (lines: string[]) => `${STAMP}# Day\n\n## Log\n${lines.join("\n")}\n`;

/** The log lines in a day's note on disk. */
export const lines = async (vault: string, date = TODAY) =>
  bodyOf(await noteText(vault, daily(date)))
    .split("\n")
    .filter((line) => line.startsWith("- "));

/** Writes the config, today's log (`day`) and a litre of water yesterday, and opens the log pane. */
export async function logPane(
  page: Page,
  vault: string,
  how: "leader" | "palette" | "phone" = "leader",
  day = DAY,
  config = CONFIG,
): Promise<Locator> {
  await vaultWith(vault, {
    [CONFIG_PATH]: config,
    [daily(TODAY)]: note(day),
    [daily(PAST)]: note(["- 💧 1 l"]),
  });
  if (how === "phone") {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
    await page.getByRole("option", { name: /^Open the log/ }).tap();
  } else {
    if (how === "palette") {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    }
    await openApp(page);
    if (how === "leader") await leader(page, "gf");
    else {
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: /^Open the log/ }).click();
    }
  }
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("button", { name: day[0].slice(2) })).toBeVisible({
    timeout: 15_000,
  });
  return pane;
}

/** Each GET /api/log the page sends, as `from..to`. */
export function logReads(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/log") {
      asked.push(`${url.searchParams.get("from")}..${url.searchParams.get("to")}`);
    }
  });
  return asked;
}

export const selected = (page: Page) => page.locator('li[aria-selected="true"]');

// A Sunday clear of a clock change, so the 7 days end on it and its week starts on Monday the 9th.
export const SUNDAY = new Date(2026, 10, 15, 12);
/** A config with a weight kind, read at its last weigh-in. */
export const WEIGHED =
  "- 💧 water: 250 ml, min 2000\n- 🍽 food: kcal max 2000, protein min 100\n- ⚖ weight: kg, last\n";

/** Writes each day's log lines (a November day or a date) and the config, pins the clock, and opens the log pane's Trends at `span`. */
export async function trends(
  page: Page,
  vault: string,
  days: Record<string, string[]>,
  { config = WEIGHED, span = "7d", narrow = false } = {},
): Promise<Locator> {
  const notes = Object.entries(days).map(([day, lines]) => [
    `01 Periodic/00 Daily/${day.includes("-") ? day : `2026-11-${day.padStart(2, "0")}`}.md`,
    `# Day\n\n## Log\n${lines.join("\n")}\n`,
  ]);
  await vaultWith(vault, { "99 Misc/01 Config/log.md": config, ...Object.fromEntries(notes) });
  await page.clock.setFixedTime(SUNDAY);
  const pane = page.getByRole("region", { name: "Trends" });
  if (narrow) {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
    await page.getByRole("option", { name: /^Open the log/ }).tap();
    await page.getByRole("tab", { name: "Trends" }).tap();
    await pane.getByRole("button", { name: span }).tap();
  } else {
    await openApp(page);
    await leader(page, "gf");
    await pane.getByRole("button", { name: span }).click();
  }
  return pane;
}

/** The figure and words of the summary tile with this label. */
export const tile = (pane: Locator, label: string) =>
  pane
    .locator(".log-summary-tile")
    .filter({ has: pane.page().getByText(label, { exact: true }) })
    .locator("dd");

export const chart = (pane: Locator, name: string) =>
  pane.getByRole("img", { name: new RegExp(`^${name} over`) });

/** The By week table's cells, header row first. */
export const weeks = (pane: Locator) =>
  pane
    .getByRole("table", { name: "By week" })
    .evaluate((table) =>
      [...table.querySelectorAll("tr")].map((row) =>
        [...row.querySelectorAll("th, td")].map((cell) => cell.textContent ?? ""),
      ),
    );

export const fed = (...ago: number[]) => ago.map((n) => ({ ago: n, stub: false }));
