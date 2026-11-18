import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  bodyOf,
  findNote,
  leader,
  noteText,
  openApp,
  PANE,
  panes,
  readAll,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { beside, focusedPane, layout, load, paneText, seed, selectedTab } from "./stored.ts";

// Every sequence runs with vim on, the desktop's default, from the editor or the book pane: with vim off,
// as on a phone, the editor takes no leader and the palette holds the same rows.

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const row = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const book = (page: Page) => page.locator("[data-book-pane]");
/** Whether `path` is on disk: only a missing file reads as false, any other fault fails the poll. */
const exists = (path: string) =>
  access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** Waits for the editor to hold the focus, as keys sent sooner are lost (#1615). */
async function inEditor(page: Page): Promise<void> {
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** Shuts the dialog that holds the focus and waits for the editor to take it back. */
async function shut(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await inEditor(page);
}

test("b folds the tree and b unfolds it, and e unfolds it with the focus in it", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "b");
  await expect(tree(page)).toBeHidden();
  await leader(page, "b");
  await expect(tree(page)).toBeVisible();
  await leader(page, "b");
  await expect(tree(page)).toBeHidden();
  await leader(page, "e");
  await expect(tree(page).locator(":focus")).toHaveCount(1);
});

test("E puts the focus on the open note's row in its folded folder, where e lands elsewhere", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Garden");
  await expect(row(page, "Garden")).toHaveCount(0);
  await leader(page, "e");
  await expect(tree(page).locator(":focus")).toHaveCount(1);
  await expect(row(page, "Garden")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  // Shift's own press, as a keyboard sends it before the E, keeps the panel waiting.
  await page.keyboard.press("Space");
  await page.keyboard.down("Shift");
  await expect(dialog(page, "Leader keys")).toBeVisible();
  await page.keyboard.press("E");
  await page.keyboard.up("Shift");
  await expect(row(page, "Garden")).toBeFocused();
});

test("q closes the open note and ? opens the key help", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Garden");
  await leader(page, "q");
  await expect(page.getByRole("tab", { name: "Garden" })).toHaveCount(0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  await leader(page, "?");
  await expect(dialog(page, "Keyboard shortcuts")).toBeVisible();
});

test("ff, fg and ft each open their own finder and neither of the other two", async ({ page }) => {
  await openApp(page);
  const search = page.getByRole("combobox", { name: "search notes" });
  await leader(page, "ff");
  await expect(dialog(page, "Find note")).toBeVisible();
  await shut(page);
  await leader(page, "fg");
  await expect(search).toBeFocused();
  await expect(dialog(page, "Find note")).toHaveCount(0);
  await shut(page);
  await leader(page, "ft");
  await expect(dialog(page, "Todos")).toBeVisible();
  await expect(dialog(page, "Find note")).toHaveCount(0);
  await expect(search).toHaveCount(0);
});

test("gs opens the review and no book beside Primer, and gr opens Primer's book beside the note", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gs");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
  await findNote(page, "Primer");
  await leader(page, "gr");
  await expect(book(page)).toBeVisible();
  await expect(panes(page)).toHaveCount(2);
  await expect(panes(page).nth(0)).toContainText("Notes on the primer");
});

test("gr on the home screen opens no pane, and the next sequence is still heard", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator("[data-today]")).toBeVisible();
  await leader(page, "gr");
  await leader(page, "ff");
  await expect(dialog(page, "Find note")).toBeVisible();
  await expect(panes(page)).toHaveCount(1);
  await expect(book(page)).toHaveCount(0);
});

/** Which visible pane draws the focus line, or -1: a click into the book's frame moves `activeElement` whatever the app does. */
const lit = (page: Page) =>
  readAll(page, PANE, (all) =>
    all.findIndex((pane) => {
      const line = pane.querySelector("[data-focus-line]");
      return line !== null && getComputedStyle(line).backgroundColor !== "rgba(0, 0, 0, 0)";
    }),
  );

test("the book pane's w downloads the file beside the note under the vault's name, and nothing where none lies beside", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("download", (download) => sent.push(`${download.suggestedFilename()} ${download.url()}`));
  await openApp(page);
  await findNote(page, "Welcome");
  await leader(page, "gr");
  await expect(book(page)).toContainText("Nothing to read beside");
  await expect(book(page)).toBeFocused();
  await page.keyboard.press("w");
  await leader(page, "q");
  await findNote(page, "Primer");
  await leader(page, "gr");
  await expect(book(page).getByText("13%", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.keyboard.press("w");
  await download;
  const url = new URL("/api/assets/04%20Books/Primer.pdf", page.url()).href;
  expect(sent).toEqual([`Primer.pdf ${url}`]);
});

test("q closes the focused book pane and leaves the note, and after % closes the new pane and not the book", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gr");
  await expect(book(page)).toBeFocused();
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(3);
  const books = await book(page).count();
  await leader(page, "q");
  await expect(panes(page)).toHaveCount(2);
  await expect(book(page)).toHaveCount(books);
  await expect(book(page)).toBeVisible();

  await book(page).focus();
  await leader(page, "q");
  await expect(book(page)).toHaveCount(0);
  await expect(panes(page)).toHaveCount(1);
  await expect(panes(page).nth(0)).toContainText("Notes on the primer");
});

