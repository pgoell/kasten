import type { Locator, Page } from "@playwright/test";
import { leader, openApp } from "../../../../harness/app.ts";
import { expect } from "../../../../harness/stack.ts";

export const daily = (date: string) => `01 Periodic/00 Daily/${date}.md`;
export const logged = (...lines: string[]) => `# Day\n\n## Log\n${lines.join("\n")}\n`;
export const CONFIG_PATH = "99 Misc/01 Config/log.md";
/** A food goal of at most 2,200 kcal and a water floor of 2,000 ml. */
export const GOALS = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml, min 2000\n";
/** The day the pinned journeys run on: 293 days into 2026, its 90 log days start on July 23. */
export const NOW = new Date(2026, 9, 20, 9);

export const card = (page: Page, name: string) =>
  page.getByRole("region", { name: "Overview" }).locator("article", {
    has: page.getByRole("heading", { name: new RegExp(`^${name}, open `) }),
  });
export const figure = (page: Page, name: string) => card(page, name).locator(".overview-figure");
export const words = (page: Page, name: string) => card(page, name).locator(".overview-words");
export const captions = (page: Page) =>
  page.getByRole("region", { name: "Overview" }).locator(".overview-caption");

/** Opens the overview from the editor and waits for its Food card. */
export async function overview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "ga");
  await expect(card(page, "Food")).toBeVisible({ timeout: 15_000 });
}

/** Answers each GET of `path` with `body` as JSON, in place of the backend. */
export const serve = (page: Page, path: string, body: unknown, status = 200) =>
  page.route(
    (url) => url.pathname === path,
    (route) => route.fulfill({ status, json: body }),
  );

/** How many of a chart's bars draw in the theme's warning colour, which marks a goal passed. */
export const warned = (chart: Locator) =>
  chart.evaluate((svg) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--k-warn)";
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    return [...svg.querySelectorAll("rect")].filter((bar) => getComputedStyle(bar).fill === warn)
      .length;
  });
