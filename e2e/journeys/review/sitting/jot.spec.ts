import type { Page } from "@playwright/test";
import {
  bodyOf,
  noteText,
  phone,
  plus,
  tapHeight,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { sitDeck } from "../review.ts";

// One deck over two notes, so the note a question goes to is the shown card's and no other.
const NOTES: Record<string, string> = {
  "03 Flashcards/jot-a.md": "#flashcards/jot\n\nWhat is a VPC?::A private cloud\n",
  "03 Flashcards/jot-b.md": "#flashcards/jot\n\nWhat is S3?::Storage\n",
};

/** Sits the jot deck; returns the shown card's question and the note it came from. */
async function sitJot(page: Page, vault: string): Promise<{ question: string; note: string }> {
  await sitDeck(page, vault, NOTES, "jot");
  const card = page.getByTestId("review-card");
  await expect(card).toContainText("?");
  const question = (await card.textContent())?.includes("VPC") ? "What is a VPC?" : "What is S3?";
  const note = Object.keys(NOTES).find((path) => NOTES[path]?.includes(question)) ?? "";
  return { question, note };
}

/** Counts the PUTs that write `path`, from here on. */
function countPuts(page: Page, path: string): () => number {
  let puts = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "PUT" && decodeURIComponent(url.pathname) === `/api/files/${path}`)
      puts += 1;
  });
  return () => puts;
}

const jotButton = (page: Page) => page.getByRole("button", { name: "Write a new question" });
const field = (page: Page) => page.getByLabel("a new question");

