import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  findNote,
  inbox,
  leader,
  openApp,
  opened,
  openFromTree,
  openNote,
  phone,
  readAll,
  recordOpens,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test.describe("following a link to a page of html or an asset", () => {
  const PAGE = "01 Periodic/05 Newspaper/2026-10-07.html";
  const primer = (vault: string) => readFile(join(vault, "04 Books/Primer.pdf"));

  /** Writes each file into the vault, records each window.open, then loads the app. */
  async function loadWith(page: Page, vault: string, files: Record<string, string | Buffer>) {
    await vaultWith(vault, files);
    await recordOpens(page);
    await openApp(page);
  }

  const frame = (page: Page) => page.locator("[data-html-pane] iframe");
  /** The frame's page and the heading after its `#`; the address also carries the look (#786). */
  const shown = async (page: Page) => [
    await frame(page).getAttribute("title"),
    (await frame(page).getAttribute("src"))?.split("#")[1] ?? null,
  ];

  test("gf opens an html page in its pane by its bare name, behind an alias, at its heading and in capitals", async ({
    page,
    stack,
  }) => {
    const links =
      "[[2026-10-07.html]]\n[[2026-10-07.html|the paper]]\n[[2026-10-07.html#the paper]]\n[[2026-10-07.HTML]]\n";
    await loadWith(page, stack.vault, { [PAGE]: "<h1>the paper</h1>", "Links.md": links });
    for (const [line, heading] of [
      [1, null],
      [2, null],
      [3, "the%20paper"],
      [4, null],
    ] as const) {
      await openNote(page, "Links");
      await page.keyboard.type(`${line}Ggf`);
      await expect.poll(() => shown(page)).toEqual([PAGE, heading]);
    }
  });

  test("gf on a markdown link opens a page with ] in its name at its anchor, read from the note's folder", async ({
    page,
    stack,
  }) => {
    // The take writes this shape for a path a wikilink cannot hold.
    await loadWith(page, stack.vault, {
      "x/a]]b.html": "<h1 id=s1>one</h1>",
      "00 Daily/Daily take.md": "[Heading](../x/a%5D%5Db.html#s1)\n",
    });
    await findNote(page, "Daily take");
    await page.keyboard.type("gf");
    await expect.poll(() => shown(page)).toEqual(["x/a]]b.html", "s1"]);
  });

  test("a page or an asset nobody wrote makes no note and opens nothing, the asset drawn dead", async ({
    page,
    stack,
  }) => {
    await loadWith(page, stack.vault, {
      [PAGE]: "<h1>the paper</h1>",
      "Links.md": "# Links\n[[missing.html]]\n[[missing.pdf]]\n[[2026-10-07.html]]\n",
    });
    await openNote(page, "Links");
    await expect(page.locator(".cm-wikilink-dead")).toHaveCount(2);
    // The live link last, so its pane says the two keys before it were read.
    await page.keyboard.type("2Ggf3Ggf4Ggf");
    await expect.poll(() => shown(page)).toEqual([PAGE, null]);
    expect([await opened(page), await inbox(stack.vault)]).toEqual([[], []]);
  });

  test("a page whose name holds # opens from the tree by its whole name", async ({
    page,
    stack,
  }) => {
    await loadWith(page, stack.vault, { "plan #2.html": "<h1>two</h1>" });
    await page.getByRole("button", { name: "plan #2.html" }).click();
    await expect
      .poll(async () => (await frame(page).getAttribute("src"))?.split("?")[0])
      .toBe("/api/html/plan%20%232.html");
  });

  test("gf opens an asset the vault holds in a new tab in any case and with ? in its name, each drawn live", async ({
    page,
    stack,
  }) => {
    await loadWith(page, stack.vault, {
      "rehearse/my plan.pdf": await primer(stack.vault),
      "rehearse/my talk.mp3": "a talk",
      "plan?.mp3": "a plan",
      "docs/Talk.MP3": "a talk",
      "Links.md":
        "# Links\n[[my plan.pdf]]\n[[My Talk.MP3|the talk]]\n[[plan?.mp3]]\n[[Talk.MP3]]\n",
    });
    await openNote(page, "Links");
    await expect
      .poll(() =>
        readAll(page, ".cm-wikilink", (all) => [
          all.map((link) => link.textContent ?? ""),
          all.filter((link) => link.classList.contains("cm-wikilink-dead")).length,
        ]),
      )
      .toEqual([["my plan.pdf", "the talk", "plan?.mp3", "Talk.MP3"], 0]);
    await page.keyboard.type("3Ggf4Ggf5Ggf");
    await expect
      .poll(() => opened(page))
      .toEqual([
        "/api/assets/rehearse/my%20talk.mp3",
        "/api/assets/plan%3F.mp3",
        "/api/assets/docs/Talk.MP3",
      ]);
    expect(await inbox(stack.vault)).toEqual([]);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("Ctrl+click opens an asset whose name holds ? in a new tab", async ({ page, stack }) => {
      await loadWith(page, stack.vault, {
        "plan?.mp3": "a plan",
        "Links.md": "# Links\n[[plan?.mp3]]\n",
      });
      await openNote(page, "Links");
      await expect(page.locator(".cm-vimMode")).toHaveCount(0);
      await page.locator(".cm-wikilink").click({ modifiers: ["Control"] });
      await expect.poll(() => opened(page)).toEqual(["/api/assets/plan%3F.mp3"]);
    });
  });
});

