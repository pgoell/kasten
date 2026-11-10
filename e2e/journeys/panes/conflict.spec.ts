import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { leader, openApp, openFromTree } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";
import {
  after,
  bothTexts,
  conflictBar,
  conflicted,
  OUTSIDE,
  openNote,
  panes,
  settled,
  sign,
  stillHeld,
  typed,
  welcome,
} from "./conflicted.ts";

const THIRD = "A third writer's note.\n";

test.describe("a note changed on disk under text nobody saved", () => {
  /** The sign, the file on disk, whether the buffer still holds the typing, and the tab and pane counts. */
  const state = async (page: Page, vault: string) => [
    await sign(page).getAttribute("aria-label"),
    await welcome(vault),
    await typed(page).count(),
    await page.getByRole("tab").count(),
    await panes(page).count(),
  ];
  const flashing = async (page: Page) =>
    (await sign(page).getAttribute("class"))?.includes("animate-flash");

  /**
   * Runs `press` once the last flash is over, then waits for the flash only a refusal plays, so the
   * state read after it is this press's, not the one before's.
   */
  async function refused(page: Page, vault: string, press: () => Promise<void>, at: unknown[]) {
    await expect.poll(() => flashing(page)).toBe(false);
    await press();
    await expect
      .poll(async () => [...(await state(page, vault)), await flashing(page)])
      .toEqual([...at, true]);
  }

  test("the refused write keeps the typing and reads no note over it, and q and the tree are refused and write nothing", async ({
    page,
    stack,
  }) => {
    await conflicted(page, stack.vault);
    // q and the tree refuse with no flash, so only the state is read.
    const at = ["Changed on disk", OUTSIDE, 1, 1, 1];
    await leader(page, "q");
    await expect.poll(() => state(page, stack.vault)).toEqual(at);
    await page.getByRole("button", { name: "Long note", exact: true }).click();
    await expect.poll(() => state(page, stack.vault)).toEqual(at);
    await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
  });

  test("q on the note's pane beside another is refused, writes nothing and lists nothing as left", async ({
    page,
    stack,
  }) => {
    await conflicted(page, stack.vault, async () => {
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(2);
      await page.locator(".cm-content", { hasText: "front door" }).click();
      await page.keyboard.press("Escape");
    });
    await leader(page, "q");
    await expect
      .poll(() => state(page, stack.vault))
      .toEqual(["Changed on disk", OUTSIDE, 1, 1, 2]);
    await expect(page.getByTestId("held-conflict")).toHaveCount(0);
  });

  test("a new tab and the active tab's x are refused with a flash; :w writes the typing, and a tab and back flash nothing", async ({
    page,
    stack,
  }) => {
    await conflicted(page, stack.vault, async () => {
      await leader(page, "ct");
      await expect(page.getByRole("tab")).toHaveCount(2);
      await leader(page, "th");
      await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
      await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    });
    const at = ["Changed on disk", OUTSIDE, 1, 2, 1];
    await refused(page, stack.vault, () => leader(page, "ct"), at);
    // An unsaved tab draws its dot in the x's place until the pointer is over it.
    await page.getByRole("tab", { name: "Welcome (unsaved)" }).hover();
    const close = page.getByRole("button", { name: "Close Welcome" });
    await refused(page, stack.vault, () => close.click(), at);

    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => [await sign(page).getAttribute("aria-label"), await welcome(stack.vault)], {
        timeout: 15_000,
      })
      .toEqual(["Saved", expect.stringContaining("typed here")]);
    await leader(page, "ct");
    await expect(sign(page)).toHaveCount(0);
    await page.getByRole("tab", { name: "Welcome" }).click();
    await expect
      .poll(async () => [await sign(page).getAttribute("aria-label"), await flashing(page)])
      .toEqual(["Saved", false]);
  });

  test("a note left for a new tab whose write fails is listed as not saved, and the file keeps its text", async ({
    page,
    stack,
  }) => {
    const before = await welcome(stack.vault);
    await page.route(
      (url) => decodeURIComponent(url.pathname) === "/api/files/Welcome.md",
      (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({ status: 500, json: { detail: "refused by the test" } })
          : route.fallback(),
    );
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await page.keyboard.press("Escape");
    await leader(page, "ct");
    const held = page.getByTestId("held");
    await expect
      .poll(async () => [
        await held.textContent(),
        await held.getAttribute("title"),
        await welcome(stack.vault),
      ])
      .toEqual([
        "Not saved: Welcome",
        expect.stringContaining("Welcome.md: PUT /api/files/Welcome.md failed with 500"),
        before,
      ]);
  });

  test("the diff shows the other writer's text, and follows a third write while the conflict lasts", async ({
    page,
    stack,
  }) => {
    const { puts } = await conflicted(page, stack.vault);
    await expect
      .poll(() => after(page, stack.vault, puts))
      .toEqual([
        { status: "Changed on disk", diff: bothTexts("Somebody else wrote this."), listed: null },
        OUTSIDE,
        1,
        1,
        true,
      ]);
    await writeFile(join(stack.vault, "Welcome.md"), THIRD);
    await expect
      .poll(() => after(page, stack.vault, puts), { timeout: 15_000 })
      .toEqual([
        { status: "Changed on disk", diff: bothTexts("A third writer's note."), listed: null },
        THIRD,
        1,
        1,
        true,
      ]);
  });

  test("the conflict clears by itself once the vault comes to hold the buffer's text", async ({
    page,
    stack,
  }) => {
    const { mine, puts } = await conflicted(page, stack.vault);
    await writeFile(join(stack.vault, "Welcome.md"), mine);
    await expect
      .poll(() => after(page, stack.vault, puts), { timeout: 15_000 })
      .toEqual([settled, mine, 1, 1, false]);
  });

  test("a click into another pane leaves the note conflicted, listed and unwritten, through a note opened there and a third write", async ({
    page,
    stack,
  }) => {
    const { puts } = await conflicted(page, stack.vault, async () => {
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(2);
      await page.locator(".cm-content", { hasText: "front door" }).click();
      await page.keyboard.press("Escape");
    });
    const today = page.getByRole("region", { name: "Today" });
    // The detail the conflict opens over the panes closes on a click.
    await page.getByTestId("status-detail").click();
    await expect(page.getByTestId("conflict-diff")).toHaveCount(0);
    await panes(page).filter({ has: today }).locator(".cm-content").click();
    const left = (status: string | null) => [
      { status, diff: null, listed: "Changed on disk: Welcome" },
      OUTSIDE,
      1,
      1,
      true,
    ];
    await expect.poll(() => after(page, stack.vault, puts)).toEqual(left(null));
    await openFromTree(page, "Long note");
    await expect
      .poll(async () => [
        ...(await after(page, stack.vault, puts)),
        await page.getByTestId("held").count(),
      ])
      .toEqual([...left("Saved"), 0]);

    await writeFile(join(stack.vault, "Welcome.md"), THIRD);
    await page.locator(".cm-content", { hasText: "typed here" }).click();
    await expect
      .poll(() => after(page, stack.vault, puts), { timeout: 15_000 })
      .toEqual([
        { status: "Changed on disk", diff: bothTexts("A third writer's note."), listed: null },
        THIRD,
        1,
        1,
        true,
      ]);
  });

  /** Closes the detail the conflict opened over the panes, then clicks into `editor`. */
  async function into(page: Page, editor: Locator) {
    if ((await page.getByTestId("status-detail").count()) > 0) {
      await page.getByTestId("status-detail").click();
    }
    await expect(page.getByTestId("conflict-diff")).toHaveCount(0);
    await editor.click();
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  }

  /** Each pane's text, leftmost first. */
  const paneTexts = async (page: Page) => {
    const all = await panes(page).all();
    const boxed = await Promise.all(
      all.map(
        async (pane) =>
          [
            (await pane.boundingBox())?.x ?? 0,
            await pane.locator(".cm-content").textContent(),
          ] as const,
      ),
    );
    return boxed.sort((a, b) => a[0] - b[0]).map(([, text]) => text ?? "");
  };
  const bare = (vault: string) =>
    welcome(vault).then((text) => text.replace(/^(id|created|modified): .*\n/gm, ""));

  test("a pane on the note that never showed the kept text takes later outside writes, and writes its own edit", async ({
    page,
    stack,
  }) => {
    const today = page.getByRole("region", { name: "Today" });
    await conflicted(page, stack.vault, async () => {
      await leader(page, "%");
      await openFromTree(page, "Welcome");
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(3);
      await page.locator(".cm-content", { hasText: "front door" }).first().click();
      await page.keyboard.press("Escape");
    });
    // The second pane is not reloaded: the write is to the focused pane's note, which declines.
    await expect
      .poll(() => paneTexts(page))
      .toEqual([
        expect.stringContaining("typed here"),
        expect.not.stringContaining("typed here"),
        expect.any(String),
      ]);
    await into(page, panes(page).filter({ has: today }).locator(".cm-content"));
    await expect
      .poll(async () => (await conflictBar(page)).listed)
      .toBe("Changed on disk: Welcome");

    await writeFile(join(stack.vault, "Welcome.md"), THIRD);
    await expect
      .poll(() => paneTexts(page), { timeout: 15_000 })
      .toEqual([expect.stringContaining("typed here"), THIRD.trim(), expect.any(String)]);
    await into(page, page.locator(".cm-content", { hasText: THIRD.trim() }));
    await page.keyboard.type("Goedited in the second pane");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => bare(stack.vault), { timeout: 15_000 })
      .toMatch(/^A third writer's note\.\n+edited in the second pane$/m);
  });

  test("a pane left showing the kept text takes the vault's text once :e! settles the conflict in another pane", async ({
    page,
    stack,
  }) => {
    const today = page.getByRole("region", { name: "Today" });
    await conflicted(page, stack.vault, async () => {
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(2);
      await page.locator(".cm-content", { hasText: "front door" }).click();
      await page.keyboard.press("Escape");
    });
    await into(page, panes(page).filter({ has: today }).locator(".cm-content"));
    await writeFile(join(stack.vault, "Welcome.md"), THIRD);
    await openFromTree(page, "Welcome");
    await expect
      .poll(async () => [await paneTexts(page), (await conflictBar(page)).status], {
        timeout: 15_000,
      })
      .toEqual([
        [expect.stringContaining("typed here"), expect.stringContaining("typed here")],
        "Changed on disk",
      ]);

    await into(page, page.locator(".cm-content").nth(1));
    await page.keyboard.type(":e!");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => [await paneTexts(page), await stillHeld(page)])
      .toEqual([[THIRD.trim(), THIRD.trim()], false]);
    await into(page, page.locator(".cm-content").first());
    await page.keyboard.type("Goedited in the first pane");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => bare(stack.vault), { timeout: 15_000 })
      .toMatch(/^A third writer's note\.\n+edited in the first pane$/m);
  });
});
