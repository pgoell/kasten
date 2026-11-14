import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { noteText, openApp, openNote, phone, unstamped } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";
import { conflicted, OUTSIDE, sign, welcome } from "../panes/conflict/conflicted.ts";

const WELCOME = "/api/files/Welcome.md";
const detail = (page: Page) => page.getByTestId("status-detail");
const clocks = (page: Page) => page.locator("footer time").count();

/** Answers each PUT of Welcome by `answer`, and counts them. */
async function welcomePuts(page: Page, answer: (route: Route) => Promise<void>) {
  const puts = { count: 0 };
  await page.route(
    (url) => decodeURIComponent(url.pathname) === WELCOME,
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      puts.count += 1;
      await answer(route);
    },
  );
  return puts;
}

/** Holds each PUT of Welcome until `release` runs. */
async function heldPuts(page: Page) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const puts = await welcomePuts(page, async (route) => {
    await gate;
    await route.fallback();
  });
  return { puts, release };
}

/** Fails each PUT of Welcome while `failing.on` holds. */
async function failingPuts(page: Page) {
  const failing = { on: true };
  await welcomePuts(page, (route) =>
    failing.on ? route.fulfill({ status: 507 }) : route.fallback(),
  );
  return failing;
}

/** The save sign as a reader meets it, read in one look; null while no sign is drawn. */
function reading(page: Page) {
  return page.evaluate(() => {
    const at = document.querySelector<HTMLElement>('[data-testid="save-status"]');
    if (at === null) return null;
    const spinner = at.querySelector('[data-testid="save-spinner"]');
    const probe = document.createElement("span");
    probe.style.color = "var(--color-k-ink)";
    document.body.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const colour = spinner && getComputedStyle(spinner).color;
    return {
      label: at.getAttribute("aria-label"),
      beside: at.innerText.trim(),
      mark: spinner ? "ring" : at.querySelector('[data-testid="save-error"]') ? "warning" : null,
      inInk: spinner ? colour === ink && colour !== "rgb(255, 255, 255)" : null,
      spins: spinner ? spinner.getAnimations().length > 0 : null,
      title: at.getAttribute("title"),
    };
  });
}

