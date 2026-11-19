import type { Page } from "@playwright/test";
import { leader, openApp, vaultWith } from "../../harness/app.ts";
import { answer, hit } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const LINES = "one\ntwo\nthree\nfour";

/** The focused editor's line numbers, top to bottom, less the gutter's hidden spacer. */
const gutter = (page: Page): Promise<string[]> =>
  page
    .locator(".cm-editor:has(.cm-content:focus) .cm-lineNumbers .cm-gutterElement")
    .evaluateAll((all) =>
      all
        .filter((n) => (n as HTMLElement).style.visibility !== "hidden")
        .map((n) => n.textContent ?? ""),
    );

/** Searches for `term` with `Space f g` and opens the first line the search lists. */
async function openHit(page: Page, term: string): Promise<void> {
  await leader(page, "fg");
  const input = page.getByRole("combobox", { name: "search notes" });
  await expect(input).toBeFocused();
  await input.fill(term);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Lines", selected: true })).toBeVisible();
}

test.describe("a search hit", () => {
  test.beforeEach(async ({ page, stack }) => {
    await vaultWith(stack.vault, { "Lines.md": LINES });
    // The search answers each word with its line of Lines.md, and `gone` with a line past its end.
    await answer(page, (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      const line = { two: 2, three: 3, four: 4, gone: 99 }[q];
      return line ? [hit("Lines.md", line, q)] : [];
    });
    await openApp(page);
  });

  test("opens the note with the cursor on its line, and a second hit on the open note moves it there", async ({
    page,
  }) => {
    await openHit(page, "three");
    await expect(page.locator(".cm-activeLine")).toHaveText("three");
    await page.keyboard.press("Escape");
    await openHit(page, "two");
    await expect(page.locator(".cm-activeLine")).toHaveText("two");
  });

  test("the gutter counts each line's distance from the line the hit opens at, and recounts as j moves the cursor", async ({
    page,
  }) => {
    await openHit(page, "three");
    await expect(page.locator(".cm-activeLine")).toHaveText("three");
    await expect.poll(() => gutter(page)).toEqual(["2", "1", "3", "1"]);
    await page.keyboard.press("j");
    await expect(page.locator(".cm-activeLine")).toHaveText("four");
    await expect.poll(() => gutter(page)).toEqual(["3", "2", "1", "4"]);
  });

  test("past the note's end opens it with the cursor on its last line", async ({ page }) => {
    await openHit(page, "gone");
    await expect(page.locator(".cm-activeLine")).toHaveText("four");
  });
});
/**
 * Opens the note by its address, vim on or off, and names the line the cursor starts on: its place
 * among the lines drawn and its text. A frontmatter draws as one line, the first.
 */
async function startLine(page: Page, vault: string, body: string, vim = true) {
  await vaultWith(vault, { "Start.md": body });
  if (!vim) await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await page.goto(`/?note=${encodeURIComponent("Start.md")}`);
  await expect(page.locator(".cm-content")).toBeFocused({ timeout: 15_000 });
  await expect(page.locator(".cm-activeLine")).toHaveCount(1);
  return page.locator(".cm-content").evaluate((content) => {
    const lines = [...content.querySelectorAll(".cm-line")];
    const at = lines.findIndex((line) => line.classList.contains("cm-activeLine"));
    return { at, text: lines[at]?.textContent };
  });
}

test.describe("a note opened with no line", () => {
  test("starts at the top", async ({ page, stack }) => {
    expect(await startLine(page, stack.vault, LINES)).toEqual({ at: 0, text: "one" });
  });

  test("with vim on the gutter names line 1 and counts each line below by its distance", async ({
    page,
    stack,
  }) => {
    await startLine(page, stack.vault, LINES);
    await expect.poll(() => gutter(page)).toEqual(["1", "1", "2", "3"]);
  });

  test("with vim off on a desktop the gutter shows and numbers each line", async ({
    page,
    stack,
  }) => {
    await startLine(page, stack.vault, LINES, false);
    await expect(page.locator(".cm-editor:has(.cm-content:focus) .cm-gutters")).toBeVisible();
    await expect.poll(() => gutter(page)).toEqual(["1", "2", "3", "4"]);
  });

  const BELOW = [
    ["a frontmatter", "---\nid: 1\n---\nNotes"],
    ["one whose opening fence has a trailing space", "--- \nid: x\n---\nbody"],
    ["one whose closing fence has a trailing space and tab", "---\nid: x\n--- \t\nbody"],
    ["one with CRLF line ends", "---\r\nid: x\r\n---\r\nbody"],
  ];
  for (const [shape, body] of BELOW) {
    test(`starts below ${shape}`, async ({ page, stack }) => {
      const first = body.split(/\r?\n/).at(-1);
      expect(await startLine(page, stack.vault, body)).toEqual({ at: 1, text: first });
    });
  }

  test("starts below a frontmatter whose opening fence has a trailing space, with vim off", async ({
    page,
    stack,
  }) => {
    expect(await startLine(page, stack.vault, "--- \nid: x\n---\nbody", false)).toEqual({
      at: 1,
      text: "body",
    });
  });

  const TOP = [
    ["the opening fence has a space in front", " ---\nid: x\n---\nbody"],
    ["the frontmatter never closes", "---\nid: x\nbody"],
  ];
  for (const [shape, body] of TOP) {
    test(`starts at the top when ${shape}`, async ({ page, stack }) => {
      expect((await startLine(page, stack.vault, body)).at).toBe(0);
    });
  }
});