test.describe("a question jotted in a sitting", () => {
  test("goes to the end of the note the card on screen came from, and to no other", async ({
    page,
    stack,
  }) => {
    const { note } = await sitJot(page, stack.vault);
    const other = Object.keys(NOTES).find((path) => path !== note) ?? "";

    await jotButton(page).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.type("What is a moved block?");
    await page.keyboard.press("Enter");

    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toMatch(/\nWhat is a moved block\?::\s*$/);
    expect(await noteText(stack.vault, other)).not.toContain("moved block");
  });

  test("leaves the card on screen and the count of cards left alone, and the field closes", async ({
    page,
    stack,
  }) => {
    const { question, note } = await sitJot(page, stack.vault);
    const left = page.getByText(/^\d+ left$/);
    await expect(left).toHaveText("2 left");

    await jotButton(page).click();
    await page.keyboard.type("What is a moved block?");
    await page.keyboard.press("Enter");

    // On disk first, so the reads below come after any refetch the write could start.
    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toContain("What is a moved block?::");
    await expect(field(page)).toHaveCount(0);
    await expect(page.getByTestId("review-card")).toContainText(question);
    await expect(left).toHaveText("2 left");
  });

  test("a second tap shuts the field and writes nothing", async ({ page, stack }) => {
    const { note } = await sitJot(page, stack.vault);
    const puts = countPuts(page, note);
    const button = jotButton(page);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.type("Dropped words");
    await button.click();
    await expect(field(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // The next jot is the one write: the dropped words never went out before it.
    await button.click();
    await page.keyboard.type("Kept words");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toContain("Kept words::");
    expect(puts()).toBe(1);
    expect(await noteText(stack.vault, note)).not.toContain("Dropped words");
  });
});

const AWS = "03 Flashcards/aws.md";
const FRESH = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";
/** The same card due today, `interval` days after the answer before it. */
const held = (interval: number) =>
  `#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service <!--SR:!${today()},${interval},250-->\n`;

/** Sits deck aws over `text` and, with `reveal`, turns the card over by key, so no pointer hovers a grade. */
async function sitAws(page: Page, vault: string, text: string, reveal = false): Promise<void> {
  await sitDeck(page, vault, { [AWS]: text }, "aws");
  if (reveal) {
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-back")).toBeVisible();
  }
}

/** The computed `prop` of `selector`, and of a probe whose `prop` is the theme's `token`. */
function styleOf(page: Page, selector: string, prop: string, token?: string) {
  return page.evaluate(
    ([sel, name, tok]) => {
      const read = (el: Element) => getComputedStyle(el).getPropertyValue(name);
      const probe = document.createElement("span");
      if (tok) probe.style.setProperty(name, `var(${tok})`);
      document.body.append(probe);
      const pair = [read(document.querySelector(sel) as Element), read(probe)];
      probe.remove();
      return pair;
    },
    [selector, prop, token ?? ""],
  );
}

const grade = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** Each grade's interval, in the order Again, Hard, Good, Easy. */
async function intervalsRead(page: Page, words: string[]): Promise<void> {
  for (const [at, name] of ["Again", "Hard", "Good", "Easy"].entries())
    await expect(grade(page, name)).toHaveAccessibleDescription(words[at] ?? "");
}

test.describe("the sitting's screens", () => {
  test("the question names the deck in small muted mono and the count, and Show the answer carries a Space hint", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, FRESH);
    const name = "header span.font-mono";
    await expect(page.locator(name)).toHaveText("aws");
    await expect(page.getByText(/^\d+ left$/)).toHaveText("1 left");
    await expect(page.getByRole("button", { name: "Show the answer" })).toContainText("Space");
    const [family, mono] = await styleOf(page, name, "font-family", "--k-mono");
    expect(family).toBe(mono);
    const [size] = await styleOf(page, name, "font-size");
    expect(size).toBe("13px");
    const [color, muted] = await styleOf(page, name, "color", "--k-muted");
    expect(color).toBe(muted);
  });

  test("Park this card writes the suspend token and, with nothing left, says nothing in the deck is scheduled", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, FRESH);
    await page.getByRole("button", { name: "Park this card" }).click();
    await expect.poll(() => noteText(stack.vault, AWS)).toContain("!suspended");
    await expect(page.getByText("Nothing in aws is scheduled yet.")).toBeVisible();
  });

  test("a cloze question draws its gap as a round pill with the brackets in it", async ({
    page,
    stack,
  }) => {
    await sitAws(
      page,
      stack.vault,
      "#flashcards/aws\n\nS3 stands for {{c1::Simple Storage Service}}\n",
    );
    await expect(page.getByTestId("review-card").locator("[data-gap]")).toHaveText("[...]");
    const [radius] = await styleOf(page, "[data-gap]", "border-top-left-radius");
    expect(Number.parseFloat(radius ?? "0")).toBeGreaterThan(0);
  });

  test("the answer sits under a rule, with the note, the line and when it was last seen in words", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, held(4), true);
    await expect(page.getByText(/^From /)).toHaveText("From aws, line 3, last seen 4 days ago");
    const back = "[data-testid=review-back]";
    // Preflight gives every element a solid style, so the width is what draws the rule.
    expect((await styleOf(page, back, "border-top-width"))[0]).toBe("1px");
    const [rule, token] = await styleOf(page, back, "border-top-color", "--k-rule");
    expect(rule).toBe(token);
  });

  test("the source link opens the card's note with the card's line under the cursor", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, held(4), true);
    await page.getByRole("button", { name: "aws, line 3" }).click();
    await expect(page.locator(".cm-activeLine")).toContainText("What does S3 stand for?");
  });

  test("a whole note's source link names the note alone and opens it", async ({ page, stack }) => {
    const note = `---\nsr-due: ${today()}\nsr-interval: 4\nsr-ease: 250\n---\n#review\n\n# TLS\n\nthe handshake\n`;
    await sitDeck(page, stack.vault, { "03 Flashcards/TLS.md": note }, "TLS");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^From /)).toHaveText("From TLS, last seen 4 days ago");
    await page.getByRole("button", { name: "TLS", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("the handshake");
  });

  test("a new card's grades show FSRS's first-answer intervals", async ({ page, stack }) => {
    await sitAws(page, stack.vault, FRESH, true);
    await intervalsRead(page, ["1d", "2d", "3d", "8d"]);
  });

  test("a held card's grades show the interval each writes, weeks past a fortnight", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, held(10), true);
    await intervalsRead(page, ["1d", "3w", "4w", "7w"]);
  });

  test("Again is in the danger colour and Good, the default, wears a 2 px accent outline", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, FRESH, true);
    const [again, danger] = await styleOf(page, "button[data-rating=again]", "color", "--k-danger");
    expect(again).toBe(danger);
    await expect(grade(page, "Good")).toHaveAttribute("data-default");
    const good = "button[data-rating=good]";
    expect((await styleOf(page, good, "border-top-width"))[0]).toBe("2px");
    expect((await styleOf(page, "button[data-rating=hard]", "border-top-width"))[0]).toBe("1px");
    const [outline, accent] = await styleOf(page, good, "border-top-color", "--k-accent");
    expect(outline).toBe(accent);
  });

  test("the done screen says what was done and the weekday the next cards are due, and Undo brings the card back", async ({
    page,
    stack,
  }) => {
    await sitAws(page, stack.vault, FRESH, true);
    await grade(page, "Good").click();
    await expect(page.getByRole("heading", { name: "Done for today" })).toBeVisible();
    const done = page.getByTestId("review-done");
    await expect(done).toContainText("1 answered today in aws.");
    // A first Good is three days out by FSRS (#1926), which the screen names by its weekday.
    const day = new Date(`${plus(3)}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      timeZone: "UTC",
    });
    await expect(done).toContainText(`The next cards are due ${day}.`);
    await expect.poll(() => noteText(stack.vault, AWS)).toContain("<!--SR:!fsrs,");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("review-card")).toContainText("What does S3 stand for?");
    await expect.poll(async () => bodyOf(await noteText(stack.vault, AWS))).toBe(FRESH);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on the source link opens the card's note on its line", async ({ page, stack }) => {
      await vaultWith(stack.vault, { [AWS]: held(4) });
      await page.goto("/");
      await page.getByRole("button", { name: /cards? waiting$/ }).tap();
      await page.locator('button[data-deck="aws"]').tap();
      await page.getByRole("button", { name: "Show the answer" }).tap();
      await page.getByRole("button", { name: "aws, line 3" }).tap();
      await expect(page.locator(".cm-activeLine")).toContainText("What does S3 stand for?");
    });

    test("#600 A11 Undo and Center work by tap", async ({ page, stack }) => {
      await vaultWith(stack.vault, { [AWS]: FRESH });
      await page.goto("/");
      await page.getByRole("button", { name: /cards? waiting$/ }).tap();
      await page.locator('button[data-deck="aws"]').tap();
      await page.getByRole("button", { name: "Show the answer" }).tap();
      await grade(page, "Good").tap();
      await expect(page.getByTestId("review-done")).toBeVisible();
      await expect.poll(async () => bodyOf(await noteText(stack.vault, AWS))).not.toBe(FRESH);

      await page.getByRole("button", { name: "Undo" }).tap();
      await expect(page.getByTestId("review-back")).toHaveText(/Simple Storage Service/);
      await expect.poll(async () => bodyOf(await noteText(stack.vault, AWS))).toBe(FRESH);

      const center = page.getByRole("button", { name: "Center" });
      expect(await tapHeight(center)).toBeGreaterThanOrEqual(44);
      await center.tap();
      await expect(center).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("review-card")).toHaveCSS("text-align", "center");
    });
  });
});
