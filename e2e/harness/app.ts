import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { importTodos, stacks } from "./stack.ts";

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

/** The old todo list: under Board it is a region called Todos inside the todo view's own. */
export const todoList = (page: Page) => page.getByRole("region", { name: "Todos" }).last();

/**
 * The todo view's Board tab and `c`: the list the todo journeys were written against, which the
 * Board tab keeps beside the board. Nothing where the Board tab is already open.
 */
export async function toTodoList(page: Page): Promise<void> {
  const tab = page.getByRole("button", { name: "Board", exact: true });
  if ((await tab.getAttribute("aria-pressed")) === "true") return;
  await tab.click();
  await expect(todoList(page)).toBeFocused();
  await page.keyboard.press("c");
}

/** The phone's todo button, then the list under the todo view's Board tab. */
export async function tapTodoList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await toTodoList(page);
}

/** `<leader>gt`, then the list under the todo view's Board tab. */
export async function openTodoList(page: Page): Promise<void> {
  await leader(page, "gt");
  await toTodoList(page);
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
/** Whether the page is a phone's narrow screen, as `phone` makes it. */
export const onPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

/**
 * Runs the palette row `option`: on a phone by a tap on the Commands toolbar's run button, else
 * by Ctrl+Shift+P and a click. `search`, when given, is typed into the palette first.
 */
export async function runCommand(page: Page, option: RegExp, search?: string): Promise<void> {
  const touch = onPhone(page);
  if (touch) {
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
  } else await page.keyboard.press("Control+Shift+P");
  if (search !== undefined) await page.getByRole("combobox").fill(search);
  const row = page.getByRole("option", { name: option });
  await (touch ? row.tap() : row.click());
}

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

/** `days` after today, as the vault writes a date. */
export const plus = (days: number): string => localDate(new Date(Date.now() + days * 86_400_000));

/** A note in the test's vault, or "" while it is not there, so a poll waits for the write. */
export async function noteText(vault: string, path: string): Promise<string> {
  try {
    return await readFile(join(vault, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** A note's text below its frontmatter, which the vault stamps on a note's first save. */
export const bodyOf = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n/, "");

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

/**
 * Writes each file into the vault, making the folders above it. Through a hidden file and a rename, as kasten saves:
 * a note written in place is empty for a moment, and a read then drops its todos (#2143).
 */
export async function vaultWith(
  vault: string,
  notes: Record<string, string | Buffer>,
): Promise<void> {
  for (const [path, body] of Object.entries(notes)) {
    const file = join(vault, path);
    const hidden = join(dirname(file), `.${basename(file)}.tmp`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(hidden, body);
    await rename(hidden, file);
  }
  // Todo lines written into a running stack's vault become todos, as the import made them.
  const url = stacks.get(vault);
  if (url !== undefined) await importTodos(url);
}

/** Keeps each address the page asks window.open for, as a new tab would leave the box. Call before the page loads. */
export async function recordOpens(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened, open: (url: string) => opened.push(url) && null });
  });
}

/** Holds a listing until the test lets it go: `abort` stands in for a listing that fails. */
export async function hold(
  page: Page,
  listing: RegExp,
): Promise<(abort?: boolean) => Promise<void>> {
  let release: (abort: boolean) => void = () => {};
  const gate = new Promise<boolean>((done) => {
    release = done;
  });
  let answered = Promise.resolve();
  await page.route(listing, (route) => {
    answered = gate.then((abort) => (abort ? route.abort() : route.continue()));
    return answered;
  });
  // Resolves once the held request is answered, so an unroute after it cannot let it through.
  return async (abort = false) => {
    release(abort);
    await answered;
  };
}

/** Holds the vault's event stream until the returned call lets it open. */
export async function holdStream(page: Page): Promise<() => void> {
  let open = () => {};
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route("**/api/events", async (route) => {
    await held;
    await route.continue();
  });
  return open;
}

/** Keeps the data of each vault event the page reads; the returned call reads them joined. Call before the page loads. */
export async function recordEvents(page: Page): Promise<() => Promise<string>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    window.EventSource = class extends EventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("message", (event) => seen.push(event.data));
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { seen: string[] }).seen.join());
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

// nginx serves the lists app on the share host's name alone (#736), the name frontend/nginx.conf writes out.
const SHARE_HOST = "liste.pgoell.com";
const LIST = "05 Shared/Einkauf.md";