test.describe("the RSVP reader over a note", () => {
  const READ = "Read.md";
  const PLACE = "/api/rsvp?path=Read.md";
  const reader = (page: Page) => page.getByRole("dialog", { name: "RSVP" });
  const chunk = (page: Page) => reader(page).locator('output[aria-live="off"]');
  const savedWord = async (page: Page) => (await (await page.request.get(PLACE)).json())?.word;

  /** Opens Read.md by its address, a place already saved at `word` if given. */
  async function openRead(page: Page, vault: string, word?: number) {
    await vaultWith(vault, { [READ]: "One two three. Four five six.\n\nSeven eight.\n" });
    if (word !== undefined) {
      const anchor = "two three. Four five six.";
      await page.request.put(PLACE, { data: { word, words: 8, anchor } });
    }
    await page.goto(`/?note=${READ}`);
    await expect(page.locator(".cm-content")).toBeFocused({ timeout: 15_000 });
    await expect(page.getByText("Seven eight.")).toBeVisible();
  }

  test("rr resumes at the saved place, and h l H L walk by sentence and paragraph", async ({
    page,
    stack,
  }) => {
    await openRead(page, stack.vault, 1);
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("two");
    for (const [key, shown] of [
      ["l", "Four"],
      ["L", "Seven"],
      ["h", "Four"],
      ["H", "One"],
    ]) {
      await page.keyboard.press(key);
      await expect(chunk(page)).toHaveText(shown);
    }
  });

  test("Space plays chunk by chunk, and the place kept on a pause and on Escape is where rr resumes", async ({
    page,
    stack,
  }) => {
    await page.clock.install();
    await openRead(page, stack.vault);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("One");
    await page.keyboard.press(" ");
    // 300 words a minute is 200 ms a word.
    await page.clock.runFor(200);
    await expect(chunk(page)).toHaveText("two");
    await page.keyboard.press(" ");
    await expect.poll(() => savedWord(page)).toBe(1);
    await page.clock.resume();
    await page.reload();
    await expect(page.locator(".cm-content")).toBeFocused({ timeout: 15_000 });
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("two");

    await page.keyboard.press("l");
    await page.keyboard.press("Escape");
    await expect(reader(page)).toHaveCount(0);
    await expect.poll(() => savedWord(page)).toBe(3);
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("Four");
  });

  test("a place is sent only once the save before it has landed, and the newest wins", async ({
    page,
    stack,
  }) => {
    await page.clock.install();
    await openRead(page, stack.vault);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    const sent: number[] = [];
    let land = () => {};
    const landed = new Promise<void>((done) => {
      land = done;
    });
    await page.route("**/api/rsvp?*", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      sent.push(route.request().postDataJSON().word);
      if (sent.length === 1) await landed;
      return route.continue();
    });
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("One");
    await page.keyboard.press("l");
    await page.keyboard.press(" ");
    await page.keyboard.press(" ");
    await expect.poll(() => sent).toEqual([3]);
    await page.keyboard.press("l");
    await page.keyboard.press("Escape");
    await expect(reader(page)).toHaveCount(0);
    // A round trip to the backend, in which a second save sent at once would have reached the route.
    await savedWord(page);
    expect(sent).toEqual([3]);
    land();
    await expect.poll(() => sent).toEqual([3, 6]);
    await expect.poll(() => savedWord(page)).toBe(6);
  });

  test("rh starts at the cursor and saves that as the place", async ({ page, stack }) => {
    await openRead(page, stack.vault, 1);
    await page.keyboard.type("ggfi");
    await leader(page, "rh");
    await expect(chunk(page)).toHaveText("five");
    await expect.poll(() => savedWord(page)).toBe(4);
  });

  test("j and k change the speed, which a reload keeps", async ({ page, stack }) => {
    await openRead(page, stack.vault);
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("One");
    for (const key of "kkj") await page.keyboard.press(key);
    await expect(reader(page).getByText("325", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator(".cm-content")).toBeFocused({ timeout: 15_000 });
    await leader(page, "rr");
    await expect(reader(page).getByText("325", { exact: true })).toBeVisible();
  });
  test("the reader keeps every key, so ? opens no key help over it and q closes nothing", async ({
    page,
    stack,
  }) => {
    await openRead(page, stack.vault);
    await leader(page, "rr");
    await expect(chunk(page)).toHaveText("One");
    await page.keyboard.press("?");
    await page.keyboard.press("q");
    await page.keyboard.press("l");
    await expect(chunk(page)).toHaveText("Four");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Read" })).toBeVisible();
  });

  test("a page that never hands over its text says why", async ({ page, stack }) => {
    await vaultWith(stack.vault, { "mute.html": "<p>Hello world</p>" });
    // Served without kasten's page script: it shows that the reader asked for its text, and never answers.
    const body = `<p>Hello world</p><script>addEventListener("message", (e) => {
      if (e.data?.kasten === "text") document.body.append("Asked for its text");
    });</script>`;
    await page.route("**/api/html/mute.html*", (route) =>
      route.fulfill({ contentType: "text/html", body }),
    );
    await page.clock.install();
    await openApp(page);
    await page.getByRole("button", { name: "mute.html", exact: true }).click();
    const frame = page.frameLocator("[data-html-pane] iframe");
    await expect(frame.getByText("Hello world")).toBeVisible();
    await page.locator("[data-html-pane] header").getByText("mute.html").click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await leader(page, "rr");
    await expect(reader(page)).toBeVisible();
    // The reader draws before its effect arms the give-up, and asks only once armed (#2110).
    await expect(frame.getByText("Asked for its text")).toBeVisible();
    await page.clock.runFor(5000);
    await expect(reader(page).getByText("The page did not hand over its text")).toBeVisible();
  });
  test("with vim off the palette row opens the reader, whose keys still walk the text", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openRead(page, stack.vault);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Read this pane word by word/ }).click();
    await expect(chunk(page)).toHaveText("One");
    await page.keyboard.press("l");
    await expect(chunk(page)).toHaveText("Four");
  });
});