test.describe("following a link's alias by a click or a tap", () => {
  const BORGES = "# Borges\n\n## Life\n\nborn 1899\n";
  /** The link under a line of its own, so the cursor leaves it drawn as its alias. */
  const LINKS = "intro\n\nsee [[borges#Life|Jorge]] now\n";
  const alias = (page: Page) => page.locator(".cm-wikilink", { hasText: "Jorge" });

  async function loadWith(page: Page, vault: string, notes: Record<string, string>) {
    await vaultWith(vault, { "reading/borges.md": BORGES, ...notes });
    await openApp(page);
  }

  /** A heading's line as the cursor leaves it: vim hides its marks, and the editor without vim shows them. */
  const heading = (name: string) => new RegExp(`^(## )?${name}$`);

  /** The open tab and the heading the cursor sits on, in one poll. */
  async function landed(page: Page, tab: string, at: string) {
    await expect
      .poll(async () => [
        await page.getByRole("tab", { selected: true }).textContent(),
        // The focused editor: the note left behind keeps its own cursor line for a moment.
        await page.locator(".cm-content:focus .cm-activeLine").textContent(),
      ])
      .toEqual([expect.stringContaining(tab), expect.stringMatching(heading(at))]);
  }

  async function ctrlClickAlias(page: Page, vault: string) {
    await loadWith(page, vault, { "Links.md": LINKS });
    await openNote(page, "Links");
    await expect(alias(page)).toHaveText("Jorge");
    await alias(page).click({ modifiers: ["Control"] });
    await landed(page, "borges", "Life");
    expect(await inbox(vault)).toEqual([]);
  }

  test("Ctrl+click on the alias opens the note at its heading with vim on, and makes no note", async ({
    page,
    stack,
  }) => {
    await ctrlClickAlias(page, stack.vault);
  });

  test("Ctrl+click on a link to a heading of its own note jumps there, and opens no other note", async ({
    page,
    stack,
  }) => {
    await loadWith(page, stack.vault, { "Self.md": "[[#Below]]\n\ntext\n\n## Below\n\nend\n" });
    await openNote(page, "Self");
    // The click puts the cursor on the link's line, so only the jump moves it to Below.
    await page.locator(".cm-wikilink").click({ modifiers: ["Control"] });
    await landed(page, "Self", "Below");
    await expect(page.getByRole("tab")).toHaveCount(1);
    expect(await inbox(stack.vault)).toEqual([]);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("Ctrl+click on the alias opens the note at its heading, and makes no note", async ({
      page,
      stack,
    }) => {
      await ctrlClickAlias(page, stack.vault);
    });
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on the alias opens the note at its heading", async ({ page, stack }) => {
      await vaultWith(stack.vault, { "reading/borges.md": BORGES, "Links.md": LINKS });
      await page.goto("/?note=Links.md");
      await expect(alias(page)).toHaveText("Jorge", { timeout: 15_000 });
      await alias(page).tap();
      // The phone keeps the note it left in the page, hidden, so the read is of the one it opened.
      const opened = page.locator(".cm-content", { hasText: "born 1899" });
      await expect(opened.locator(".cm-activeLine")).toHaveText(heading("Life"));
    });
  });
});

