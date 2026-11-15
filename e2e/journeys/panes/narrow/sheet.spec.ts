import type { Locator, Page } from "@playwright/test";
import { findNote, leader, openApp } from "../../../harness/app.ts";
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
