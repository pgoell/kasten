import { readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const BORGES = "# Borges\n\nborn 1899\n";
const HOME = "# Home\n\nsee [[inbox/borges]]\n";

/** Writes a note under inbox, a folder for it to land in and a note naming it by path, then loads the app. */
async function loadTree(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, {
    "inbox/borges.md": BORGES,
    "reading/kafka.md": "# Kafka\n",
    "home.md": HOME,
  });
  await openApp(page);
}

const row = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Drags the tree row `from` onto the folder row `onto` with the mouse, as a hand would. */
async function drag(page: Page, from: string, onto: string): Promise<void> {
  const start = await row(page, from).boundingBox();
  const end = await row(page, onto).boundingBox();
  if (!start || !end) throw new Error("a row to drag is not on the screen");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
}

/** Opens the inbox folder and drags borges onto reading, which asks before it moves. */
async function dragBorges(page: Page) {
  await row(page, "inbox").click();
  await drag(page, "borges", "reading");
  const dialog = page.getByRole("dialog", { name: "Move note" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Counts each PATCH that would move a note or a folder. */
function countMoves(page: Page): () => number {
  let moves = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH") moves += 1;
  });
  return () => moves;
}

test.describe("moving a row of the file tree by a drag", () => {
  test("a note dropped on a folder lists the files whose links it rewrites, and Enter moves it", async ({
    page,
    stack,
  }) => {
    await loadTree(page, stack.vault);
    const dialog = await dragBorges(page);
    await expect(dialog.getByRole("status")).toHaveText("updates links in 1 file, Enter moves");
    await expect(dialog.getByRole("list", { name: "Files to update" })).toHaveText("home.md");

    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(() => readdir(join(stack.vault, "reading"))).toContain("borges.md");
    expect(await readdir(join(stack.vault, "inbox")).catch(() => [])).not.toContain("borges.md");
    expect(await noteText(stack.vault, "home.md")).toContain("[[reading/borges]]");
  });

  test("a folder dropped on a folder moves with its notes on the Move button", async ({
    page,
    stack,
  }) => {
    await loadTree(page, stack.vault);
    await drag(page, "inbox", "reading");
    const dialog = page.getByRole("dialog", { name: "Move folder" });
    await expect(dialog).toContainText("inbox → reading/inbox");
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => readdir(join(stack.vault, "reading/inbox")).catch(() => []))
      .toEqual(["borges.md"]);
  });

  test("Escape shuts the dialog and moves nothing", async ({ page, stack }) => {
    const moves = countMoves(page);
    await loadTree(page, stack.vault);
    const dialog = await dragBorges(page);
    await expect(dialog.getByRole("status")).toContainText("Enter moves");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(moves()).toBe(0);
    expect(await readdir(join(stack.vault, "inbox"))).toEqual(["borges.md"]);
    expect(await noteText(stack.vault, "home.md")).toBe(HOME);
  });

  test("a move the vault refuses says so and leaves the note where it was", async ({
    page,
    stack,
  }) => {
    let refused = 0;
    // Only the move is refused: the count before it is asked of the real vault.
    await page.route(
      (url) => decodeURIComponent(url.pathname) === "/api/files/inbox/borges.md",
      (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        refused += 1;
        return route.fulfill({ status: 409, json: { detail: "taken" } });
      },
    );
    await loadTree(page, stack.vault);
    const dialog = await dragBorges(page);
    await expect(dialog.getByRole("status")).toContainText("Enter moves");

    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText("could not move it, Esc closes");
    expect(refused).toBe(1);
    expect(await readdir(join(stack.vault, "inbox"))).toEqual(["borges.md"]);
    expect(await noteText(stack.vault, "home.md")).toBe(HOME);
  });
});

