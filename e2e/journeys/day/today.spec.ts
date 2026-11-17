import type { Page } from "@playwright/test";
import {
  bodyOf,
  findNote,
  gateway,
  leader,
  noteText,
  openApp,
  panes,
  phone,
  tapHeight,
  vaultWith,
  walkBackoff,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const UNREAD = "Cards could not be counted: the daily limits could not be read";

/** The home screen's columns an empty pane shows, in the order drawn: 0 Today, 1 Recent, 2 Due. */
const column = (page: Page, nth: number) =>
  page.locator("[data-today] [data-today-column]").nth(nth);
const due = (page: Page) => column(page, 2);
const unreadRow = (page: Page) => due(page).getByText(UNREAD);
const tryAgain = (page: Page) => due(page).getByRole("button", { name: "Try again" });

/** Fails every read of the daily limits with a 502 while `down` says so. */
const limitsDown = (page: Page, down: () => boolean) =>
  gateway(page, (url) => url.pathname === "/api/review/limits", down);

/** Opens the app on an installed clock: its empty pane shows the home screen. */
async function openToday(page: Page): Promise<void> {
  await page.clock.install();
  await openApp(page);
  await expect(page.locator("[data-today]")).toBeVisible();
}

test("the Due column says the cards could not be counted once the limits read fails at last, and gives no count", async ({
  page,
}) => {
  const failed = await limitsDown(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));

  await expect(unreadRow(page)).toBeVisible();
  // The e2e vault holds cards, so the count is what a lie would show here; Nothing due. would be one too.
  await expect(due(page)).not.toContainText("cards waiting");
  await expect(due(page)).not.toContainText("Nothing due.");
});

test("Try again on the unread row reads the limits again, and once they answer the row goes and the cards are counted", async ({
  page,
}) => {
  let down = true;
  const failed = await limitsDown(page, () => down);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));
  await expect(tryAgain(page)).toHaveAttribute("data-reread");
  expect(await tapHeight(tryAgain(page))).toBeGreaterThanOrEqual(44);

  down = false;
  await page.clock.resume();
  await tryAgain(page).click();

  await expect(due(page)).toContainText(/\d+ cards? waiting/);
  await expect(unreadRow(page)).toHaveCount(0);
  await expect(tryAgain(page)).toHaveCount(0);
});

test("Try again while the limits read still fails takes the row away while it retries, then brings it and Try again back", async ({
  page,
}) => {
  const failed = await limitsDown(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));
  const before = failed();

  await tryAgain(page).click();
  await expect.poll(failed).toBeGreaterThan(before);
  await page.clock.runFor(100);
  await expect(unreadRow(page)).toHaveCount(0);

  await walkBackoff(page, failed, unreadRow(page), { from: before });
  await expect(unreadRow(page)).toBeVisible();
  await expect(tryAgain(page)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#1139 I4 the Due column's count moves after its deck note's refetch gets a 502 and the next try answers", async ({
    page,
    stack,
  }) => {
    const alpha = "03 Flashcards/alpha.md";
    await vaultWith(stack.vault, { [alpha]: "#flashcards/alpha\n\na::b\n" });
    await page.clock.install();
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await expect(due(page)).toContainText("3 cards waiting");
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Open the review pane/ }).tap();
    await page.locator('button[data-deck="alpha"]').tap();
    await page.getByRole("button", { name: "Show the answer" }).tap();
    const landed = page.waitForResponse((answer) => answer.request().method() === "PUT");
    await page.getByRole("button", { name: "Good" }).tap();
    await landed;
    let down = true;
    const failed = await gateway(
      page,
      (url) => decodeURIComponent(url.pathname) === `/api/files/${alpha}`,
      () => down,
    );
    await page.getByRole("button", { name: "Close Review" }).tap();
    await expect.poll(failed).toBe(1);
    down = false;
    await expect(due(page)).toContainText("2 cards waiting");
    expect(failed()).toBe(1);
  });
});

/** A Thursday, so the dates below read as today, earlier this month and overdue. */
const THURSDAY = new Date(2026, 9, 22, 9);
const DOING_TODAY = "- [/] Draft the report 📅 2026-10-22";
const stamped = (day: string) => `---\nmodified: 2026-10-${day}T09:00:00+00:00\n---\n\nwords\n`;

/** Notes go in before the load, so the first search sees them. */
async function openThursday(page: Page, vault: string, notes: Record<string, string> = {}) {
  await vaultWith(vault, notes);
  await page.clock.setFixedTime(THURSDAY);
  await page.goto("/");
  await expect(page.locator("[data-today]")).toBeVisible({ timeout: 15_000 });
}

