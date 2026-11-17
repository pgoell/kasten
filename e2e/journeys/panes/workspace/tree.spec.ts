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

/** `l` on the cursor row unfolds 02 Projects and no other, which a focus check alone could pass on before a stray move lands. */
async function unfoldsProjects(page: Page): Promise<void> {
  await expect(folder(page, "02 Projects")).toBeFocused();
  await page.keyboard.press("l");
  await expect(row(page, "Home")).toBeVisible();
  await expect(row(page, "Lecture")).toHaveCount(0);
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
