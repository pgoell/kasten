import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp, openNote, panes, today } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// Each act starts in Welcome with typing waiting; its write is held while the focus moves (#1609, #1626).

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const DAILY = () => `01 Periodic/00 Daily/${today()}.md`;

/** The saved layout: each tab's panes without their ids, the active tab and each tab's focused pane. */
const layout = (page: Page) =>
  page.evaluate(() => {
    type Node = { id?: string; children?: Node[] } & Record<string, unknown>;
    const all = (node: Node): Node[] => node.children?.flatMap(all) ?? [node];
    const saved = JSON.parse(localStorage.getItem("kasten.workspace.1") ?? "null").layout;
    return {
      active: saved.active as number,
      tabs: (saved.tabs as { root: Node; focus: string }[]).map((tab) => ({
        leaves: all(tab.root).map(({ id: _id, ...held }) => held),
        focus: all(tab.root).findIndex((leaf) => leaf.id === tab.focus),
      })),
    };
  });

/**
 * Writes a note, an image, a page and a pdf into the vault, holds every PUT of Welcome until
 * `release`, loads the app and opens Welcome. `beside` makes the second place the focus goes to: a pane right of it, or a tab.
 */
async function held(page: Page, vault: string, beside: "pane" | "tab") {
  await writeFile(join(vault, "Third.md"), "the third note\n");
  await writeFile(join(vault, "pic.png"), PNG);
  await writeFile(join(vault, "page.html"), "<h1>a page</h1>");
  await copyFile(join(vault, "04 Books/Primer.pdf"), join(vault, "doc.pdf"));
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === "/api/files/Welcome.md",
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      puts += 1;
      await gate;
      await route.fallback();
    },
  );
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, beside === "pane" ? "%" : "ct");
  await openNote(page, "Long note");
  await leader(page, beside === "pane" ? "h" : "th");
  await expect(page.locator(".cm-content:focus")).toContainText("front door");
  await page.keyboard.type("Gotyped before");
  await page.keyboard.press("Escape");
  return { release, sent: () => expect.poll(() => puts).toBeGreaterThan(0) };
}

// Found by the header, as CodeMirror drops lines scrolled out of view (#1830).
const longNote = (page: Page) => panes(page).filter({ hasText: "Long note.md" });

/** Types into Long note once its editor holds the focus. */
async function typeRight(page: Page) {
  await expect(longNote(page).locator(".cm-content:focus")).toHaveCount(1);
  await page.keyboard.type("Gotyped right");
  await page.keyboard.press("Escape");
}

/** Welcome on disk holds the typing, Long note's editor its own and the focus, and the layout. */
const settled = async (page: Page, vault: string) => [
  (await noteText(vault, "Welcome.md")).includes("typed before"),
  await page.locator(".cm-content:focus", { hasText: "typed right" }).count(),
  await layout(page),
];

