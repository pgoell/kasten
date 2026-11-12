import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  findNote,
  inbox,
  opened,
  openApp,
  openNote,
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
