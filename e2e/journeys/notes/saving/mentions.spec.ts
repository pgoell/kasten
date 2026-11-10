import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { findNote, leader, noteText, openApp, phone, tapHeight } from "../../../harness/app.ts";
import { type Hit, hit, lineOf, openPanel } from "../../../harness/search.ts";
import { expect, test } from "../../../harness/stack.ts";

// The e2e vault's Seeds note names the Garden note twice in plain text, once in each case.
const SEEDS = "01 Notes/Seeds.md";
const BEDS = "Order seeds for the Garden beds in March.";
const FENCE = "A kitchen garden needs a fence against rabbits.";

/** Opens the Garden note's backlinks, its links answered by `links` where given; returns the mentions asks. */
async function gardenMentions(page: Page, links?: Hit[]): Promise<URL[]> {
  const asked: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/mentions?")) asked.push(new URL(request.url()));
  });
  if (links !== undefined) {
    await page.route("**/api/search?**", (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      // The recent notes ask the search too, by their `modified:` date.
      if (q.startsWith("modified:")) return route.fallback();
      return route.fulfill({ json: q === "Garden" ? links : [] });
    });
  }
  await openApp(page);
  await findNote(page, "Garden");
  await openPanel(page, "gb", "backlinks");
  return asked;
}

const panel = (page: Page) => page.getByRole("dialog", { name: "Backlinks" });
const rows = (page: Page) => panel(page).getByRole("option");
const mentions = (page: Page) =>
  panel(page).getByRole("group", { name: "unlinked mentions" }).getByRole("option");
const texts = (list: Locator) => list.allTextContents();

/** The Seeds note's two mentions as their rows read, path, line and words. */
async function mentionRows(vault: string): Promise<string[]> {
  return [
    `${SEEDS}:${await lineOf(vault, SEEDS, BEDS)}${BEDS}`,
    `${SEEDS}:${await lineOf(vault, SEEDS, FENCE)}${FENCE}`,
  ];
}