test.describe("the theme of an open page of html", () => {
  const PAGE = "theme.html";
  const THEMED = `<!doctype html><html><head><meta name="kasten-theme" content="tokens"><title>t</title></head><body><h1>themed</h1></body></html>`;
  const ADDRESS = `/api/html/${PAGE}?theme=light&palette=poel`;
  const ROW = "Toggle light and dark mode";
  const frame = (page: Page) => page.locator("[data-html-pane] iframe");
  const pageTheme = (page: Page) =>
    page.frameLocator("[data-html-pane] iframe").locator("html").getAttribute("data-theme");

  /** Writes the themed page and counts each fetch of it, so a reload of the frame shows. */
  async function themedPage(page: Page, vault: string): Promise<() => number> {
    await vaultWith(vault, { [PAGE]: THEMED });
    let fetched = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/html/${PAGE}`) fetched += 1;
    });
    return () => fetched;
  }

  /** The page in a split beside Welcome, with the focus back on the note, so the palette opens over an editor. */
  async function pageBesideNote(page: Page, split: () => Promise<void>): Promise<void> {
    await openApp(page);
    await openNote(page, "Welcome");
    await split();
    await page.getByRole("button", { name: PAGE, exact: true }).click();
    await expect.poll(() => pageTheme(page)).toBe("light");
    await page.locator(".cm-content").first().click();
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  }

  /** The row turned the page dark through its message, and the frame was neither readdressed nor fetched again. */
  async function turnedDark(page: Page, fetched: () => number): Promise<void> {
    await expect.poll(() => pageTheme(page)).toBe("dark");
    await expect(frame(page)).toHaveAttribute("src", ADDRESS);
    expect(fetched()).toBe(1);
  }

  test("with vim on, the palette's light and dark row turns an open page dark with no reload, and its address stays", async ({
    page,
    stack,
  }) => {
    const fetched = await themedPage(page, stack.vault);
    await pageBesideNote(page, () => leader(page, "%"));
    await expect(frame(page)).toHaveAttribute("src", ADDRESS);

    await leader(page, ":");
    await page.getByRole("option", { name: ROW }).click();
    await turnedDark(page, fetched);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("the same row, run from the chord, turns an open page dark with no reload, and its address stays", async ({
      page,
      stack,
    }) => {
      const fetched = await themedPage(page, stack.vault);
      await pageBesideNote(page, async () => {
        await page.keyboard.press("Control+Shift+P");
        await page.getByRole("option", { name: /^Split the pane left and right/ }).click();
      });
      await expect(frame(page)).toHaveAttribute("src", ADDRESS);

      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: ROW }).click();
      await turnedDark(page, fetched);
    });
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("the toolbar's run button opens the palette, and the same row turns an open page dark with no reload", async ({
      page,
      stack,
    }) => {
      const fetched = await themedPage(page, stack.vault);
      await page.goto("/?note=Welcome.md");
      const commands = page.getByRole("toolbar", { name: "Commands" });
      await expect(commands).toBeVisible({ timeout: 15_000 });
      // The tree is a drawer that is shut, so the page is opened through its button.
      await page.getByRole("button", { name: "File tree" }).tap();
      await page.getByRole("button", { name: PAGE, exact: true }).tap();
      await expect.poll(() => pageTheme(page)).toBe("light");
      await expect(frame(page)).toHaveAttribute("src", ADDRESS);

      await commands.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name: ROW }).tap();
      await turnedDark(page, fetched);
    });
  });
});

test.describe("RSVP over a page of html", () => {
  type Held = { asks: number };

  test("a read asked again after the first was closed unanswered still takes the page's late answer, past the first read's five seconds", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "page.html": "<p>Hello world</p>" });
    // In the frame, a listener set before kasten's page script holds every ask for the page's text,
    // so the test answers when it chooses, as a slow page would.
    await page.addInitScript(() => {
      if (window === window.top) return;
      const held = window as unknown as Held;
      held.asks = 0;
      addEventListener("message", (event) => {
        if (event.data?.kasten !== "text") return;
        held.asks += 1;
        event.stopImmediatePropagation();
      });
    });
    await page.clock.install();
    await openApp(page);
    await page.getByRole("button", { name: "page.html", exact: true }).click();
    const held = page.frameLocator("[data-html-pane] iframe");
    await expect(held.getByText("Hello world")).toBeVisible();
    const frame = page.frame({ url: /\/api\/html\/page\.html/ });
    if (frame === null) throw new Error("the page's frame is not there");
    const asks = () => frame.evaluate(() => (window as unknown as Held).asks);
    await page.locator("[data-html-pane] header").getByText("page.html").click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));

    const reader = page.getByRole("dialog", { name: "RSVP" });
    await leader(page, "rr");
    await expect.poll(asks).toBe(1);
    await page.clock.runFor(3000);
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);

    await leader(page, "rr");
    await expect.poll(asks).toBe(2);
    // Past the first read's five seconds, which must not take the second read's wait with them.
    await page.clock.runFor(2500);
    await frame.evaluate(() =>
      parent.postMessage({ kasten: "text", text: document.body.innerText }, "*"),
    );
    await expect(reader.locator('output[aria-live="off"]')).toHaveText("Hello");
  });
});

test.describe("a link followed while the vault's listings load", () => {
  const LINKS = "Links.md";
  const NOTES = /\/api\/files$/;
  const welcome = (page: Page) => page.getByRole("heading", { name: "Welcome", level: 1 });

  /** Holds a listing until the test lets it go: `abort` stands in for a listing that fails. */
  async function hold(page: Page, listing: RegExp): Promise<(abort?: boolean) => void> {
    let release: (abort: boolean) => void = () => {};
    const gate = new Promise<boolean>((done) => {
      release = done;
    });
    await page.route(listing, async (route) => ((await gate) ? route.abort() : route.continue()));
    return (abort = false) => release(abort);
  }

  /** Loads `Links.md` by its address, since the tree waits on the held listing. */
  async function openLinks(page: Page, vault: string, listing = NOTES) {
    await vaultWith(vault, { [LINKS]: "Some text.\n\n[[Welcome]] is the door.\n" });
    const release = await hold(page, listing);
    await page.goto(`/?note=${LINKS}`);
    await expect(page.getByText("Some text.")).toBeVisible({ timeout: 15_000 });
    return release;
  }

  test("gf opens the note once the listing arrives, and writes none into the inbox", async ({
    page,
    stack,
  }) => {
    const release = await openLinks(page, stack.vault);
    await page.keyboard.type("3Ggf");
    release();
    await expect(welcome(page)).toBeVisible();
    expect(await inbox(stack.vault)).toEqual([]);
  });

  test("a listing that fails opens nothing and writes no note", async ({ page, stack }) => {
    const release = await openLinks(page, stack.vault);
    await page.keyboard.type("3Ggf");
    release(true);
    await page.unroute(NOTES);
    await expect(welcome(page)).toHaveCount(0);
    // A second gf reads the listing afresh, so it says the first was settled without a write.
    await page.keyboard.type("gf");
    await expect(welcome(page)).toBeVisible();
    expect(await inbox(stack.vault)).toEqual([]);
  });

  test("a follow that waited does not pull back a reader who opened another note", async ({
    page,
    stack,
  }) => {
    // The assets held, not the notes, so the tree can open the other note while gf waits.
    const release = await openLinks(page, stack.vault, /\/api\/vault-assets$/);
    await page.keyboard.type("3Ggf");
    await openFromTree(page, "Long note");
    await expect(page.getByRole("heading", { name: "Long note", level: 1 })).toBeVisible();
    release();
    await expect(page.getByRole("tab", { name: "Welcome" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Long note", level: 1 })).toBeVisible();
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("ctrl and a click open the note once the listing arrives", async ({ page, stack }) => {
      const release = await openLinks(page, stack.vault);
      await page.locator(".cm-wikilink", { hasText: "Welcome" }).click({ modifiers: ["Control"] });
      release();
      await expect(welcome(page)).toBeVisible();
      expect(await inbox(stack.vault)).toEqual([]);
    });
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap opens the note once the listing arrives", async ({ page, stack }) => {
      const release = await openLinks(page, stack.vault);
      await page.locator(".cm-wikilink", { hasText: "Welcome" }).tap();
      release();
      await expect(welcome(page)).toBeVisible();
      expect(await inbox(stack.vault)).toEqual([]);
    });
  });
});
