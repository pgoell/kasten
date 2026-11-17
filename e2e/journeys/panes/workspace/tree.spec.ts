import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { findNote, leader, openApp, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

// The note `02 Projects/Garden.md` and the folder `02 Projects/Garden/` share a name on purpose: the vault allows both.
const BEDS = "02 Projects/Garden/Beds.md";
const GARDEN = "02 Projects/Garden.md";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const panel = (page: Page) => page.locator("aside").filter({ has: tree(page) });
const row = (page: Page, name: string) => tree(page).getByRole("button", { name, exact: true });
const folder = (page: Page, name: string) => row(page, name).and(page.locator("[aria-expanded]"));
/** The list item a folder's row sits in, which holds its rows once it is unfolded. */
const inside = (page: Page, name: string) => folder(page, name).locator("xpath=..");
const grip = (page: Page) => page.getByRole("separator", { name: "Resize file tree" });
const width = (page: Page) => panel(page).evaluate((aside) => aside.getBoundingClientRect().width);
const newNote = (page: Page) =>
  page.getByRole("dialog", { name: "New note" }).getByRole("combobox");

/** Loads the app with the extra rows these journeys need. */
async function opened(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, {
    [BEDS]: "# Beds\n",
    "media/pic.png": PNG,
    "98 Archive/Gone.md": "# Gone\n",
  });
  await openApp(page);
}

/** Loads the app on the note the URL names, with vim in normal mode in its editor. */
async function loadOn(page: Page, path: string, tab: string): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  await expect(page.getByRole("tab", { name: tab, selected: true })).toBeVisible({
    timeout: 15_000,
  });
  await toEditor(page);
}

/** Puts the focus in the open note's editor in vim's normal mode, where the leader is heard. */
async function toEditor(page: Page): Promise<void> {
  await page.locator(".cm-content .cm-line:visible").last().click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** `l` unfolds 02 Projects and no other, and the focus is still on it after: a focus check alone can pass before a stray move lands. */
async function unfoldsProjects(page: Page): Promise<void> {
  await page.keyboard.press("l");
  await expect(row(page, "Home")).toBeVisible();
  await expect(row(page, "Lecture")).toHaveCount(0);
  await expect(folder(page, "02 Projects")).toBeFocused();
}

/** Clicks New note in the panel's header, reads the folder its prompt starts in, and shuts it. */
async function startsIn(page: Page): Promise<string> {
  await panel(page).getByRole("button", { name: "New note" }).click();
  const value = await newNote(page).inputValue();
  await page.keyboard.press("Escape");
  await expect(newNote(page)).toBeHidden();
  return value;
}

test("New note in the header starts in the cursor's folder, the folder of the cursor's note, or the root", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  expect(await startsIn(page)).toBe("01 Notes/");
  await toEditor(page);
  // By title: the folder `02 Projects/Garden/` reads the same as the note.
  await findNote(page, "Garden");
  await leader(page, "E");
  await expect(tree(page).getByTitle(GARDEN)).toBeFocused();
  expect(await startsIn(page)).toBe("02 Projects/");
  await toEditor(page);
  await leader(page, "e");
  await page.keyboard.press("G");
  await expect(row(page, "Welcome")).toBeFocused();
  expect(await startsIn(page)).toBe("");
});

test("each note nests under its folders, a click opens it over a folder of the same name, and only the open note is marked", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await folder(page, "01 Notes").click();
  await expect(inside(page, "01 Notes").getByRole("button", { name: "Lecture" })).toBeVisible();
  await expect(inside(page, "01 Notes").getByRole("button", { name: "Welcome" })).toHaveCount(0);
  await expect(row(page, "Welcome")).toBeVisible();
  await folder(page, "02 Projects").click();
  await expect(inside(page, "02 Projects").getByTitle(GARDEN)).toBeVisible();
  await folder(page, "Garden").click();
  await expect(inside(page, "Garden").getByTitle(BEDS)).toBeVisible();

  await row(page, "Beds").click();
  await expect(page.getByRole("tab", { name: "Beds", selected: true })).toBeVisible();
  await tree(page).getByTitle(GARDEN).click();
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(folder(page, "Garden")).toHaveAttribute("aria-expanded", "true");
  await expect(tree(page).locator('[aria-current="page"]')).toHaveAttribute("title", GARDEN);

  await toEditor(page);
  await leader(page, "q");
  await expect(page.getByRole("tab", { name: "Garden" })).toHaveCount(0);
  await expect(tree(page).locator('[aria-current="page"]')).toHaveCount(0);
});

test("a folder folds its rows away and back, and the panel folds away and back", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await folder(page, "01 Notes").click();
  await expect(row(page, "Lecture")).toBeVisible();
  await folder(page, "01 Notes").click();
  await expect(row(page, "Lecture")).toHaveCount(0);
  await expect(row(page, "Welcome")).toBeVisible();
  await folder(page, "01 Notes").click();
  await expect(row(page, "Lecture")).toBeVisible();

  await page.getByRole("button", { name: "Hide file tree" }).click();
  await expect(row(page, "Welcome")).toHaveCount(0);
  await page.getByRole("button", { name: "Show file tree" }).click();
  await expect(row(page, "Welcome")).toBeVisible();
});

