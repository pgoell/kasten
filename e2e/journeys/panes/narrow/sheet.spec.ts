import type { Locator, Page } from "@playwright/test";
import {
  caretLine,
  findNote,
  leader,
  openApp,
  openNote,
  toTodoList,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** A panel over the app: its dialog's name, the leader keys that open it, and whether its field is a draft. */
type Panel = { name: string; keys: string; draft?: boolean };

// The todo prompt last: `gt` puts the todo pane where the note was.
const PANELS: Panel[] = [
  { name: "Run a command", keys: ":" },
  { name: "Find note", keys: "ff" },
  { name: "Search notes", keys: "fg" },
  { name: "Keyboard shortcuts", keys: "?" },
  { name: "New note", keys: "cf", draft: true },
  { name: "Capture a thought", keys: "cd", draft: true },
  { name: "Import a web page", keys: "cw", draft: true },
  { name: "Open terminal", keys: "cs", draft: true },
  { name: "Add todo", keys: "gt", draft: true },
];

/** A point on the sheet well clear of every panel, which sits centred 15vh down. */
const SHEET = { x: 8, y: 8 };

/** Opens the panel from the note's editor; returns the sheet, the panel on it and its field. */
async function open(page: Page, { name, keys }: Panel) {
  await page.locator(".cm-content").first().locator(".cm-line:visible").last().click();
  await page.keyboard.press("Escape");
  await leader(page, keys);
  if (name === "Add todo") {
    await toTodoList(page);
    await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
    await page.keyboard.press("a");
  }
  const sheet = page.getByRole("dialog", { name });
  const field = sheet.locator("input").first();
  await expect(field).toBeFocused();
  return { sheet, panel: sheet.locator("> div").first(), field };
}

/** Presses at one point and lets go at another, as a mouse does. */
async function press(page: Page, from: { x: number; y: number }, to = from) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Two frames on: a close the click asked for has been drawn by then. */
async function framed(page: Page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** A point where the panel itself, not a child of it, takes the press: its 1 px border. */
async function bare(panel: Locator) {
  const point = await panel.evaluate((own) => {
    const { left, top, width, height } = own.getBoundingClientRect();
    for (let y = top + 1; y < top + height; y += 2)
      for (const x of [left, left + 0.25, left + width - 0.5, left + width - 0.75])
        if (document.elementFromPoint(x, y) === own) return { x, y };
    return null;
  });
  if (!point) throw new Error("no point of the panel is its own");
  return point;
}

async function middle(field: Locator) {
  const box = await field.boundingBox();
  if (!box) throw new Error("not drawn");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the sheet around a panel", () => {
  test("closes every panel on a press and release on the sheet, open still at the press", async ({
    page,
  }) => {
    await openApp(page);
    for (const panel of PANELS) {
      await test.step(panel.name, async () => {
        const { sheet } = await open(page, panel);
        await page.mouse.move(SHEET.x, SHEET.y);
        await page.mouse.down();
        // Still up at the press, and the press's own step moved the focus to the sheet.
        await expect(sheet).toBeVisible();
        await expect(sheet).toBeFocused();
        await page.mouse.up();
        await expect(sheet).toBeHidden();
      });
    }
  });

  test("keeps every panel open on a press inside it, on its field and on the panel itself", async ({
    page,
  }) => {
    await openApp(page);
    for (const panel of PANELS) {
      await test.step(panel.name, async () => {
        const { sheet, panel: box, field } = await open(page, panel);
        await press(page, await middle(field));
        await framed(page);
        await expect(sheet).toBeVisible();
        await press(page, await bare(box));
        await framed(page);
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      });
    }
  });

  test("keeps every panel open when a drag out of it is let go over the sheet", async ({
    page,
  }) => {
    await openApp(page);
    for (const panel of PANELS) {
      await test.step(panel.name, async () => {
        const { sheet, field } = await open(page, panel);
        await press(page, await middle(field), SHEET);
        await framed(page);
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      });
    }
  });

  test("keeps every panel open when a press on the sheet is let go inside it", async ({ page }) => {
    await openApp(page);
    for (const panel of PANELS) {
      await test.step(panel.name, async () => {
        const { sheet, field } = await open(page, panel);
        await press(page, SHEET, await middle(field));
        await framed(page);
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      });
    }
  });

  test("keeps what was typed in a draft when the sheet is pressed, and Escape still closes it", async ({
    page,
  }) => {
    await openApp(page);
    for (const panel of PANELS.filter((each) => each.draft)) {
      await test.step(panel.name, async () => {
        const { sheet, field } = await open(page, panel);
        await page.keyboard.type("half a thought");
        await press(page, SHEET);
        await framed(page);
        await expect(sheet).toBeVisible();
        await expect(field).toHaveValue(/half a thought/);
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      });
    }
  });

  test("closes a rename nobody has typed into, the path it opens on being no draft", async ({
    page,
  }) => {
    await openApp(page);
    await findNote(page, "Quote");
    await leader(page, "rf");
    const sheet = page.getByRole("dialog", { name: "Rename note" });
    await expect(sheet.getByRole("combobox")).toHaveValue(/Quote/, { timeout: 15_000 });
    await press(page, SHEET);
    await expect(sheet).toBeHidden();
  });
});

test.describe("a note's links: the margin of a wide pane, the Local graph sheet of a narrow one", () => {
  const node = (path: string, name: string) => ({
    path,
    name,
    type: null,
    tags: [],
    missing: false,
  });
  const edge = (source: string, target: string, line: number) => ({
    source,
    target,
    relation: null,
    line,
  });
  // Margin links out to Other, Borges and Ref link in, and Ref twice, which must make one row.
  const GRAPH = {
    nodes: [
      node("Margin.md", "Margin"),
      node("Other.md", "Other note"),
      node("Borges.md", "Borges"),
      node("Ref.md", "Ref"),
    ],
    edges: [
      edge("Margin.md", "Other.md", 3),
      edge("Borges.md", "Margin.md", 5),
      edge("Ref.md", "Margin.md", 2),
      edge("Ref.md", "Margin.md", 4),
    ],
    columns: [],
    rows: [],
    truncated: false,
  };
  const margin = (page: Page) => page.locator("[data-margin='links']");
  /** The rows of the Links (0) or Backlinks (1) list, the two lists the graph answers. */
  const rows = (scope: Locator, list: 0 | 1) =>
    scope.locator("section").nth(list).getByRole("button");
  const sheet = (page: Page) => page.getByRole("dialog", { name: "Local graph" });
  const asked: string[] = [];

  /** Opens Margin.md, the graph answered by `graph`, at `width`; every graph and mentions read is kept. */
  async function openMargin(
    page: Page,
    vault: string,
    width: number,
    graph: object | null = GRAPH,
  ) {
    asked.length = 0;
    await vaultWith(vault, {
      "Margin.md": "# Margin\n\nSee the other note.\n",
      "Other.md": "other\n",
      "Borges.md": "# Borges\n\nBorn 1899.\n\nSee [[Margin]].\n",
    });
    page.on("request", (request) => {
      const { pathname, search } = new URL(request.url());
      if (/^\/api\/(graph|mentions)$/.test(pathname)) asked.push(`${pathname}${search}`);
    });
    await page.route("**/api/graph?*", (route) =>
      graph ? route.fulfill({ json: graph }) : route.fulfill({ status: 500, body: "down" }),
    );
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await openNote(page, "Margin");
  }

  test("a wide pane lists its links and backlinks, one row a note, and draws the graph around it", async ({
    page,
    stack,
  }) => {
    await openMargin(page, stack.vault, 1900);

    await expect(rows(margin(page), 0)).toHaveText(["Other note"]);
    await expect(rows(margin(page), 1)).toHaveText(["Borges", "Ref"]);
    expect(asked.filter((url) => url.startsWith("/api/graph"))).toEqual([
      "/api/graph?q=&around=Margin.md&depth=1&archive=false",
    ]);
    // Painted, not only placed: the canvas holds the dots of the answer.
    const canvas = margin(page).getByTestId("local-graph-canvas").locator("canvas");
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const { data } = c.getContext("2d")?.getImageData(0, 0, c.width, c.height) ?? {
            data: [],
          };
          return data.some((value, i) => i % 4 === 3 && value > 0);
        }),
      )
      .toBe(true);
  });

  for (const vim of ["on", "off"]) {
    test(`a click on a backlink in the margin opens its note at the line that links here, vim ${vim}`, async ({
      page,
      stack,
    }) => {
      await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
      await openMargin(page, stack.vault, 1900);

      await rows(margin(page), 1).first().click();

      await expect(page.getByRole("tab", { name: "Borges", selected: true })).toBeVisible();
      await expect(caretLine(page)).toHaveText(/^See (\[\[)?Margin(\]\])?\.$/);
    });
  }

  test("a failed graph read leaves the plain lines and no rows", async ({ page, stack }) => {
    await openMargin(page, stack.vault, 1900, null);

    await expect(margin(page)).toContainText("No links.");
    await expect(margin(page)).toContainText("No backlinks.");
    await expect(rows(margin(page), 0)).toHaveCount(0);
    await expect(rows(margin(page), 1)).toHaveCount(0);
  });

  test("a narrow pane asks no graph and draws no canvas, even after a save, till its Graph button opens the sheet", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openMargin(page, stack.vault, 1280);
    const saved = page.waitForResponse((answer) => answer.request().method() === "PUT");
    await page.keyboard.type("x");
    await saved;

    expect(asked).toEqual([]);
    await expect(page.getByTestId("local-graph-canvas")).toHaveCount(0);

    await page.locator("[data-head='graph']").click();
    await expect(sheet(page).getByTestId("local-graph-canvas")).toBeVisible();
    await expect(sheet(page)).toContainText("Backlinks 2");
    await expect(rows(sheet(page), 1)).toHaveText(["Borges", "Ref"]);
    // The matcher above counts the sheet's read, so its zero was no glob that never matches.
    expect(asked.some((url) => url.startsWith("/api/graph"))).toBe(true);
  });

  test("a click on a row in the sheet opens that note and closes the sheet", async ({
    page,
    stack,
  }) => {
    await openMargin(page, stack.vault, 1280);
    await page.locator("[data-head='graph']").click();

    await rows(sheet(page), 0).click();

    await expect(page.getByRole("tab", { name: "Other", selected: true })).toBeVisible();
    await expect(sheet(page)).toBeHidden();
  });
});
