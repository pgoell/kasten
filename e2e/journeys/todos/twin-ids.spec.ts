import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { findNote, leader, noteText, openApp, phone, today } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// Two todo lines carrying one 🆔, as a pasted copy leaves them, and a todo waiting on that id.
const LINE = "- [/] twin task 🆔 kt-aaaaaa";
const NOTES = {
  "Twins.md": `${LINE}\n${LINE}\n`,
  "Deps.md": "- [b] wait on the twin ⛔ kt-aaaaaa\n",
};
const ROW = '[data-row*=".md:"]';
const notice = (page: Page) => page.getByTestId("notice");
const daily = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

async function vaultWith(vault: string, notes: Record<string, string>) {
  for (const [path, text] of Object.entries(notes)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), text);
  }
}

/** What a press names: the other twin's 1-based line in `path` as the disk now has it. */
async function names(vault: string, path: string, words: string, nth: number) {
  const lines = (await noteText(vault, path)).split("\n");
  const at = lines.map((line, i) => (line.includes(words) ? i + 1 : 0)).filter((i) => i > 0);
  return `Nothing moved: 🆔 kt-aaaaaa is on another todo too: ${path} line ${at[nth]}`;
}

/** Twins, Deps and today's note as the disk holds them, to show a press wrote nothing. */
const disk = async (vault: string) => [
  await noteText(vault, "Twins.md"),
  await noteText(vault, "Deps.md"),
  await daily(vault),
];

// A todo, an open blocker carrying an id, and that blocker's done twin in another note.
const BLOCKING = {
  "Block.md": "- [ ] write the docs\n- [ ] ship the release 🆔 kt-aaaaaa\n",
  "Twins.md": "- [x] ship the release 🆔 kt-aaaaaa\n",
};
const blockDisk = async (vault: string) => [
  await noteText(vault, "Block.md"),
  await noteText(vault, "Twins.md"),
];

/** Moves the pane's cursor to the `nth` row whose text holds `words`. */
async function cursorTo(page: Page, words: string, nth = 0) {
  const { from, to } = await page.locator(ROW).evaluateAll(
    (rows, [text, n]) => ({
      from: rows.findIndex((row) => (row as HTMLElement).tabIndex === 0),
      to: rows
        .map((row, i) => ((row.textContent ?? "").includes(text as string) ? i : -1))
        .filter((i) => i >= 0)[n as number],
    }),
    [words, nth] as const,
  );
  const key = (to ?? 0) > from ? "j" : "k";
  for (let i = 0; i < Math.abs((to ?? 0) - from); i++) await page.keyboard.press(key);
  await expect(page.locator(`${ROW}[tabindex="0"]`)).toContainText(words);
}

/** The todo pane over the twins, its cursor on the second. */
async function paneOnSecond(page: Page, vault: string) {
  await vaultWith(vault, NOTES);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(ROW, { hasText: "twin task" })).toHaveCount(2);
  await cursorTo(page, "twin task", 1);
}

// One test per key, so each starts with no notice and the notice read is its own.
for (const key of ["t", "X"]) {
  test(`${key} in the todo pane on the second of two twins writes nothing and names the first`, async ({
    page,
    stack,
  }) => {
    await paneOnSecond(page, stack.vault);
    const before = await disk(stack.vault);
    const first = await names(stack.vault, "Twins.md", "twin task", 0);
    await expect(notice(page)).toHaveCount(0);
    await page.keyboard.press(key);
    await expect
      .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
      .toEqual([first, ...before]);
  });
}

test("t in the todo pane says Nothing moved and why when its search fails, and writes nothing", async ({
  page,
  stack,
}) => {
  await page.route("**/api/search?**", (route) =>
    route.request().url().includes("kt-aaaaaa")
      ? route.fulfill({ status: 500, json: { detail: "refused by the test" } })
      : route.fallback(),
  );
  await paneOnSecond(page, stack.vault);
  const before = await disk(stack.vault);
  await page.keyboard.press("t");
  await expect
    .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
    .toEqual([expect.stringMatching(/^Nothing moved: .*500/), ...before]);
});