test("an empty vault says No notes yet", async ({ page, stack }) => {
  for (const entry of await readdir(stack.vault)) {
    if (!entry.startsWith(".")) await rm(join(stack.vault, entry), { recursive: true });
  }
  await page.goto("/");
  await expect(tree(page).getByText("No notes yet")).toBeVisible({ timeout: 15_000 });
});

test("the grip drags the width between 160 and 480 px, stops on release, resets on a double click and steps by arrow keys", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  expect(await width(page)).toBe(256);
  const drag = async (by: number) => {
    const box = await grip(page).boundingBox();
    if (box === null) throw new Error("the grip is not drawn");
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(Math.max(x + by, 1), y, { steps: 4 });
    await page.mouse.up();
  };

  await drag(84);
  await expect.poll(() => width(page)).toBe(340);
  await drag(-40);
  await expect.poll(() => width(page)).toBe(300);
  // Let go, a move of the pointer moves nothing.
  await page.mouse.move(100, 300);
  expect(await width(page)).toBe(300);
  await drag(-1000);
  await expect.poll(() => width(page)).toBe(160);
  await drag(500);
  await expect.poll(() => width(page)).toBe(480);

  await grip(page).dblclick();
  await expect.poll(() => width(page)).toBe(256);
  await grip(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page)).toBe(272);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(256);
});

test("the tree opens folded, unfolding only the way to the note the URL names", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await expect(folder(page, "01 Notes")).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, "Lecture")).toHaveCount(0);
  await expect(row(page, "Welcome")).toBeVisible();

  await loadOn(page, BEDS, "Beds");
  await expect(row(page, "Beds")).toBeVisible();
  await expect(row(page, "Lecture")).toHaveCount(0);

  await loadOn(page, "Welcome.md", "Welcome");
  await expect(row(page, "Welcome")).toBeVisible();
  await expect(row(page, "Lecture")).toHaveCount(0);
  await expect(row(page, "Home")).toHaveCount(0);
});

test("E unfolds the way to the open note, puts the focus on its row and leaves an unfolded folder open", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await folder(page, "01 Notes").click();
  await expect(row(page, "Lecture")).toBeVisible();
  await findNote(page, "Beds");
  await expect(row(page, "Beds")).toHaveCount(0);
  await leader(page, "E");
  await expect(tree(page).getByTitle(BEDS)).toBeFocused();
  await expect(row(page, "Lecture")).toBeVisible();
});

test("E reveals an open image the way it reveals a note", async ({ page, stack }) => {
  await opened(page, stack.vault);
  await folder(page, "media").click();
  await row(page, "pic.png").click();
  await expect(page.getByRole("img", { name: "pic.png" })).toBeVisible();
  await folder(page, "media").click();
  await expect(row(page, "pic.png")).toHaveCount(0);
  await page.getByRole("img", { name: "pic.png" }).click();
  await leader(page, "E");
  await expect(row(page, "pic.png")).toBeFocused();
});

test("E leaves the cursor where it was with no note open, and with the open note filtered out of the tree", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await leader(page, "q");
  await expect(page.getByRole("tab", { name: "Welcome" })).toHaveCount(0);
  await leader(page, "e");
  await page.keyboard.press("j");
  await expect(folder(page, "02 Projects")).toBeFocused();
  await leader(page, "E");
  await unfoldsProjects(page);

  await loadOn(page, "98 Archive/Gone.md", "Gone");
  await leader(page, "e");
  await page.keyboard.press("j");
  await expect(folder(page, "02 Projects")).toBeFocused();
  await toEditor(page);
  await leader(page, "E");
  await unfoldsProjects(page);
});

test("the cursor starts on the first row on a nested note's URL, and after E stays where it was moved when a folder unfolds", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await loadOn(page, BEDS, "Beds");
  await leader(page, "e");
  await expect(folder(page, "01 Notes")).toBeFocused();
  await expect(row(page, "Beds")).toBeVisible();

  await toEditor(page);
  await leader(page, "E");
  await expect(tree(page).getByTitle(BEDS)).toBeFocused();
  await page.keyboard.type("gg");
  await expect(folder(page, "01 Notes")).toBeFocused();
  await page.keyboard.press("l");
  await expect(row(page, "Lecture")).toBeVisible();
  await expect(folder(page, "01 Notes")).toBeFocused();
});

test("a note opened by a click on its row while the tree holds the focus takes the focus into its editor", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Welcome");
  await leader(page, "E");
  await expect(row(page, "Welcome")).toBeFocused();
  await row(page, "Long note").click();
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await expect(row(page, "Long note")).not.toBeFocused();
});