test.describe("a pane act whose write is held while the focus moves", () => {
  test("Space q closes the note it was pressed on when the focus moves right during the save (#1609)", async ({
    page,
    stack,
  }) => {
    const { release, sent } = await held(page, stack.vault, "pane");
    await leader(page, "q");
    await sent();
    await leader(page, "l");
    await typeRight(page);
    release();
    await expect
      .poll(() => settled(page, stack.vault), { timeout: 15_000 })
      .toEqual([
        true,
        1,
        { active: 0, tabs: [{ leaves: [{}, { path: "Long note.md" }], focus: 1 }] },
      ]);
    await expect(page.locator(".cm-content", { hasText: "front door" })).toHaveCount(0);
  });

  test("Space q writes what was typed into its note after the key and before the save answered (#1609)", async ({
    page,
    stack,
  }) => {
    const { release, sent } = await held(page, stack.vault, "pane");
    await leader(page, "q");
    await sent();
    await page.keyboard.type("Gotyped after");
    await page.keyboard.press("Escape");
    await leader(page, "l");
    await expect(page.locator(".cm-content:focus", { hasText: "long enough" })).toHaveCount(1);
    release();
    await expect
      .poll(
        async () => [
          (await noteText(stack.vault, "Welcome.md")).includes("typed before\ntyped after"),
          (await layout(page)).tabs[0].leaves,
        ],
        { timeout: 15_000 },
      )
      .toEqual([true, [{}, { path: "Long note.md" }]]);
  });

  test("Space q closes the note it was pressed on when the focus goes to another tab during the save (#1609)", async ({
    page,
    stack,
  }) => {
    const { release, sent } = await held(page, stack.vault, "tab");
    await leader(page, "q");
    await sent();
    await leader(page, "tl");
    await typeRight(page);
    release();
    await expect
      .poll(() => settled(page, stack.vault), { timeout: 15_000 })
      .toEqual([
        true,
        1,
        {
          active: 1,
          tabs: [
            { leaves: [{}], focus: 0 },
            { leaves: [{ path: "Long note.md" }], focus: 0 },
          ],
        },
      ]);
  });

  test("a note from the tree fills the pane it started from when the focus goes to another tab during the save (#1626)", async ({
    page,
    stack,
  }) => {
    const { release, sent } = await held(page, stack.vault, "tab");
    await page.getByRole("button", { name: "Third", exact: true }).click();
    await sent();
    // A click on the tab raced the tab's own focus on CI; Escape hands the keys from the tree back.
    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-content:focus")).toContainText("typed before");
    await leader(page, "tl");
    await typeRight(page);
    release();
    await expect
      .poll(() => settled(page, stack.vault), { timeout: 15_000 })
      .toEqual([
        true,
        1,
        {
          active: 1,
          tabs: [
            { leaves: [{ path: "Third.md" }], focus: 0 },
            { leaves: [{ path: "Long note.md" }], focus: 0 },
          ],
        },
      ]);
  });

  test("Space L moves the pane it was pressed in when the focus moves right during the save (#1626)", async ({
    page,
    stack,
  }) => {
    const { release, sent } = await held(page, stack.vault, "pane");
    await leader(page, "L");
    await sent();
    await leader(page, "l");
    await typeRight(page);
    release();
    // The focus stays on Long note, now on the left.
    await expect
      .poll(() => settled(page, stack.vault), { timeout: 15_000 })
      .toEqual([
        true,
        1,
        {
          active: 0,
          tabs: [{ leaves: [{ path: "Long note.md" }, { path: "Welcome.md" }], focus: 0 }],
        },
      ]);
    await expect(panes(page).filter({ hasText: "typed before" })).toHaveCount(1);
  });

  /** Picks the first row the note finder ranks for `query`, before the held write lets it open. */
  async function find(page: Page, query: string) {
    await leader(page, "ff");
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill(query);
    await expect(finder.getByRole("option").first()).toContainText(query);
    await page.keyboard.press("Enter");
  }

  const tree = (name: string) => (page: Page) =>
    page
      .getByRole("navigation", { name: "Vault" })
      .getByRole("button", { name, exact: true })
      .click();

  const OPENERS: [string, (page: Page) => Promise<void>, () => Record<string, unknown>][] = [
    ["a note from the tree", tree("Third"), () => ({ path: "Third.md" })],
    ["an image from the tree", tree("pic.png"), () => ({ image: "pic.png" })],
    ["a page from the tree", tree("page.html"), () => ({ html: "page.html" })],
    ["a pdf from the tree", tree("doc.pdf"), () => ({ pdf: { path: "doc.pdf" } })],
    ["a note from the finder", (page) => find(page, "Third"), () => ({ path: "Third.md" })],
    [
      "a pdf from the finder",
      (page) => find(page, "doc.pdf"),
      () => ({ pdf: { path: "doc.pdf" } }),
    ],
    ["a daily note made by its key", (page) => leader(page, "gd"), () => ({ path: DAILY() })],
  ];

  for (const [name, start, fills] of OPENERS) {
    test(`${name} fills the pane it started from when the focus moves right during the save (#1626)`, async ({
      page,
      stack,
    }) => {
      const { release, sent } = await held(page, stack.vault, "pane");
      await start(page);
      await sent();
      // A row taken from the tree or the finder hands no focus back, so a click moves it.
      // A small target: a retried click on the whole editor scrolled it far down (#1830).
      await longNote(page).getByText("long enough").click();
      await typeRight(page);
      release();
      await expect
        .poll(() => settled(page, stack.vault), { timeout: 15_000 })
        .toEqual([
          true,
          1,
          {
            active: 0,
            tabs: [
              { leaves: [expect.objectContaining(fills()), { path: "Long note.md" }], focus: 1 },
            ],
          },
        ]);
    });
  }
});
