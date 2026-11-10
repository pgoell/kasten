import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp, openFromTree } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";
import {
  after,
  bothTexts,
  conflictBar,
  conflicted,
  focused,
  OUTSIDE,
  openNote,
  settled,
  stillHeld,
  typed,
  welcome,
} from "./conflicted.ts";

const NEWEST = "The newest note.\n";

/** Welcome left standing conflicted and reopened by a reload, the pane restored on the kept text. */
async function reopened(page: Page, vault: string, vim = true) {
  const conflict = await conflicted(page, vault, undefined, vim);
  await page.reload();
  await expect
    .poll(() => after(page, vault, conflict.puts), { timeout: 15_000 })
    .toEqual([
      { status: "Changed on disk", diff: bothTexts("Somebody else wrote this."), listed: null },
      OUTSIDE,
      1,
      1,
      true,
    ]);
  await page.locator(".cm-content").click();
  await expect(focused(page)).toHaveCount(1);
  return conflict;
}

/** Leaves the app for a blank page, has `text` written to Welcome meanwhile, and comes back. */
async function awayWhile(page: Page, vault: string, text: string) {
  await page.goto("about:blank");
  await writeFile(join(vault, "Welcome.md"), text);
  await openApp(page);
}

async function ex(page: Page, command: string) {
  await page.keyboard.press("Escape");
  await page.keyboard.type(`:${command}`);
  await page.keyboard.press("Enter");
}

test.describe("a conflicted note reopened after a reload", () => {
  test(":w writes the kept text and settles the conflict", async ({ page, stack }) => {
    const { mine, puts } = await reopened(page, stack.vault);
    await ex(page, "w");
    await expect.poll(() => after(page, stack.vault, puts)).toEqual([settled, mine, 2, 1, false]);
  });

  test(":e! takes the vault's text and writes nothing", async ({ page, stack }) => {
    const { puts } = await reopened(page, stack.vault);
    await ex(page, "e!");
    await expect
      .poll(async () => [
        ...(await after(page, stack.vault, puts)),
        await page.locator(".cm-content").textContent(),
      ])
      .toEqual([settled, OUTSIDE, 1, 0, false, OUTSIDE.trim()]);
  });

  test("an edit toward the vault's text shows in the diff, and :w writes the merge", async ({
    page,
    stack,
  }) => {
    const { mine, puts } = await reopened(page, stack.vault);
    await page.keyboard.press("Escape");
    await page.keyboard.type("Gdd");
    await expect
      .poll(async () => (await conflictBar(page)).diff)
      .toEqual(expect.not.stringContaining("typed here"));
    await ex(page, "w");
    const merge = mine.replace(/\ntyped here$/, "");
    await expect.poll(() => after(page, stack.vault, puts)).toEqual([settled, merge, 2, 0, false]);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("the bar's Write my text writes the kept text", async ({ page, stack }) => {
      const { mine, puts } = await reopened(page, stack.vault, false);
      await expect(page.locator(".cm-vimMode")).toHaveCount(0);
      await page.getByRole("button", { name: "Write my text" }).click();
      await expect.poll(() => after(page, stack.vault, puts)).toEqual([settled, mine, 2, 1, false]);
    });

    test("the bar's Take the vault's takes the vault's text and writes nothing", async ({
      page,
      stack,
    }) => {
      const { puts } = await reopened(page, stack.vault, false);
      await expect(page.locator(".cm-vimMode")).toHaveCount(0);
      await page.getByRole("button", { name: "Take the vault's" }).click();
      await expect
        .poll(() => after(page, stack.vault, puts))
        .toEqual([settled, OUTSIDE, 1, 0, false]);
    });
  });
});

test.describe("a conflicted note left and reopened", () => {
  test("shows the conflict against the newest vault text when it was written again meanwhile", async ({
    page,
    stack,
  }) => {
    const { puts } = await conflicted(page, stack.vault);
    await awayWhile(page, stack.vault, NEWEST);
    await expect
      .poll(() => after(page, stack.vault, puts), { timeout: 15_000 })
      .toEqual([
        { status: "Changed on disk", diff: bothTexts("The newest note."), listed: null },
        NEWEST,
        1,
        1,
        true,
      ]);
  });

  test("clears the conflict when the vault came to hold the kept text meanwhile", async ({
    page,
    stack,
  }) => {
    const { mine, puts } = await conflicted(page, stack.vault);
    await awayWhile(page, stack.vault, mine);
    await expect
      .poll(() => after(page, stack.vault, puts), { timeout: 15_000 })
      .toEqual([settled, mine, 1, 1, false]);
  });
});

test.describe("held text of Welcome when the file moves", () => {
  test("a conflicted note's kept text, held and on screen nowhere, follows a rename in the tree", async ({
    page,
    stack,
  }) => {
    const kept = `${await welcome(stack.vault)}\ntyped here`;
    // Held and on screen nowhere, as a page that left the note conflicted keeps it: a pane restored
    // on it would stand conflicted and refuse the rename.
    await page.addInitScript(
      (held) => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("kasten.held.2", JSON.stringify(held));
      },
      { "Welcome.md": [{ content: kept, reason: "Changed on disk", conflicted: true }] },
    );
    await openApp(page);
    await expect
      .poll(async () => (await conflictBar(page)).listed)
      .toBe("Changed on disk: Welcome");
    // The tree's r renames the row its cursor is on, and the focus follows the cursor.
    const row = page.getByRole("button", { name: "Welcome", exact: true });
    await leader(page, "e");
    await expect(page.getByRole("navigation", { name: "Vault" }).locator(":focus")).toHaveCount(1);
    for (let i = 0; i < 40 && !(await row.evaluate((node) => node === document.activeElement)); i++)
      await page.keyboard.press("j");
    await expect(row).toBeFocused();
    await page.keyboard.press("r");
    const prompt = page.getByRole("dialog", { name: "Rename note" });
    await prompt.getByRole("combobox").fill("Moved");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => [
        (await conflictBar(page)).listed,
        await noteText(stack.vault, "Moved.md"),
        await stillHeld(page),
      ])
      .toEqual(["Changed on disk: Moved", expect.stringContaining("front door"), false]);
    const moved = await noteText(stack.vault, "Moved.md");
    await openFromTree(page, "Moved");
    await expect
      .poll(async () => [
        (await conflictBar(page)).status,
        await typed(page).count(),
        await noteText(stack.vault, "Moved.md"),
      ])
      .toEqual(["Changed on disk", 1, moved]);
  });

  test("held text that failed to save stays listed through an outside move, and comes back when the path is written again", async ({
    page,
    stack,
  }) => {
    let puts = 0;
    await page.route(
      (url) => decodeURIComponent(url.pathname) === "/api/files/Welcome.md",
      (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        puts += 1;
        return route.fulfill({ status: 500, json: { detail: "refused by the test" } });
      },
    );
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await page.keyboard.press("Escape");
    await leader(page, "ct");
    const held = page.getByTestId("held");
    await expect.poll(() => held.textContent()).toBe("Not saved: Welcome");
    // An agent's move: a remove of the old path and a write of the new, nothing linking the two.
    await rename(join(stack.vault, "Welcome.md"), join(stack.vault, "Away.md"));
    await expect(page.getByRole("button", { name: "Away", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => held.textContent()).toBe("Not saved: Welcome");
    await writeFile(join(stack.vault, "Welcome.md"), NEWEST);
    await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const before = puts;
    await openFromTree(page, "Welcome");
    await expect
      .poll(async () => [await typed(page).count(), await welcome(stack.vault), puts])
      .toEqual([1, NEWEST, before]);
  });
});