test.describe("the home screen's columns", () => {
  test("Today heads the empty pane with the date", async ({ page, stack }) => {
    await openThursday(page, stack.vault);
    await expect(page.locator("[data-today] h1")).toHaveText("Thursday, 22 October 2026");
  });

  test("Today lists today's todos with their state", async ({ page, stack }) => {
    await openThursday(page, stack.vault, { "report.md": `${DOING_TODAY}\n` });
    const row = column(page, 0).getByRole("button", { name: /Draft the report/ });
    await expect(row.getByRole("img", { name: "doing" })).toBeVisible();
  });

  test("Recent lists the notes edited most recently, newest first, with their day", async ({
    page,
    stack,
  }) => {
    await openThursday(page, stack.vault, { "a.md": stamped("20"), "b.md": stamped("21") });
    await expect(column(page, 1).getByRole("button")).toHaveText(["b21 Oct", "a20 Oct"]);
  });

  test("Due lists overdue todos and open loops, and leaves out a todo of today", async ({
    page,
    stack,
  }) => {
    const todos = `- [ ] Pay the bill 📅 2026-10-01\n- [w] Wait for Anna\n${DOING_TODAY}\n`;
    await openThursday(page, stack.vault, { "loops.md": todos });
    const overdue = column(page, 2).getByRole("button", { name: /Pay the bill/ });
    await expect(overdue).toBeVisible();
    await expect(column(page, 2).getByRole("button", { name: /Wait for Anna/ })).toBeVisible();
    await expect(column(page, 2)).toContainText("Overdue");
    await expect(column(page, 2)).toContainText("Open loops");
    await expect(column(page, 2)).not.toContainText("Draft the report");
  });

  test("each column says so plainly when it has nothing", async ({ page, stack }) => {
    // The fixture's undated todos are neither today nor overdue; with its cards gone nothing is due.
    await openThursday(page, stack.vault, {
      "03 Flashcards/Capitals.md": "#flashcards/capitals\n",
    });
    await expect(column(page, 0)).toContainText("Nothing for today.");
    await expect(column(page, 1)).toContainText("Nothing written lately.");
    await expect(column(page, 2)).toContainText("Nothing due.");
  });

  test("a failed todos read leaves Today its plain line and the other columns drawn", async ({
    page,
    stack,
  }) => {
    const failed = await gateway(
      page,
      (url) => url.pathname === "/api/todos",
      () => true,
    );
    await openThursday(page, stack.vault, { "report.md": `${DOING_TODAY}\n` });
    await expect.poll(failed).toBeGreaterThan(0);
    await expect(column(page, 0)).toContainText("Nothing for today.");
    await expect(column(page, 0)).not.toContainText("Draft the report");
    await expect(column(page, 2)).toContainText(/\d+ cards? waiting/);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("the three columns stack, Today over Recent over Due", async ({ page, stack }) => {
      await openThursday(page, stack.vault, {
        "report.md": `${DOING_TODAY}\n`,
        "b.md": stamped("21"),
      });
      await expect(column(page, 0)).toContainText("Draft the report");
      await expect(column(page, 1)).toContainText("b21 Oct");
      const tops = await Promise.all(
        [0, 1, 2].map(async (n) => (await column(page, n).boundingBox())?.y ?? 0),
      );
      expect(tops[0]).toBeLessThan(tops[1] ?? 0);
      expect(tops[1]).toBeLessThan(tops[2] ?? 0);
    });
  });
});

/** A Thursday at noon: each grain's note below is the one it falls in. */
const AUGUST_6 = new Date(2026, 7, 6, 12);
const DAILY = "01 Periodic/00 Daily/2026-08-06.md";
const WEEK = "01 Periodic/01 Weekly/2026-W32.md";
const YEAR = "01 Periodic/04 Yearly/2026.md";
const LINKS =
  "[[01 Periodic/00 Daily/2026-08-05]] | [[01 Periodic/01 Weekly/2026-W32]] | [[01 Periodic/00 Daily/2026-08-07]]";
/** The lines of the block a file opens with, or null when its first line is no fence. */
const block = (text: string) => text.match(/^---\n([\s\S]*?)\n---\n/)?.[1]?.split("\n") ?? null;

/** Each method sent for `path` from now on. */
function sentFor(page: Page, path: string): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    const at = decodeURIComponent(new URL(request.url()).pathname);
    if (at === `/api/files/${path}`) sent.push(request.method());
  });
  return sent;
}