test.describe("the new note prompt's folder highlight", () => {
  const LAST = "99 Misc/01 Config/01 Agents/";
  const SEEDED = [
    "01 Notes/",
    "02 Projects/",
    "03 Flashcards/",
    "04 Books/",
    "99 Misc/",
    "99 Misc/01 Config/",
    LAST,
  ];

  /** Opens the new note prompt over the vault as it stands. */
  async function prompt(page: Page) {
    await leader(page, "cf");
    const dialog = page.getByRole("dialog", { name: "New note" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return {
      field: dialog.getByRole("combobox"),
      rows: dialog.getByRole("option"),
      highlighted: dialog.getByRole("option", { selected: true }),
    };
  }

  /** Keeps whether each keydown reached the page with its default action stopped; call before the keys. */
  async function stops(page: Page): Promise<() => Promise<boolean[]>> {
    await page.evaluate(() => {
      const kept: boolean[] = [];
      Object.assign(window, { stops: kept });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Control") kept.push(event.defaultPrevented);
      });
    });
    return () => page.evaluate(() => (window as unknown as { stops: boolean[] }).stops);
  }

  test("moves on the arrows and on ctrl+n and ctrl+p, and stops at both ends", async ({ page }) => {
    await openApp(page);
    const { rows, highlighted } = await prompt(page);
    await expect(rows).toHaveText(SEEDED);
    await expect(highlighted).toHaveText("01 Notes/");

    await page.keyboard.press("ArrowUp");
    await expect(highlighted).toHaveText("01 Notes/");
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).toHaveText("02 Projects/");
    await page.keyboard.press("ArrowUp");
    await expect(highlighted).toHaveText("01 Notes/");
    await page.keyboard.press("Control+n");
    await expect(highlighted).toHaveText("02 Projects/");
    await page.keyboard.press("Control+p");
    await expect(highlighted).toHaveText("01 Notes/");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
    await expect(highlighted).toHaveText(LAST);
  });

  test("the arrows leave the caret where it was", async ({ page }) => {
    await openApp(page);
    const { field, rows, highlighted } = await prompt(page);
    await page.keyboard.type("o");
    await page.keyboard.press("ArrowLeft");
    // Left to the input, ArrowDown would take the caret to the end, and ArrowUp to the start.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("0");
    await expect(field).toHaveValue("0o");
    await expect(rows.first()).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("1");
    await expect(field).toHaveValue("01o");
    await expect(highlighted).toHaveText("01 Notes/");
  });

  test("leaves the arrows and ctrl+p to the input when no folder row is shown (#968)", async ({
    page,
  }) => {
    await openApp(page);
    const { field, rows } = await prompt(page);
    await page.keyboard.type("zzz");
    await expect(rows).toHaveCount(0);
    const stopped = await stops(page);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("q");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("w");
    await expect(field).toHaveValue("qzzzw");
    await page.keyboard.press("Control+p");
    // ArrowUp, q, ArrowDown, w, ctrl+p: none stopped.
    expect(await stopped()).toEqual([false, false, false, false, false]);
  });

  test("stays on a row when a fresh listing shortens the rows under it", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "zz-a/one.md": "one\n", "zz-b/two.md": "two\n" });
    await openApp(page);
    const { rows, highlighted } = await prompt(page);
    await expect(rows).toHaveText([...SEEDED, "zz-a/", "zz-b/"]);
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
    await expect(highlighted).toHaveText("zz-b/");

    await rm(join(stack.vault, "zz-a"), { recursive: true });
    await rm(join(stack.vault, "zz-b"), { recursive: true });
    await expect(rows).toHaveText(SEEDED, { timeout: 15_000 });
    await expect(highlighted).toHaveText(LAST);
  });

  test("stays where it is when a fresh listing lengthens the rows", async ({ page, stack }) => {
    await openApp(page);
    const { rows, highlighted } = await prompt(page);
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
    await expect(highlighted).toHaveText(LAST);

    await vaultWith(stack.vault, { "zz-new/three.md": "three\n" });
    await expect(rows).toHaveText([...SEEDED, "zz-new/"], { timeout: 15_000 });
    // The new row is one the highlight never walked to.
    await expect(highlighted).toHaveText(LAST);
  });
});