test.describe("a reader while the vault moves under it", () => {
  const PRIMER = "04 Books/Primer.md";
  const reader = (page: Page) => page.locator("[data-book-pane]");
  const prompt = (page: Page, name: string) => page.getByRole("dialog", { name });

  /** Opens Primer with its book beside it; answers the notes whose book the browser read, in order. */
  async function reading(page: Page, vault: string): Promise<string[]> {
    const reads: string[] = [];
    page.on("response", (answer) => {
      const [, note] = answer.url().split("/api/books/");
      if (note) reads.push(decodeURIComponent(note));
    });
    await opened(page, vault);
    await findNote(page, "Primer");
    await leader(page, "gr");
    await expect(reader(page).getByText("13%", { exact: true })).toBeVisible();
    expect(reads).toEqual([PRIMER]);
    return reads;
  }

  /** Renames the row the tree cursor reaches after `j` pressed `steps` times from the top. */
  async function renameRow(page: Page, steps: number, name: string, kind: string, to: string) {
    await leader(page, "e");
    for (let step = 0; step < steps; step += 1) await page.keyboard.press("j");
    await expect(row(page, name)).toBeFocused();
    await page.keyboard.press("r");
    await prompt(page, kind).getByRole("combobox").fill(to);
    await page.keyboard.press("Enter");
    await expect(prompt(page, kind)).toHaveCount(0);
  }

  /** The reader is drawn on its first page and shows no alert. */
  async function stillReads(page: Page) {
    await expect(reader(page).getByText("13%", { exact: true })).toBeVisible();
    await expect(reader(page).getByRole("alert")).toHaveCount(0);
  }

  test("E in the reader focuses the tree row of the note it reads", async ({ page, stack }) => {
    await reading(page, stack.vault);
    // Its folder is still folded, so E has to unfold the way as well.
    await expect(tree(page).getByTitle(PRIMER)).toHaveCount(0);
    // The keys are in the reader: l turns its page.
    await page.keyboard.press("l");
    await expect(reader(page).getByText("25%", { exact: true })).toBeVisible();
    await leader(page, "E");
    await expect(tree(page).getByTitle(PRIMER)).toBeFocused();
  });

  test("renaming the reader's folder carries the reader and its book to the new path", async ({
    page,
    stack,
  }) => {
    const reads = await reading(page, stack.vault);
    await renameRow(page, 3, "04 Books", "Rename folder", "Books");
    await expect.poll(() => reads).toEqual([PRIMER, "Books/Primer.md"]);
    await stillReads(page);
    expect((await readdir(join(stack.vault, "Books"))).sort()).toEqual(["Primer.md", "Primer.pdf"]);
  });

  test("renaming another folder leaves the reader as it was and reads its book no second time", async ({
    page,
    stack,
  }) => {
    const reads = await reading(page, stack.vault);
    await renameRow(page, 2, "03 Flashcards", "Rename folder", "Cards");
    await expect(folder(page, "Cards")).toBeVisible();
    await stillReads(page);
    expect(reads).toEqual([PRIMER]);
  });

  test("renaming the reader's note carries the reader and its book to the new path", async ({
    page,
    stack,
  }) => {
    const reads = await reading(page, stack.vault);
    // Back to the note's own pane: rf renames the focused pane's note.
    await leader(page, "o");
    await leader(page, "rf");
    await prompt(page, "Rename note").getByRole("combobox").fill("04 Books/Basics.md");
    await page.keyboard.press("Enter");
    await expect.poll(() => reads).toEqual([PRIMER, "04 Books/Basics.md"]);
    await stillReads(page);
    expect((await readdir(join(stack.vault, "04 Books"))).sort()).toEqual([
      "Basics.md",
      "Basics.pdf",
    ]);
  });

  test("renaming another note leaves the reader as it was and reads its book no second time", async ({
    page,
    stack,
  }) => {
    const reads = await reading(page, stack.vault);
    await leader(page, "e");
    await page.keyboard.press("G");
    await expect(row(page, "Welcome")).toBeFocused();
    await page.keyboard.press("r");
    await prompt(page, "Rename note").getByRole("combobox").fill("Hello.md");
    await page.keyboard.press("Enter");
    await expect(row(page, "Hello")).toBeVisible();
    await stillReads(page);
    expect(reads).toEqual([PRIMER]);
  });
});

test("Space a puts the archive mark on the status bar and the archived todos in Space f t", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "01 Notes/Chores.md": "- [ ] live chore\n",
    "98 Archive/Old.md": "- [ ] filed chore\n",
  });
  await openApp(page);
  const todos = page.getByRole("dialog", { name: "Todos" });
  await leader(page, "ft");
  await expect(todos.getByRole("option", { name: /live chore/ })).toBeVisible({ timeout: 15_000 });
  await expect(todos.getByRole("option", { name: /filed chore/ })).toHaveCount(0);
  await expect(page.getByTestId("archive-shown")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(todos).toHaveCount(0);

  await leader(page, "a");
  await expect(page.getByTestId("archive-shown")).toBeVisible();
  await leader(page, "ft");
  await expect(todos.getByRole("option", { name: /filed chore/ })).toBeVisible();
  await expect(todos.getByRole("option", { name: /live chore/ })).toBeVisible();
});
