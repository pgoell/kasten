import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Loads the app and waits until the tree lists the vault and the editor holds the focus. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // A line, not the content's middle: in a short note that sits under the note's header.
  await page.locator(".cm-content").first().locator(".cm-line:visible").last().click();
  await page.keyboard.press("Escape");
}

/** Presses Space and then each key, as vim's normal mode reads a leader sequence. */
export async function leader(page: Page, keys: string): Promise<void> {
  await page.keyboard.press("Space");
  for (const key of keys) await page.keyboard.press(key);
}

/**
 * Opens the note finder, types the name, and opens the first row once the finder has listed it.
 * Returns once the note's tab is selected and an editor holds the focus: keys sent sooner are lost on a loaded box (#1615).
 */
export async function findNote(page: Page, name: string): Promise<void> {
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder).toBeVisible();
  await finder.getByRole("combobox").fill(name);
  await expect(finder.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible({ timeout: 15_000 });
  // `:focus` rather than toBeFocused, which fails outright when two panes each hold an editor.
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** Opens a note from the file tree at the vault's top level. */
export async function openFromTree(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
}

/** A phone as `test.use` takes it: 414 px wide, a finger for a pointer, so vim starts off. */
export const phone = { viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true };

/**
 * A box's height to the 1/64 px the browser lays out in. A translated box's corners come back as float32,
 * so a 44 px box low on the page can read 43.99994 (#1852); a box a layout unit short still reads short.
 */
export async function tapHeight(target: Locator): Promise<number | undefined> {
  const height = (await target.boundingBox())?.height;
  return height === undefined ? undefined : Math.round(height * 64) / 64;
}

/** A local date as `YYYY-MM-DD`, the way the browser names a daily note. */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Today's date on this box, as the browser names the daily note it sends. */
export const today = (): string => localDate(new Date());

/** A note in the test's vault, or "" while it is not there, so a poll waits for the write. */
export async function noteText(vault: string, path: string): Promise<string> {
  try {
    return await readFile(join(vault, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export const PANE = "[data-pane]";
/** The panes on screen; a pane on its way out is hidden. */
export const panes = (page: Page): Locator => page.locator(`${PANE}:visible`);

/** Opens a note from the tree and waits for its editor's focus: keys sent sooner are lost (#1738). */
export async function openNote(page: Page, name: string): Promise<void> {
  await openFromTree(page, name);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** A note's text without the id and stamps the vault writes into its frontmatter. */
export const unstamped = (text: string): string =>
  text.replace(/^(id|created|modified): .*\n/gm, "");

/** Writes each file into the vault, making the folders above it. */
export async function vaultWith(
  vault: string,
  notes: Record<string, string | Buffer>,
): Promise<void> {
  for (const [path, body] of Object.entries(notes)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), body);
  }
}

/** Keeps each address the page asks window.open for, as a new tab would leave the box. Call before the page loads. */
export async function recordOpens(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened, open: (url: string) => opened.push(url) && null });
  });
}

/** The addresses the page asked window.open for since `recordOpens`. */
export const opened = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);

/** The notes made in the inbox, sorted; the `index.md` kasten gives each folder it makes is left out. */
export const inbox = async (vault: string): Promise<string[]> =>
  (await readdir(join(vault, "00 Inbox")).catch(() => []))
    .filter((name) => name !== "index.md")
    .sort();

/** A todo row, keyed by its line as "Home.md:12"; the file tree's rows are not. */
export const TODO_ROW = '[data-row*=".md:"]';

/**
 * Each todo row's text and the cursor's row, read in one evaluate: `evaluateAll` finds the rows
 * and reads them in two round trips, and a redraw between them reads rows already gone (#1921).
 */
export function todoRows(page: Page): Promise<{ texts: string[]; cursor: number }> {
  return page.evaluate((selector) => {
    const rows = [...document.querySelectorAll<HTMLElement>(selector)];
    return {
      texts: rows.map((row) => row.textContent ?? ""),
      cursor: rows.findIndex((row) => row.tabIndex === 0),
    };
  }, TODO_ROW);
}

/**
 * Runs `read` over the elements `selector` matches, those `getByRole` and `:visible` would see, in
 * one evaluate: `evaluateAll` finds them and runs its function in two round trips, and a React
 * commit between the two mixes two renders (#1937). `read` runs in the page, so it closes over nothing.
 */
export function readAll<R, A = null>(
  page: Page,
  selector: string,
  read: (all: HTMLElement[], arg: A) => R,
  arg: A | null = null,
): Promise<R> {
  const shown = `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(
    (el) => el.checkVisibility({ visibilityProperty: true }) && !el.closest('[aria-hidden="true"]'))`;
  return page.evaluate(`(${read})(${shown}, ${JSON.stringify(arg)})`) as Promise<R>;
}

/** Presses j or k until the todo list's cursor sits on the `nth` row whose text holds `words`. */
export async function cursorTo(page: Page, words: string, nth = 0): Promise<void> {
  const { texts, cursor: from } = await todoRows(page);
  const to = texts.map((text, i) => (text.includes(words) ? i : -1)).filter((i) => i >= 0)[nth];
  const key = (to ?? 0) > from ? "j" : "k";
  for (let i = 0; i < Math.abs((to ?? 0) - from); i++) await page.keyboard.press(key);
  await expect(page.locator(`${TODO_ROW}[tabindex="0"]`)).toContainText(words);
}

/** The page's stylesheets as served: Chromium's CSSOM drops a declaration it does not read, such as a -webkit- one. */
export async function builtCss(page: Page): Promise<string> {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
      (link) => link.href,
    ),
  );
  const texts = await Promise.all(hrefs.map(async (href) => (await page.request.get(href)).text()));
  return texts.join("\n");
}

// A copy of frontend/src/lib/core/read-retry.ts's BACKOFF, whose `@/` import Playwright cannot resolve: 8 tries.
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

/** Answers every GET `route` matches with a 502 while `down` says so; returns the count of failed ones. */
export async function gateway(
  page: Page,
  route: (url: URL) => boolean,
  down: () => boolean,
): Promise<() => number> {
  let failed = 0;
  await page.route(route, async (request) => {
    if (request.request().method() !== "GET" || !down()) return request.fallback();
    failed += 1;
    await request.fulfill({ status: 502, body: "{}", contentType: "application/json" });
  });
  return () => failed;
}

/**
 * Runs the paused clock through each retry's wait, one counted try at a time, until all 8 tries
 * after `from` have failed; `line`, the screen's word for the failure, must not show while a try is left.
 */
export async function walkBackoff(
  page: Page,
  failed: () => number,
  line: Locator,
  from = 0,
): Promise<void> {
  const tried = () => failed() - from;
  await expect.poll(tried).toBeGreaterThan(0);
  if (from === 0) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  for (let tries = tried(); tries <= BACKOFF.length; tries = tried()) {
    await expect(line).toHaveCount(0);
    const wait = BACKOFF[tries - 1] ?? 0;
    // A try counts in Node before its 502 reaches the page, so the page may set its wait after the clock ran (#2013).
    await expect
      .poll(async () => {
        if (tried() === tries) await page.clock.runFor(wait);
        return tried();
      })
      .toBeGreaterThan(tries);
  }
  expect(tried()).toBe(BACKOFF.length + 1);
  // TanStack Query hands its updates to the screen through a setTimeout(0), set only once the last 502 lands.
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return line.count();
    })
    .toBeGreaterThan(0);
}