test.describe("the new note prompt", () => {
  const dialog = (page: Page) => page.getByRole("dialog", { name: "New note" });
  const field = (page: Page) => dialog(page).getByRole("combobox");
  const hint = (page: Page) => dialog(page).getByRole("status");
  const tab = (page: Page, name: string) => page.getByRole("tab", { name, selected: true });
  const focused = (page: Page, selector: string) =>
    page.evaluate((within) => document.activeElement?.closest(within) !== null, selector);

  /** Counts each create of `name`, refuses the first `refuse` with a 500, and holds the rest until `release`. */
  async function creates(page: Page, name: string, { refuse = 0, held = false } = {}) {
    let count = 0;
    let release = () => {};
    const gate = held ? new Promise<void>((done) => (release = done)) : Promise.resolve();
    await page.route(
      (url) => decodeURIComponent(url.pathname).endsWith(`/${name}.md`),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        count += 1;
        if (count <= refuse) return route.fulfill({ status: 500, body: "{}" });
        await gate;
        await route.fallback();
      },
    );
    return { count: () => count, release };
  }

  /** Opens the prompt from the top bar, whose button stays on screen when a note opens. */
  async function fromBar(page: Page) {
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    await expect(field(page)).toBeFocused({ timeout: 15_000 });
  }

  test("opens on the tree's folder with the caret in its input, and Escape hands the focus back", async ({
    page,
  }) => {
    await openApp(page);
    await leader(page, "cf");
    await expect(field(page)).toBeFocused({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);

    await row(page, "01 Notes").click();
    await leader(page, "cf");
    await expect(field(page)).toHaveValue("01 Notes/");
    await expect(field(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(await focused(page, 'nav[aria-label="Vault"]')).toBe(true);
  });

  test("closes on Escape while the mouse holds the focus on a row", async ({ page }) => {
    await openApp(page);
    await fromBar(page);
    const folder = dialog(page).getByRole("option").first();
    await folder.hover();
    await page.mouse.down();
    expect(await focused(page, '[role="option"]')).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await page.mouse.up();
  });

  for (const vim of ["on", "off"]) {
    test(`a made note and one already there each open with the keys in their editor, vim ${vim}`, async ({
      page,
      stack,
    }) => {
      await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
      const welcome = await creates(page, "Welcome");
      await openApp(page);
      for (const [name, typed] of [
        ["Fresh", "fresh line"],
        ["Welcome", "kept line"],
      ]) {
        await fromBar(page);
        await page.keyboard.type(name);
        if (name === "Welcome")
          await expect(hint(page)).toHaveText("already exists, Enter opens it");
        await page.keyboard.press("Enter");
        await expect(tab(page, name)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".cm-content:focus")).toHaveCount(1);
        await page.keyboard.type(vim === "on" ? `i${typed}` : typed);
        await page.keyboard.press("Escape");
        await expect
          .poll(() => noteText(stack.vault, `${name}.md`), { timeout: 15_000 })
          .toContain(typed);
      }
      expect(welcome.count()).toBe(0);
    });
  }

  test("a refused create keeps the path and says so, the hints follow the input, and Enter tries again", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "zz-proj/kasten/a.md": "a\n" });
    const made = await creates(page, "zz-proj/k", { refuse: 1 });
    await openApp(page);
    await fromBar(page);
    await page.keyboard.type("zz-proj/k");
    await page.keyboard.press("Enter");
    await expect(hint(page)).toHaveText("could not create the note");
    await expect(field(page)).toHaveValue("zz-proj/k");
    await expect(page.getByRole("tab", { name: "k" })).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await expect(hint(page)).toHaveText("");
    await page.keyboard.press("Tab");
    await expect(field(page)).toHaveValue("zz-proj/kasten/");
    await expect(hint(page)).toHaveText("name the note");
    await page.keyboard.press("Enter");
    await field(page).fill("reading/borges");
    await expect(hint(page)).toHaveText("creates folder reading/");
    expect(made.count()).toBe(1);

    await field(page).fill("zz-proj/k");
    await page.keyboard.press("Enter");
    await expect(tab(page, "k")).toBeVisible({ timeout: 15_000 });
    expect(made.count()).toBe(2);
    await expect.poll(() => noteText(stack.vault, "zz-proj/k.md")).not.toBe("");
  });

  test("Enter pressed three times while the create is in flight makes one note", async ({
    page,
    stack,
  }) => {
    const made = await creates(page, "Once", { held: true });
    await openApp(page);
    await fromBar(page);
    await page.keyboard.type("Once");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
    await expect.poll(made.count).toBe(1);
    made.release();
    await expect(tab(page, "Once")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => noteText(stack.vault, "Once.md")).not.toBe("");
    expect(made.count()).toBe(1);
  });

  test("opens the vault's spelling of the path, listed in the tree at once and shown before any read", async ({
    page,
    stack,
  }) => {
    // A folder linked to another: the vault answers the path through the link's target.
    await symlink("01 Notes", join(stack.vault, "Alias"));
    // No events, so only the prompt itself can bring the tree a fresh listing.
    await page.route("**/api/events", (route) => route.abort());
    await page.route(
      (url) => decodeURIComponent(url.pathname) === "/api/files/01 Notes/Canon.md",
      (route) => (route.request().method() === "GET" ? new Promise(() => {}) : route.fallback()),
    );
    await openApp(page);
    await fromBar(page);
    await page.keyboard.type("Alias/Canon");
    await page.keyboard.press("Enter");
    await expect(tab(page, "Canon")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await expect(page.locator("[data-pane]").getByText("01 Notes", { exact: true })).toBeVisible();
    await row(page, "01 Notes").click();
    await expect(row(page, "Canon")).toBeVisible();
    await expect.poll(() => noteText(stack.vault, "01 Notes/Canon.md")).not.toBe("");
  });
});