test("a click inside the book moves the focus to its pane", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gr");
  await expect(book(page).getByText("13%", { exact: true })).toBeVisible();
  await leader(page, "o");
  await expect.poll(() => lit(page)).toBe(0);
  const frame = page.frames().find((f) => f.url().startsWith("blob:"));
  await frame?.locator("body").click();
  await expect.poll(() => lit(page)).toBe(1);
});

test("gc opens the book the reading note names, from a note with no book of its own", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "99 Misc/01 Config/reading-now.md": "[[Primer]]\n",
  });
  await openApp(page);
  await findNote(page, "Welcome");
  await leader(page, "gc");
  // Primer's pdf opens on page 1 of 8; a book pane over Welcome would have no page to show.
  await expect(book(page).getByText("13%", { exact: true })).toBeVisible();
});

test("gb opens the backlinks with the tree still shown, and go the links out with no backlinks", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "gb");
  await expect(dialog(page, "Backlinks")).toContainText("Reading", {
    timeout: 15_000,
  });
  await expect(tree(page)).toBeVisible();
  await shut(page);
  await leader(page, "go");
  await expect(dialog(page, "Outgoing links")).toBeVisible();
  await expect(dialog(page, "Backlinks")).toHaveCount(0);
});

test("cf opens New note on the vault root, rf Rename note on the open note, cb the book picker", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "cf");
  await expect(dialog(page, "New note").getByRole("combobox")).toHaveValue("");
  await shut(page);
  await leader(page, "rf");
  await expect(dialog(page, "Rename note").getByRole("combobox")).toHaveValue("01 Notes/Quote.md");
  await shut(page);
  const chooser = page.waitForEvent("filechooser");
  await leader(page, "cb");
  expect(await (await chooser).element().getAttribute("accept")).toContain(".epub");
});

test("df deletes the open note, empties its pane and drops its tree row, and du brings it back open", async ({
  page,
  stack,
}) => {
  const compost = join(stack.vault, "Compost.md");
  await vaultWith(stack.vault, { "Compost.md": "Turn the heap.\n" });
  await openApp(page);
  await findNote(page, "Compost");
  await expect(row(page, "Compost")).toBeVisible();
  await leader(page, "df");
  await expect.poll(() => exists(compost)).toBe(false);
  await expect(page.getByRole("tab", { name: "Compost" })).toHaveCount(0);
  await expect(panes(page).filter({ hasText: "Turn the heap" })).toHaveCount(0);
  await expect(row(page, "Compost")).toHaveCount(0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  await leader(page, "du");
  await expect(page.getByRole("tab", { name: "Compost", selected: true })).toBeVisible();
  await expect(panes(page).filter({ hasText: "Turn the heap" })).toHaveCount(1);
  await expect.poll(() => exists(compost)).toBe(true);
});

test("du with nothing in the trash flashes the bar and opens nothing", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Seeds");
  await leader(page, "du");
  await expect(page.getByTestId("save-status")).toHaveClass(/animate-flash/);
  await expect(page.getByRole("tab")).toHaveText(["Seeds"]);
});

test("dd stays vim's delete line and deletes no note", async ({ page, stack }) => {
  await vaultWith(stack.vault, { "Lines.md": "first line\nsecond line\n" });
  await openApp(page);
  await findNote(page, "Lines");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect
    .poll(() => noteText(stack.vault, "Lines.md").then(bodyOf), {
      timeout: 15_000,
    })
    .toBe("second line\n");
  await expect(page.getByRole("tab", { name: "Lines", selected: true })).toBeVisible();
});

/** The keys the leader panel says are pressed so far, Space first. */
const pressed = (page: Page) =>
  dialog(page, "Leader keys").getByRole("region", { name: "Keys pressed" }).locator("kbd");
/** Where the Welcome pane stands beside the other pane of two, read off their boxes. */
async function welcome(page: Page): Promise<string> {
  const [w, o] = await Promise.all(
    [{ hasText: "front door" }, { hasNotText: "front door" }].map((has) =>
      panes(page).filter(has).boundingBox(),
    ),
  );
  if (!w || !o) return "unseen";
  if (w.x !== o.x) return w.x < o.x ? "left" : "right";
  return w.y < o.y ? "top" : "bottom";
}

test("bare \", 3 and l stay vim's register, count and motion, and move no pane or tab", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "Vim keys.md": "aaaa\nword\n" });
  await openApp(page);
  await findNote(page, "Vim keys");
  for (const key of ['"', "a", "y", "y", '"', "a", "p", "3", "x", "j", "l", "x"]) {
    await page.keyboard.press(key);
  }
  await expect
    .poll(() => noteText(stack.vault, "Vim keys.md").then(bodyOf), {
      timeout: 15_000,
    })
    .toBe("aaaa\na\nwrd\n");
  expect([await panes(page).count(), await page.getByRole("tab").count()]).toEqual([1, 1]);
});