/** Types a line at the end of the focused note, vim on (`Go`) or off. */
async function typeLine(page: Page, line: string, vim: boolean) {
  if (vim) {
    await page.keyboard.type(`Go${line}`);
    await page.keyboard.press("Escape");
  } else {
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n${line}`);
  }
}

test.describe("the save sign", () => {
  test("reads Unsaved changes before an edit goes out, then Saving, a ring spinning in ink with nothing beside it", async ({
    page,
  }) => {
    const { puts, release } = await heldPuts(page);
    await openApp(page);
    await openNote(page, "Welcome");
    // A paused clock holds the quiet write back, so the edit waits unsent.
    await page.clock.pauseAt(Date.now() + 1_000);
    await typeLine(page, "typed here", true);
    await expect.poll(async () => (await reading(page))?.label).toBe("Unsaved changes");
    expect(puts.count).toBe(0);

    await page.clock.resume();
    await expect.poll(() => puts.count).toBeGreaterThan(0);
    expect(await reading(page)).toMatchObject({
      label: "Saving",
      beside: "",
      mark: "ring",
      inInk: true,
      spins: true,
    });
    release();
    await expect.poll(async () => (await reading(page))?.label).toBe("Saved");
  });

  test("wears the warning with its words beside it on a note changed on disk, and its hover names both ways out", async ({
    page,
    stack,
  }) => {
    await conflicted(page, stack.vault);
    expect(await reading(page)).toMatchObject({
      label: "Changed on disk",
      beside: "Changed on disk",
      mark: "warning",
      title: expect.stringContaining(":w keeps your text, :e! takes the vault's"),
    });
  });

  test("names what the vault answered a failed write, and :w, on hover", async ({ page }) => {
    await failingPuts(page);
    await openApp(page);
    await openNote(page, "Welcome");
    await typeLine(page, "typed here", true);
    await expect
      .poll(async () => (await reading(page))?.label, { timeout: 15_000 })
      .toBe("Could not save");
    expect(await reading(page)).toMatchObject({
      beside: "Could not save",
      mark: "warning",
      title: expect.stringMatching(
        /PUT \/api\/files\/Welcome\.md failed with 507\n.*:w or ctrl\+s writes it again/,
      ),
    });
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  /** Loads the app and opens Welcome from the tree by taps, its editor focused. */
  async function welcomeByTap(page: Page) {
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Commands" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "File tree", exact: true }).tap();
    await page
      .getByRole("navigation", { name: "Vault" })
      .getByRole("button", { name: "Welcome", exact: true })
      .tap();
    await focusWelcome(page);
  }

  async function focusWelcome(page: Page) {
    const editor = page.locator(".cm-content", { hasText: "front door" });
    await editor.tap();
    await expect(editor).toBeFocused();
  }

  /** Welcome typed into by tap, its write held while somebody else writes the file. */
  async function conflictByTap(page: Page, vault: string) {
    const { puts, release } = await heldPuts(page);
    await welcomeByTap(page);
    await typeLine(page, "typed here", false);
    await expect.poll(() => puts.count).toBeGreaterThan(0);
    await writeFile(join(vault, "Welcome.md"), OUTSIDE);
    release();
    await expect
      .poll(() => sign(page).getAttribute("aria-label"), { timeout: 15_000 })
      .toBe("Changed on disk");
    return puts;
  }

  test("a conflict opens its panel without the clock, a tap on the sign shuts and opens it, and Take the vault's by tap writes nothing", async ({
    page,
    stack,
  }) => {
    const puts = await conflictByTap(page, stack.vault);
    await expect(detail(page)).toBeVisible();
    expect(await clocks(page)).toBe(0);
    await sign(page).tap();
    await expect(detail(page)).toHaveCount(0);
    await sign(page).tap();
    await expect(detail(page)).toBeVisible();

    await page.getByRole("button", { name: "Take the vault's" }).tap();
    await expect
      .poll(async () => [
        (await reading(page))?.label ?? null,
        await welcome(stack.vault),
        puts.count,
        await page.locator(".cm-content", { hasText: "typed here" }).count(),
      ])
      .toEqual([null, OUTSIDE, 1, 0]);
  });

  test("Write my text by tap writes the kept text over a conflict and shuts the panel", async ({
    page,
    stack,
  }) => {
    await conflictByTap(page, stack.vault);
    await page.getByRole("button", { name: "Write my text" }).tap();
    await expect
      .poll(
        async () => [
          (await reading(page))?.label ?? null,
          unstamped(await welcome(stack.vault)).includes("typed here"),
          await detail(page).count(),
        ],
        { timeout: 15_000 },
      )
      .toEqual([null, true, 0]);
  });

  test("a failed write opens by a tap to its way out, without the clock, and Write my text and Drop my text each work by tap", async ({
    page,
    stack,
  }) => {
    const failing = await failingPuts(page);
    await welcomeByTap(page);
    await typeLine(page, "The first line.", false);
    await expect.poll(() => sign(page).getAttribute("aria-label")).toBe("Could not save");
    expect(await clocks(page)).toBe(0);
    await sign(page).tap();
    await expect(detail(page)).toContainText(":e! drops it for the vault's.");
    await expect(page.getByRole("button", { name: "Take the vault's" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Drop my text" })).toBeVisible();

    failing.on = false;
    await page.getByRole("button", { name: "Write my text" }).tap();
    await expect
      .poll(async () => [
        (await reading(page))?.label ?? null,
        (await noteText(stack.vault, "Welcome.md")).includes("The first line."),
      ])
      .toEqual([null, true]);

    failing.on = true;
    await focusWelcome(page);
    await typeLine(page, "The second line.", false);
    await expect.poll(() => sign(page).getAttribute("aria-label")).toBe("Could not save");
    await sign(page).tap();
    await page.getByRole("button", { name: "Drop my text" }).tap();
    await expect
      .poll(async () => [
        (await reading(page))?.label ?? null,
        await page.locator(".cm-content", { hasText: "The second line." }).count(),
        (await noteText(stack.vault, "Welcome.md")).includes("The second line."),
      ])
      .toEqual([null, 0, false]);
  });

  test("the bar draws nothing while a write is on its way", async ({ page }) => {
    const { puts, release } = await heldPuts(page);
    await welcomeByTap(page);
    await typeLine(page, "typed here", false);
    await expect.poll(() => puts.count).toBeGreaterThan(0);
    expect(await page.locator("footer").count()).toBe(0);
    release();
  });

  /** Opens the palette by its toolbar button and taps the command whose name starts with `name`. */
  async function command(page: Page, name: string) {
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: new RegExp(`^${name}`) }).tap();
  }

  test("the bar comes back without the clock for a notice", async ({ page }) => {
    await welcomeByTap(page);
    await command(page, "Log alcohol");
    await expect(page.getByTestId("notice")).toHaveText("Logged 🍺 1 into today's note", {
      timeout: 15_000,
    });
    expect(await clocks(page)).toBe(0);
  });

  test("the bar comes back without the clock for the archive", async ({ page }) => {
    await welcomeByTap(page);
    await command(page, "Show the archive in searches");
    await expect(page.getByTestId("archive-shown")).toBeVisible();
    expect(await clocks(page)).toBe(0);
  });

  test("the bar comes back without the clock for a note whose text the vault refused", async ({
    page,
  }) => {
    // Held by a page before this one; a phone opens on today's note, so Welcome is not in the buffer.
    await page.addInitScript(() => {
      const entry = { content: "typed here\n", reason: "PUT failed with 507" };
      localStorage.setItem("kasten.held.2", JSON.stringify({ "Welcome.md": [entry] }));
    });
    await page.goto("/");
    await expect(page.getByTestId("held")).toHaveText("Not saved: Welcome", { timeout: 15_000 });
    expect(await clocks(page)).toBe(0);
  });
});