test.describe("unlinked mentions", () => {
  test("a note's mentions come in a group of their own after its links, asked for by its path with the archive out", async ({
    page,
    stack,
  }) => {
    const asked = await gardenMentions(page);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [await texts(rows(page)), await texts(mentions(page))])
      .toEqual([[expect.stringContaining("[[Garden]]"), ...both], both]);
    expect(asked.map((url) => [...url.searchParams])).toEqual([
      [
        ["path", "02 Projects/Garden.md"],
        ["archive", "false"],
      ],
    ]);
  });

  test("the mentions still show under a note with more links than the list holds", async ({
    page,
    stack,
  }) => {
    const links = Array.from({ length: 25 }, (_, i) =>
      hit("Long note.md", i + 1, `[[Garden]] ${i}`),
    );
    await gardenMentions(page, links);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [await rows(page).count(), await texts(mentions(page))])
      .toEqual([22, both]);
  });

  test("a note with only mentions still says nothing links here", async ({ page, stack }) => {
    await gardenMentions(page, []);
    const both = await mentionRows(stack.vault);
    await expect
      .poll(async () => [
        await texts(rows(page)),
        await panel(page).getByRole("status").textContent(),
      ])
      .toEqual([both, "nothing links here"]);
  });

  test("typing narrows the mentions, and Enter opens one on its line without linking it", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, SEEDS);
    await gardenMentions(page);
    await expect(mentions(page)).toHaveCount(2);
    await page.keyboard.type("fence");
    const [, fence] = await mentionRows(stack.vault);
    await expect.poll(() => texts(rows(page))).toEqual([fence]);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Seeds", selected: true })).toBeVisible();
    await expect(page.locator(".cm-activeLine")).toHaveText(FENCE);
    expect(await noteText(stack.vault, SEEDS)).toBe(before);
  });

  test("Ctrl+Enter and Cmd+Enter link the highlighted mention on disk and open nothing", async ({
    page,
    stack,
  }) => {
    await gardenMentions(page);
    const [beds] = await mentionRows(stack.vault);
    await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press("Tab");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows(page).nth(1)).toHaveText(beds ?? "");
    await page.keyboard.press("Control+Enter");
    await expect
      .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
      .toContain("Order seeds for the [[Garden]] beds in March.");

    // The list reloads once a link lands, so the second mention is narrowed to rather than walked to.
    // Typing before the reload would narrow the old list, whose line numbers the write has moved.
    const [, fence] = await mentionRows(stack.vault);
    await expect.poll(() => texts(mentions(page))).toEqual([fence]);
    await page.keyboard.type("fence");
    await expect.poll(() => texts(rows(page))).toEqual([expect.stringContaining(FENCE)]);
    await page.keyboard.press("Meta+Enter");
    await expect
      .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
      .toContain("A kitchen [[Garden|garden]] needs a fence against rabbits.");
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  });

  test("a refused link says why and keeps its row, three presses send one write, and the reason goes once the query changes", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, SEEDS);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    await page.route("**/api/files/**", async (route) => {
      const request = route.request();
      if (request.method() !== "PUT" || !request.url().includes("Seeds.md"))
        return route.fallback();
      writes.push(request.url());
      await held;
      await route.fulfill({ status: 500, json: { detail: "refused by the test" } });
    });
    await gardenMentions(page, []);
    const status = panel(page).getByRole("status");
    await expect(mentions(page)).toHaveCount(2);

    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Control+Enter");
    await panel(page).getByRole("button", { name: "link" }).first().click();
    await expect.poll(() => writes.length).toBe(1);
    release();
    await expect
      .poll(async () => [await status.textContent(), await mentions(page).count(), writes.length])
      .toEqual(["The link was not written", 2, 1]);
    expect(await noteText(stack.vault, SEEDS)).toBe(before);

    await page.keyboard.type("fence");
    await expect
      .poll(async () => [await status.textContent(), await rows(page).count()])
      .toEqual(["nothing links here", 1]);
  });

  const LINKED = "Order seeds for the [[Garden]] beds in March.";

  /** Highlights the Seeds note's first mention and links it with Ctrl+Enter. */
  async function linkBeds(page: Page) {
    await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press("Tab");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+Enter");
  }

  /** Seeds open in one pane and Garden's backlinks in the other, the Seeds pane typed into first where `type` is given. */
  async function besideSeeds(page: Page, type?: () => Promise<void>) {
    await openApp(page);
    await findNote(page, "Seeds");
    await leader(page, "%");
    await findNote(page, "Garden");
    const seeds = page.locator(".cm-content", { hasText: "Order seeds" });
    if (type !== undefined) {
      // A line, not the content's middle: in a short note that sits under the note's header.
      await seeds.locator(".cm-line:visible").last().click();
      await page.keyboard.press("Escape");
      await type();
      await page
        .locator(".cm-content", { hasText: "water the tomatoes" })
        .locator(".cm-line:visible")
        .last()
        .click();
      await page.keyboard.press("Escape");
    }
    await openPanel(page, "gb", "backlinks");
    return seeds;
  }

  /** The panel's line and the Seeds note on disk, read in one poll. */
  const outcome = async (page: Page, vault: string) => [
    await panel(page).getByRole("status").textContent(),
    await noteText(vault, SEEDS),
  ];

  test("a link lands in a clean pane open on the note, which reloads off the vault's answer", async ({
    page,
    stack,
  }) => {
    const seeds = await besideSeeds(page);
    await linkBeds(page);
    await expect
      .poll(
        async () => [
          (await noteText(stack.vault, SEEDS)).includes(LINKED),
          await seeds.locator(".cm-wikilink", { hasText: "Garden" }).count(),
        ],
        { timeout: 15_000 },
      )
      .toEqual([true, 1]);
  });

  test("a link writes nothing while the note's own write is out, or while it holds text a failed save left, and says why", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, SEEDS);
    let answer: (status: number) => void = () => {};
    const puts: string[] = [];
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${SEEDS}`,
      async (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        puts.push(route.request().url());
        const status = await new Promise<number>((resolve) => {
          answer = resolve;
        });
        await route.fulfill({ status, json: { detail: "refused by the test" } });
      },
    );
    await besideSeeds(page, async () => {
      await page.keyboard.type("Gotyped");
      await page.keyboard.press("Escape");
    });
    await expect.poll(() => puts.length).toBeGreaterThan(0);
    await linkBeds(page);
    await expect
      .poll(() => outcome(page, stack.vault))
      .toEqual(["That note is still being saved", before]);

    // The write fails, which leaves its text held in the page.
    answer(500);
    await expect(mentions(page)).toHaveCount(2);
    // A press can land before the page reads the 500, and then rightly says the write is out.
    await expect(async () => {
      await page.keyboard.press("Control+Enter");
      expect(await outcome(page, stack.vault)).toEqual([
        "That note holds text not yet saved",
        before,
      ]);
    }).toPass();
  });

  test("a link writes nothing when the line changed on disk since the list was read, and says why", async ({
    page,
    stack,
  }) => {
    // The panel keeps the list it read first, as it would before the vault's event reached it.
    let first: Awaited<ReturnType<Page["request"]["fetch"]>> | undefined;
    await page.route("**/api/mentions?**", async (route) => {
      first ??= await route.fetch();
      await route.fulfill({ response: first });
    });
    await gardenMentions(page);
    await expect(mentions(page)).toHaveCount(2);
    const april = (await noteText(stack.vault, SEEDS)).replace("March", "April");
    await writeFile(join(stack.vault, SEEDS), april);
    await linkBeds(page);
    await expect
      .poll(() => outcome(page, stack.vault))
      .toEqual(["That line has changed since it was listed", april]);
  });

  /** Changes Seeds on disk before each write of the link reaches the vault, so the write names a base the disk moved past. */
  async function writtenBetween(
    page: Page,
    vault: string,
    change: (text: string, write: number) => string,
  ) {
    let writes = 0;
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${SEEDS}`,
      async (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        writes += 1;
        await writeFile(join(vault, SEEDS), change(await noteText(vault, SEEDS), writes));
        await route.fallback();
      },
    );
  }

  test("a link refused over its base links on the read after when the line still says the same", async ({
    page,
    stack,
  }) => {
    await writtenBetween(page, stack.vault, (text, write) =>
      write === 1 ? `${text}added by somebody else\n` : text,
    );
    await gardenMentions(page);
    await linkBeds(page);
    await expect
      .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
      .toMatch(
        /Order seeds for the \[\[Garden\]\] beds in March\.\n[\s\S]*added by somebody else\n$/,
      );
    await expect(panel(page).getByRole("status")).not.toHaveText("The link was not written");
  });

  test("a link refused over its base writes nothing when the line changed, and nothing over three writes in a row", async ({
    page,
    stack,
  }) => {
    let line = (text: string, _write: number) => text.replace("March", "April");
    await writtenBetween(page, stack.vault, (text, write) => line(text, write));
    await gardenMentions(page);
    await linkBeds(page);
    const april = (await noteText(stack.vault, SEEDS)).replace("March", "April");
    await expect
      .poll(() => outcome(page, stack.vault))
      .toEqual(["That line has changed since it was listed", april]);

    line = (text, write) => `${text}write ${write}\n`;
    await page.keyboard.type("fence");
    await expect(rows(page)).toHaveCount(1);
    await page.keyboard.press("Control+Enter");
    await expect
      .poll(() => outcome(page, stack.vault), { timeout: 15_000 })
      .toEqual(["The link was not written", `${april}write 2\nwrite 3\nwrite 4\n`]);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on a mention's link button links it on disk, keeps the focus in the input and opens nothing", async ({
      page,
      stack,
    }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Find a note" }).tap({ timeout: 15_000 });
      await page.getByRole("combobox").fill("Garden");
      await page
        .getByRole("option", { name: /Garden/ })
        .first()
        .tap();
      const editor = page.locator(".cm-content", { hasText: "water the tomatoes" });
      await expect(editor).toBeVisible();
      await page
        .getByRole("toolbar", { name: "Commands" })
        .getByRole("button", { name: "Run a command by name" })
        .tap();
      await page.getByRole("option", { name: /^Show what links here/ }).tap();
      const input = page.getByRole("combobox", { name: "backlinks" });
      await expect(input).toBeFocused();
      await expect(mentions(page)).toHaveCount(2);

      const button = panel(page).getByRole("button", { name: "link" }).first();
      // A thumb's height, as the rows of the finder are on a phone.
      expect(await tapHeight(button)).toBeGreaterThanOrEqual(44);
      await button.tap();
      await expect
        .poll(() => noteText(stack.vault, SEEDS), { timeout: 15_000 })
        .toContain("Order seeds for the [[Garden]] beds in March.");
      await expect(input).toBeFocused();
      await expect(panel(page).getByTestId("preview")).toHaveCount(0);
      await expect(editor).toBeVisible();
    });
  });
});