test("h, j, k and l move to the pane that way and o to the next", async ({ page }) => {
  const right = {
    id: "c",
    dir: "col",
    children: [{ id: "b", path: "02 Projects/Home.md" }],
  };
  right.children.push({ id: "d", path: "02 Projects/Garden.md" });
  await seed(page, layout([beside({ path: "Welcome.md" }, right)]));
  await load(page);
  await panes(page).nth(0).locator(".cm-line").first().click();
  await page.keyboard.press("Escape");
  const moves: number[] = [];
  for (const key of ["l", "j", "k", "h", "o"]) {
    await leader(page, key);
    await expect(dialog(page, "Leader keys")).toHaveCount(0);
    moves.push(await focusedPane(page));
  }
  expect(moves).toEqual([1, 2, 1, 0, 1]);
});

test("H, J, K and L swap the pane that way, and bare H swaps nothing", async ({ page }) => {
  const below = {
    id: "u",
    root: { id: "s2", dir: "col", children: [{ id: "e", path: "Welcome.md" }] },
    focus: "e",
  };
  below.root.children.push({ id: "f", path: "02 Projects/Home.md" });
  await seed(
    page,
    layout([beside({ path: "02 Projects/Home.md" }, { path: "Welcome.md" }), below]),
  );
  await load(page);
  await panes(page).nth(1).locator(".cm-line").first().click();
  await page.keyboard.press("Escape");
  const before = await paneText(page, 1);
  // The x lands once H is read, so the pane it cuts in shows where the focus stayed.
  await page.keyboard.press("H");
  await page.keyboard.press("x");
  await expect.poll(() => paneText(page, 1)).not.toBe(before);
  expect(await welcome(page)).toBe("right");
  const moves: string[] = [];
  for (const keys of ["H", "L", "tl", "J", "K"]) {
    await leader(page, keys);
    if (keys === "tl") {
      await panes(page).nth(0).locator(".cm-line").first().click();
      await page.keyboard.press("Escape");
    } else await expect.poll(() => welcome(page)).not.toBe(moves.at(-1) ?? "right");
    moves.push(await welcome(page));
  }
  expect(moves).toEqual(["left", "right", "top", "bottom", "top"]);
});

test("c, f and r wait for the next key, and ct then makes a tab and no note", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Quote");
  for (const [first, second, made] of [
    ["f", "f", "Find note"],
    ["r", "f", "Rename note"],
  ]) {
    await leader(page, first);
    await expect(pressed(page)).toHaveText(["Space", first]);
    await page.keyboard.press(second);
    await expect(dialog(page, made)).toBeVisible();
    await shut(page);
  }
  await leader(page, "c");
  await expect(pressed(page)).toHaveText(["Space", "c"]);
  expect(await page.getByRole("tab").count()).toBe(1);
  await page.keyboard.press("t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(dialog(page, "New note")).toHaveCount(0);
});

test("a digit and 0 go to that tab and the tenth, t waits, and th and tl walk the tabs", async ({
  page,
}) => {
  const notes = ["Welcome", "Long note", "01 Notes/Lecture", "01 Notes/Reading", "01 Notes/Quote"];
  notes.push("01 Notes/Seeds", "03 Flashcards/Capitals", "04 Books/Primer", "02 Projects/Home");
  notes.push("02 Projects/Garden");
  const tab = (path: string, i: number) => ({
    id: `t${i}`,
    root: { id: `p${i}`, path: `${path}.md` },
    focus: `p${i}`,
  });
  await seed(page, layout(notes.map(tab)));
  await load(page);
  await panes(page).nth(0).locator(".cm-line").first().click();
  await page.keyboard.press("Escape");
  const steps = [
    ["3", "Lecture"],
    ["0", "Garden"],
    ["t", "Garden"],
    ["h", "Home"],
    ["tl", "Garden"],
  ];
  for (const [keys, tab] of steps) {
    // h alone, as the second key of the t that waits for it.
    if (keys === "h") await page.keyboard.press(keys);
    else await leader(page, keys);
    if (keys === "t") await expect(pressed(page)).toHaveText(["Space", "t"]);
    else await expect(dialog(page, "Leader keys")).toHaveCount(0);
    await expect.poll(() => selectedTab(page)).toBe(tab);
    // The tab's editor takes the focus after the switch, and keys sent sooner are lost (#1615).
    if (keys !== "t") await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  }
});

test("cs opens a terminal and makes no tab or note, and cd the dump prompt and deletes no note", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await findNote(page, "Seeds");
  await leader(page, "cd");
  await expect(dialog(page, "Capture a thought")).toBeVisible();
  expect(await exists(join(stack.vault, "01 Notes/Seeds.md"))).toBe(true);
  await expect(page.getByRole("tab", { name: "Seeds" })).toHaveCount(1);
  await shut(page);
  await leader(page, "cs");
  await page.keyboard.type("notes");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm").first()).toBeVisible();
  expect(await page.getByRole("tab").count()).toBe(1);
  await expect(dialog(page, "New note")).toHaveCount(0);
});