/** Opens the lists app as the share host serves it, over the shopping list `list` the vault holds. */
export async function openLists(page: Page, vault: string, list = "- [ ] Milch\n"): Promise<void> {
  await vaultWith(vault, { [LIST]: list });
  // Chromium sends its own Host; the request made here names the share host instead.
  await page.route("**/lists.html", async (route) =>
    route.fulfill({
      response: await route.fetch({ headers: { ...route.request().headers(), host: SHARE_HOST } }),
    }),
  );
  await page.goto("/lists.html");
  // The list is read through the backend's `/share`; the empty line or a group shows once read.
  await expect(page.locator("main.lists > *").first()).toBeVisible({ timeout: 15_000 });
}

/** The shopping list's lines on disk below the frontmatter, blank ones left out. */
export const listLines = async (vault: string): Promise<string[]> =>
  bodyOf(await noteText(vault, LIST))
    .split("\n")
    .filter(Boolean);

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
 * Then runs the clock until `line` shows, unless `shows` is false.
 */
export async function walkBackoff(
  page: Page,
  failed: () => number,
  line: Locator,
  { from = 0, shows = true } = {},
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
  if (!shows) return page.clock.runFor(100);
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return line.count();
    })
    .toBeGreaterThan(0);
}

/**
 * Each drawn line and table cell but the blank ones, its runs wrapped by look: `<L:…>` the link
 * colour underlined, `<D:…>` muted and dotted (a dead link), `<U:…>` underlined in another ink,
 * `<R:…>` muted with no line (a relation's name, or a quote's plain brackets).
 */
export const drawn = (page: Page): Promise<string[]> =>
  page.locator(".cm-content:visible").evaluate((content) => {
    const tone = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      content.append(probe);
      const { color } = getComputedStyle(probe);
      probe.remove();
      return color;
    };
    const [link, muted] = [tone("--k-link"), tone("--k-muted")];
    // Underline does not inherit: the line sits on the link's span, not the text's own.
    const underline = (from: Element | null, box: Element) => {
      for (let at = from; at && at !== box; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.textDecorationLine.includes("underline")) return style;
      }
      return null;
    };
    const look = (text: Node, box: Element) => {
      const { color } = getComputedStyle(text.parentElement as Element);
      const line = underline(text.parentElement, box);
      if (!line) return color === muted ? "R" : "";
      if (color === link) return "L";
      return color === muted && line.textDecorationStyle === "dotted" ? "D" : "U";
    };
    const runs = (box: Element) => {
      const parts: { kind: string; text: string }[] = [];
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let text = walk.nextNode(); text; text = walk.nextNode()) {
        const kind = look(text, box);
        const last = parts.at(-1);
        if (last?.kind === kind) last.text += text.textContent;
        else parts.push({ kind, text: text.textContent ?? "" });
      }
      return parts.map(({ kind, text }) => (kind ? `<${kind}:${text}>` : text)).join("");
    };
    const boxes = [...content.querySelectorAll(".cm-line, .cm-table-grid tbody td")].map(runs);
    return boxes.filter((text) => text !== "");
  });

/**
 * Keeps what holds the focus at the first DOM change that takes `words` out of the board's Open
 * cards: a refocus a task later passes a read after the fact by luck (#1515).
 */
export const watchDrop = (page: Page, words: string): Promise<void> =>
  page.evaluate((words) => {
    const observer = new MutationObserver(() => {
      // A phone draws the shown state's cards alone, and no columns.
      const open = [...document.querySelectorAll('[data-column="open"]')];
      const cells = open.length > 0 ? open : [...document.querySelectorAll("[data-card]")];
      if (cells.some((cell) => cell.textContent?.includes(words))) return;
      const at = document.activeElement as HTMLElement | null;
      document.body.dataset.atDrop = at?.matches("[data-card]")
        ? (at.textContent ?? "")
        : at?.tagName;
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, words);

/** What held the focus when the card `watchDrop` watched left Open, or null before then. */
export const atDrop = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.body.dataset.atDrop ?? null);

/** Each bar a chart draws, as days before the range's last day, and whether it is the one-unit stub of a logged zero. */
export const barsOf = (chart: Locator, slots: number) =>
  chart.evaluate((svg: SVGSVGElement, n) => {
    const slot = svg.viewBox.baseVal.width / n;
    return [...svg.querySelectorAll("rect")]
      .map((bar) => bar.getBBox())
      .map((box) => ({ ago: n - 1 - Math.floor(box.x / slot), stub: box.height <= 1 }))
      .sort((a, b) => a.ago - b.ago);
  }, slots);

/** The caret's line in the editor on screen: a note a pane leaves keeps its editor, hidden, for a task (#2271). */
export const caretLine = (within: Page | Locator): Locator =>
  within.locator(".cm-activeLine:visible");

/** An edit field's text before its caret. */
export const beforeCaret = (input: Locator) =>
  input.evaluate((field: HTMLInputElement) => field.value.slice(0, field.selectionStart ?? 0));
