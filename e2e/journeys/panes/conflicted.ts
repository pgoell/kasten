import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { openApp, openFromTree } from "../../harness/app.ts";
import { expect } from "../../harness/stack.ts";

export const OUTSIDE = "Somebody else wrote this.\n";
export const panes = (page: Page): Locator => page.locator("[data-pane]:visible");
export const sign = (page: Page) => page.getByTestId("save-status");
export const typed = (page: Page) => page.locator(".cm-content", { hasText: "typed here" });
export const welcome = (vault: string) => readFile(join(vault, "Welcome.md"), "utf8");
export const focused = (page: Page) => page.locator(".cm-content:focus");

/** Opens a note from the tree and waits for its editor's focus: keys sent sooner are lost (#1738). */
export async function openNote(page: Page, name: string) {
  await openFromTree(page, name);
  await expect(focused(page)).toHaveCount(1);
}

/** The save sign, the conflict diff and the bar's conflict list, each null when not drawn. */
export async function conflictBar(page: Page) {
  const read = async (locator: Locator) =>
    (await locator.count()) > 0 ? await locator.first().textContent() : null;
  return {
    status: (await sign(page).count()) > 0 ? await sign(page).getAttribute("aria-label") : null,
    diff: await read(page.getByTestId("conflict-diff")),
    listed: await read(page.getByTestId("held-conflict")),
  };
}

interface Conflict {
  /** The text the refused write carried, the buffer's whole text. */
  mine: string;
  /** PUTs of Welcome so far, the held one included. */
  puts: () => number;
}

/**
 * Welcome typed into, its write held while somebody else writes the file, then let through
 * so the vault refuses it over its base. `first` runs on the open note before the typing.
 * With vim off (`kasten.vim` set before) the typing goes at the end without `Go`.
 */
export async function conflicted(
  page: Page,
  vault: string,
  first?: () => Promise<void>,
  vim = true,
): Promise<Conflict> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  let mine = "";
  await page.route(
    (url) => decodeURIComponent(url.pathname) === "/api/files/Welcome.md",
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      puts += 1;
      if (puts === 1) mine = route.request().postDataJSON().content;
      await held;
      await route.fallback();
    },
  );
  await openApp(page);
  await openNote(page, "Welcome");
  await first?.();
  if (vim) {
    await page.keyboard.type("Gotyped here");
    await page.keyboard.press("Escape");
  } else {
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\ntyped here");
  }
  await expect.poll(() => puts).toBeGreaterThan(0);
  await writeFile(join(vault, "Welcome.md"), OUTSIDE);
  release();
  await expect
    .poll(async () => [await sign(page).getAttribute("aria-label"), await welcome(vault)], {
      timeout: 15_000,
    })
    .toEqual(["Changed on disk", OUTSIDE]);
  await expect(typed(page)).toHaveCount(1);
  return { mine, puts: () => puts };
}

/** Whether the page's held store still keeps text for Welcome. */
export const stillHeld = (page: Page) =>
  page.evaluate(() => (localStorage.getItem("kasten.held.2") ?? "").includes("Welcome.md"));

/**
 * The bar, the file, the PUT count, whether the buffer holds the typing, and the held store. The
 * file is read without the id and stamps the vault writes into a note's frontmatter.
 */
export async function after(page: Page, vault: string, puts: () => number) {
  return [
    await conflictBar(page),
    (await welcome(vault)).replace(/^(id|created|modified): .*\n/gm, ""),
    puts(),
    await typed(page).count(),
    await stillHeld(page),
  ];
}

/** The bar's diff as reopened: the vault's text struck, the kept text added. */
export const bothTexts = (vault: string) =>
  expect.stringMatching(new RegExp(`^- ${vault}.*\\+ typed here$`));

export const settled = { status: "Saved", diff: null, listed: null };
