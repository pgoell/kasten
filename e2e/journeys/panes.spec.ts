import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { findNote, leader, openApp, openFromTree } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const panes = (page: Page): Locator => page.locator("[data-pane]:visible");

/** Opens a note from the tree and waits for its editor's focus: keys sent sooner are lost (#1738). */
async function openNote(page: Page, name: string) {
  await openFromTree(page, name);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** The panes' boxes, leftmost first, once each has settled on screen. */
async function boxes(page: Page) {
  const found = await Promise.all((await panes(page).all()).map((pane) => pane.boundingBox()));
  return found.filter((box) => box !== null).sort((a, b) => a.x - b.x || a.y - b.y);
}

test("a split keeps the editor and its note", async ({ page }) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  const editor = page.locator(".cm-editor", { hasText: "front door" });
  await editor.click();
  await page.keyboard.press("Escape");
  // A mark on the DOM node: a remounted editor would come back without it.
  await editor.evaluate((node) => node.setAttribute("data-e2e-kept", "yes"));
  await leader(page, "%");
  // The new pane opens on the day page beside the note.
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await expect(page.locator(".cm-editor")).toHaveCount(2);
  await expect(page.locator(".cm-editor[data-e2e-kept=yes]")).toContainText("front door");
});

test("a split right and a split down make three panes, one beside and one below", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  await leader(page, '"');
  await expect(panes(page)).toHaveCount(3);
  // The Welcome pane stands on the left; the other two stand right of it, one above the other.
  await expect
    .poll(async () => {
      const [left, upper, lower] = await boxes(page);
      return (
        upper !== undefined &&
        lower !== undefined &&
        upper.x > left.x + left.width - 1 &&
        Math.abs(upper.x - lower.x) < 2 &&
        lower.y > upper.y + upper.height - 1
      );
    })
    .toBe(true);
});

test("a close takes the empty pane away and leaves Welcome", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  // The new pane is empty, so the first q closes it.
  await leader(page, "q");
  await expect(panes(page)).toHaveCount(1);
  await expect(page.locator(".cm-editor", { hasText: "front door" })).toBeVisible();
});

test("the panes and their notes are back after a reload", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  await findNote(page, "Garden");
  await expect(page.locator(".cm-editor", { hasText: "water the tomatoes" })).toBeVisible();
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  await expect(panes(page).filter({ hasText: "front door" })).toHaveCount(1);
  await expect(panes(page).filter({ hasText: "water the tomatoes" })).toHaveCount(1);
});

test("q in the tree hands the keys to the focused pane, the second of two", async ({ page }) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  await leader(page, "e");
  await expect(page.getByRole("navigation", { name: "Vault" }).locator(":focus")).toHaveCount(1);
  await page.keyboard.press("q");
  await expect(page.getByRole("navigation", { name: "Vault" })).toBeHidden();
  await expect(panes(page).filter({ has: today }).locator(".cm-content")).toBeFocused();
  await leader(page, "ff");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
});

test("q in the tree with vim off sends what is typed next into the note", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  await openFromTree(page, "Welcome");
  const note = page.locator(".cm-editor", { hasText: "front door" });
  await note.locator(".cm-content").click();
  const row = page
    .getByRole("navigation", { name: "Vault" })
    .getByRole("button", { name: "Welcome", exact: true });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("q");
  await expect(page.getByRole("navigation", { name: "Vault" })).toBeHidden();
  await page.keyboard.type("zq");
  await expect(note).toContainText("zq");
});

test("Escape in the tree hands the keys to the focused pane, the second of two", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  await leader(page, "e");
  const tree = page.getByRole("navigation", { name: "Vault" });
  await expect(tree.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(tree).toBeVisible();
  await expect(panes(page).filter({ has: today }).locator(".cm-content")).toBeFocused();
  await leader(page, "ff");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
});

test("Escape in the tree with vim off types into the focused pane, the second of two", async ({
  page,
}) => {
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, "%");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  // The split needs vim's leader, so it is made first and the reload brings it back with vim off.
  await page.evaluate(() => localStorage.setItem("kasten.vim", "off"));
  await page.reload();
  const right = panes(page).filter({ has: today }).locator(".cm-content");
  await right.click();
  const row = page
    .getByRole("navigation", { name: "Vault" })
    .getByRole("button", { name: "Welcome", exact: true });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.type("zq");
  await expect(right).toContainText("zq");
  await expect(page.locator(".cm-editor", { hasText: "front door" })).not.toContainText("zq");
});

test.describe("following a link to a page of html or an asset", () => {
  const PAGE = "01 Periodic/05 Newspaper/2026-10-07.html";
  const primer = (vault: string) => readFile(join(vault, "04 Books/Primer.pdf"));

  /** Writes each file into the vault, records each window.open, then loads the app. */
  async function vaultWith(page: Page, vault: string, files: Record<string, string | Buffer>) {
    for (const [path, body] of Object.entries(files)) {
      await mkdir(join(vault, dirname(path)), { recursive: true });
      await writeFile(join(vault, path), body);
    }
    // A new tab would leave the box, so the page keeps the addresses it was asked to open.
    await page.addInitScript(() => {
      const opened: string[] = [];
      Object.assign(window, { opened, open: (url: string) => opened.push(url) && null });
    });
    await openApp(page);
  }

  const opened = (page: Page) =>
    page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  const frame = (page: Page) => page.locator("[data-html-pane] iframe");
  /** The frame's page and the heading after its `#`; the address also carries the look (#786). */
  const shown = async (page: Page) => [
    await frame(page).getAttribute("title"),
    (await frame(page).getAttribute("src"))?.split("#")[1] ?? null,
  ];
  const inbox = (vault: string) => readdir(join(vault, "00 Inbox")).catch(() => []);

  test("gf opens an html page in its pane by its bare name, behind an alias, at its heading and in capitals", async ({
    page,
    stack,
  }) => {
    const links =
      "[[2026-10-07.html]]\n[[2026-10-07.html|the paper]]\n[[2026-10-07.html#the paper]]\n[[2026-10-07.HTML]]\n";
    await vaultWith(page, stack.vault, { [PAGE]: "<h1>the paper</h1>", "Links.md": links });
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
    await vaultWith(page, stack.vault, {
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
    await vaultWith(page, stack.vault, {
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
    await vaultWith(page, stack.vault, { "plan #2.html": "<h1>two</h1>" });
    await page.getByRole("button", { name: "plan #2.html" }).click();
    await expect
      .poll(async () => (await frame(page).getAttribute("src"))?.split("?")[0])
      .toBe("/api/html/plan%20%232.html");
  });

  test("gf opens an asset the vault holds in a new tab in any case and with ? in its name, each drawn live", async ({
    page,
    stack,
  }) => {
    await vaultWith(page, stack.vault, {
      "rehearse/my plan.pdf": await primer(stack.vault),
      "rehearse/my talk.mp3": "a talk",
      "plan?.mp3": "a plan",
      "docs/Talk.MP3": "a talk",
      "Links.md":
        "# Links\n[[my plan.pdf]]\n[[My Talk.MP3|the talk]]\n[[plan?.mp3]]\n[[Talk.MP3]]\n",
    });
    await openNote(page, "Links");
    await expect
      .poll(async () => [
        await page.locator(".cm-wikilink").allTextContents(),
        await page.locator(".cm-wikilink-dead").count(),
      ])
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
      await vaultWith(page, stack.vault, {
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
