import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  findNote,
  inbox,
  leader,
  opened,
  openApp,
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
  // The page's own listener runs before kasten's, being a capture one, and holds every ask for its
  // text, so the test answers when it chooses, as a slow page would.
  const HELD = `<p>Hello world</p><script>
window.asks = 0;
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.kasten !== "text") return;
  window.asks += 1;
  event.stopImmediatePropagation();
}, true);
</script>`;
  type Held = { asks: number };

  test("a read asked again after the first was closed unanswered still takes the page's late answer, past the first read's five seconds", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "page.html": HELD });
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