/** Steps past every save timer, then waits for the finder, which opens after any write they sent. */
async function settled(page: Page): Promise<void> {
  await page.clock.runFor(10_000);
  await leader(page, "ff");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("the periodic notes", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: AUGUST_6 });
  });

  test("gd makes today's note with its block, links and TODOs in one write, and opens it", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    const sent = sentFor(page, DAILY);
    await leader(page, "gd");
    await expect(panes(page).filter({ hasText: "2026-08-06 Thursday" })).toHaveCount(1);
    await settled(page);
    expect(sent.filter((method) => method !== "GET")).toEqual(["POST"]);
    const text = await noteText(stack.vault, DAILY);
    expect(block(text)).toContain("type: Periodic Note");
    expect(bodyOf(text)).toBe(`\n# 2026-08-06 Thursday\n\n${LINKS}\n\n## TODOs\n`);
  });

  test("gd, gw, gm, gq and gy each open a note whose file starts with a block saying it is periodic", async ({
    page,
    stack,
  }) => {
    await openApp(page);
    for (const [keys, path] of [
      ["gd", DAILY],
      ["gw", "01 Periodic/01 Weekly/2026-W32.md"],
      ["gm", "01 Periodic/02 Monthly/2026-08.md"],
      ["gq", "01 Periodic/03 Quarterly/2026-Q3.md"],
      ["gy", "01 Periodic/04 Yearly/2026.md"],
    ]) {
      await leader(page, keys);
      const name = path.split("/").pop()?.replace(/\.md$/, "");
      await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
      await expect(page.locator(".cm-content:focus")).toHaveCount(1);
      expect(block(await noteText(stack.vault, path))).toContain("type: Periodic Note");
    }
  });

  test("gd opens the daily note the vault already holds and writes nothing to it", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [DAILY]: "# 2026-08-06 Thursday\n" });
    await openApp(page);
    const sent = sentFor(page, DAILY);
    await leader(page, "gd");
    await expect(panes(page).filter({ hasText: "2026-08-06 Thursday" })).toHaveCount(1);
    await settled(page);
    expect(sent.filter((method) => method !== "GET")).toEqual([]);
    expect(await noteText(stack.vault, DAILY)).toBe("# 2026-08-06 Thursday\n");
  });

  test.describe("the review in the weekly and the yearly note", () => {
    const own = (title: string) => `# ${title}\n\nmy own line\n`;
    const review = (page: Page) => page.locator(".cm-review");
    const READS = /^\/api\/(log|todos|cards|written|written\/notes|github)$/;

    /** Opens `path` by its address, as a link does, once the reads the review sends have answered. */
    async function openPeriodic(page: Page, vault: string, path: string): Promise<string[]> {
      await vaultWith(vault, {
        [WEEK]: own("2026-W32"),
        [YEAR]: own("2026"),
        "01 Periodic/01 Weekly/index.md": own("Weekly"),
        "02 Projects/x.md": own("x"),
        [DAILY]: own("2026-08-06 Thursday"),
      });
      const reads: string[] = [];
      page.on("requestfinished", (request) => {
        const at = new URL(request.url()).pathname;
        if (request.method() === "GET" && READS.test(at)) reads.push(at);
      });
      await page.goto(`/?note=${encodeURIComponent(path)}`);
      await expect(page.locator(".cm-content")).toContainText("my own line", { timeout: 15_000 });
      if (path === WEEK || path === YEAR) {
        await expect(review(page)).toContainText("in review");
        await expect(review(page)).not.toContainText("Reading…");
      }
      await page.locator(".cm-content").click();
      return reads;
    }

    /** Puts the cursor at the note's end and types `words` and a new line, in vim's insert mode when vim is on. */
    async function typeAtEnd(page: Page, words: string): Promise<void> {
      await page.keyboard.press("Control+End");
      if (await page.locator(".cm-vimMode").count()) {
        for (const key of ["Escape", "G", "i"]) await page.keyboard.press(key);
      }
      await page.keyboard.type(`${words}\n`);
    }

    /** Steps past the save timers and waits for `path` to hold `body` below its frontmatter. */
    async function saved(page: Page, vault: string, path: string, body: string): Promise<void> {
      await page.clock.runFor(10_000);
      await expect.poll(async () => bodyOf(await noteText(vault, path))).toBe(body);
    }

    const toggle = async (page: Page) => {
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: /^Toggle live preview/ }).click();
    };

    test("the week review shows in Read and in Edit, and opening, reading and leaving the note writes nothing", async ({
      page,
      stack,
    }) => {
      const sent = sentFor(page, WEEK);
      await openPeriodic(page, stack.vault, WEEK);
      await leader(page, "p");
      await expect(review(page)).toContainText("Week in review");
      await leader(page, "ff");
      await page.getByRole("dialog", { name: "Find note" }).getByRole("combobox").fill("Welcome");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
      await settled(page);
      expect(sent.filter((method) => method !== "GET")).toEqual([]);
      expect(await noteText(stack.vault, WEEK)).toBe(own("2026-W32"));
    });

    test("only the weekly note draws a review, not the weekly index, a daily note or a project note", async ({
      page,
      stack,
    }) => {
      await openPeriodic(page, stack.vault, WEEK);
      for (const path of ["01 Periodic/01 Weekly/index.md", DAILY, "02 Projects/x.md"]) {
        await openPeriodic(page, stack.vault, path);
        await expect(review(page), path).toHaveCount(0);
      }
    });

    test("typing below the review, up to its save, asks none of its reads again", async ({
      page,
      stack,
    }) => {
      await openPeriodic(page, stack.vault, WEEK);
      // Past the cache's 10 s staleTime, so a block drawn afresh would read again.
      await page.clock.runFor(11_000);
      // Up to the save only: the save's own echo asks the todos again, as every write does.
      const asked: string[] = [];
      page.on("request", (request) => {
        const at = new URL(request.url()).pathname;
        if (request.method() === "GET" && READS.test(at)) asked.push(at);
      });
      const save = page.waitForRequest((request) => request.method() === "PUT");
      await typeAtEnd(page, "one more line");
      await page.clock.runFor(10_000);
      await save;
      expect(asked).toEqual([]);
      await saved(page, stack.vault, WEEK, `${own("2026-W32")}one more line\n`);
    });

    test("an autosave of another note in the other pane asks the written notes again", async ({
      page,
      stack,
    }) => {
      const reads = await openPeriodic(page, stack.vault, YEAR);
      const before = reads.filter((at) => at === "/api/written/notes").length;
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(2);
      await findNote(page, "Welcome");
      await typeAtEnd(page, "a line");
      await page.clock.runFor(10_000);
      await expect
        .poll(() => reads.filter((at) => at === "/api/written/notes").length)
        .toBeGreaterThan(before);
    });

    test("with vim on, G, gg and j move over the note's own lines and the block takes none", async ({
      page,
      stack,
    }) => {
      await openPeriodic(page, stack.vault, WEEK);
      for (const keys of ["Gaend", "ggA top", "jjA mid"]) {
        await page.keyboard.press("Escape");
        await page.keyboard.type(keys);
      }
      await saved(page, stack.vault, WEEK, "# 2026-W32 top\n\nmy own line mid\nend");
    });

    test("Ctrl+A and Backspace empty the note and never write the block into it", async ({
      page,
      stack,
    }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
      await openPeriodic(page, stack.vault, WEEK);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await saved(page, stack.vault, WEEK, "");
      await expect(review(page)).toContainText("Week in review");
    });

    for (const vim of ["off", "on"]) {
      test(`with vim ${vim}, typing below the review edits the note in Read and in Edit`, async ({
        page,
        stack,
      }) => {
        await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
        await openPeriodic(page, stack.vault, YEAR);
        await typeAtEnd(page, `read ${vim}`);
        await toggle(page);
        await expect(review(page)).toContainText("Year in review");
        await typeAtEnd(page, `edit ${vim}`);
        await saved(page, stack.vault, YEAR, `${own("2026")}read ${vim}\nedit ${vim}\n`);
      });
    }
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("the palette's rows make today's note in one write, delete it and bring it back", async ({
      page,
      stack,
    }) => {
      const sent = sentFor(page, DAILY);
      await page.goto("/");
      const commands = page.getByRole("toolbar", { name: "Commands" });
      const run = async (row: RegExp) => {
        await commands.getByRole("button", { name: "Run a command by name" }).tap();
        await page.getByRole("option", { name: row }).tap();
      };
      await expect(commands).toBeVisible({ timeout: 15_000 });
      await run(/^Open today's note/);
      await expect(panes(page).filter({ hasText: "2026-08-06 Thursday" })).toHaveCount(1);
      expect(bodyOf(await noteText(stack.vault, DAILY))).toContain(LINKS);
      expect(sent.filter((method) => method !== "GET")).toEqual(["POST"]);
      await run(/^Delete the note/);
      await expect(panes(page).filter({ hasText: "2026-08-06 Thursday" })).toHaveCount(0);
      await expect.poll(() => noteText(stack.vault, DAILY)).toBe("");
      await run(/^Undo the last delete/);
      await expect(panes(page).filter({ hasText: "2026-08-06 Thursday" })).toHaveCount(1);
      expect(bodyOf(await noteText(stack.vault, DAILY))).toContain(LINKS);
    });
  });
});