test("<leader>x on a twin cycles its own line on disk, logs and unblocks nothing, and names the other", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, NOTES);
  await openApp(page);
  await findNote(page, "Twins");
  const deps = await noteText(stack.vault, "Deps.md");
  const second = await names(stack.vault, "Twins.md", "twin task", 1);
  await leader(page, "x");
  await expect
    .poll(
      async () => [
        await notice(page).textContent(),
        (await noteText(stack.vault, "Twins.md")).includes("- [x] twin task ✅"),
        await noteText(stack.vault, "Deps.md"),
        (await daily(stack.vault)).includes("twin task"),
      ],
      { timeout: 15_000 },
    )
    .toEqual([second, true, deps, false]);
});

test("<leader>x in today's note on a todo whose 🆔 another note carries moves only its line", async ({
  page,
  stack,
}) => {
  const path = `01 Periodic/00 Daily/${today()}.md`;
  await vaultWith(stack.vault, {
    [path]: "- [/] daily twin 🆔 kt-aaaaaa\n- [b] daily wait ⛔ kt-aaaaaa\n\n## Done\n",
    "Twin elsewhere.md": "- [/] far twin 🆔 kt-aaaaaa\n",
  });
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  await expect(page.locator(".cm-content", { hasText: "daily twin" })).toBeVisible({
    timeout: 15_000,
  });
  // The press asks the page's listing of the todos, so the todos panel reads one first.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await leader(page, "ft");
  await expect(
    page.getByRole("dialog", { name: "Todos" }).getByRole("option").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".cm-line", { hasText: "daily twin" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  const other = await names(stack.vault, "Twin elsewhere.md", "far twin", 0);
  await leader(page, "x");
  await expect
    .poll(async () => [await notice(page).textContent(), await daily(stack.vault)], {
      timeout: 15_000,
    })
    .toEqual([
      other,
      expect.stringMatching(
        /- \[x\] daily twin ✅ \S+ 🆔 kt-aaaaaa\n- \[b\] daily wait ⛔ kt-aaaaaa\n\n## Done\n$/,
      ),
    ]);
});

test("b in the todo pane picking a twinned blocker writes nothing and names the other", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, BLOCKING);
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "write the docs");
  const before = await blockDisk(stack.vault);
  const other = await names(stack.vault, "Twins.md", "ship the release", 0);
  await page.keyboard.press("b");
  await cursorTo(page, "ship the release");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => [await notice(page).textContent(), ...(await blockDisk(stack.vault))])
    .toEqual([other, ...before]);
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("the palette's cycle on a twin cycles its own line, logs nothing and names the other", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, NOTES);
    await page.goto("/?note=Twins.md");
    await expect(page.locator(".cm-content", { hasText: "twin task" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator(".cm-line", { hasText: "twin task" }).first().click();
    const second = await names(stack.vault, "Twins.md", "twin task", 1);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Cycle the todo on this line/ }).click();
    await expect
      .poll(
        async () => [
          await notice(page).textContent(),
          (await noteText(stack.vault, "Twins.md")).includes("- [x] twin task ✅"),
          (await daily(stack.vault)).includes("twin task"),
        ],
        { timeout: 15_000 },
      )
      .toEqual([second, true, false]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  for (const action of ["timer", "done"]) {
    test(`the strip's ${action} on the second of two twins writes nothing and names the first`, async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, NOTES);
      await page.goto("/");
      await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
      await expect(page.getByLabel("more for twin task")).toHaveCount(2);
      const before = await disk(stack.vault);
      const first = await names(stack.vault, "Twins.md", "twin task", 0);
      await page.getByLabel("more for twin task").nth(1).tap();
      await page.getByLabel(`${action} twin task`).tap();
      await expect
        .poll(async () => [await notice(page).textContent(), ...(await disk(stack.vault))])
        .toEqual([first, ...before]);
    });
  }

  test("the menu's blocked by picking a twinned blocker writes nothing and names the other", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, BLOCKING);
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    const before = await blockDisk(stack.vault);
    const other = await names(stack.vault, "Twins.md", "ship the release", 0);
    await page.getByLabel("more for write the docs").tap();
    await page.getByLabel("blocked by write the docs").tap();
    await page.getByRole("button", { name: "ship the release", exact: true }).first().tap();
    await expect
      .poll(async () => [await notice(page).textContent(), ...(await blockDisk(stack.vault))])
      .toEqual([other, ...before]);
  });
});
