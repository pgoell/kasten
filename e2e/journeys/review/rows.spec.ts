import type { Page } from "@playwright/test";
import {
  bodyOf,
  leader,
  noteText,
  openApp,
  phone,
  readAll,
  tapHeight,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** Opens the review pane on its overview, with the focus in it. */
async function openReview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
}

test.describe("Enter on the review pane's rows (#1166)", () => {
  test("Enter on a deck row reached by j sits that deck, and the next Enter shows the answer", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/alpha.md": "#flashcards/alpha\n\nalpha question::alpha answer\n",
      "03 Flashcards/beta.md": "#flashcards/beta\n\nbeta question::beta answer\n",
    });
    await openReview(page);
    await expect(page.locator('button[data-deck="beta"]')).toBeEnabled();

    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.locator('button[data-deck="beta"]')).toBeFocused();
    await page.keyboard.press("Enter");

    const card = page.getByTestId("review-card");
    await expect(card).toContainText("beta question");
    await expect(page.getByTestId("review-back")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-back")).toHaveText("beta answer");
  });

  test("Enter on a parked row reached by j opens its note, as o does", async ({ page, stack }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/Clouds.md":
        "#flashcards/aws\n\nWhat is a VPC?::A private cloud !suspended <!--SR:!2026-08-20,4,270-->\n",
    });
    await openReview(page);
    await page.keyboard.press("p");
    await expect(page.getByText("What is a VPC?")).toBeVisible();

    await page.keyboard.press("j");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("tab", { name: "Clouds", selected: true })).toBeVisible();
    await expect(page.locator(".cm-content").getByText("What is a VPC?")).toBeVisible();
  });

  test("Enter on a focused fold arrow neither folds it nor sits a deck", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, {
      "03 Flashcards/postgres.md":
        "#flashcards/databases/postgres\n\nWhat is MVCC?::Many versions\n",
    });
    await openReview(page);
    const toggle = page.getByRole("button", { name: "unfold databases" });
    await toggle.focus();

    await page.keyboard.press("Enter");

    // The browser turns an unstopped Enter on a button into its click, which would fold it.
    await expect(page.getByRole("button", { name: "unfold databases" })).toBeFocused();
    await expect(page.getByRole("button", { name: "fold databases", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("review-card")).toHaveCount(0);
  });
});

test.describe("the review overview's words and rows", () => {
  const ALPHA = { "03 Flashcards/alpha.md": "#flashcards/alpha\n\nalpha question::alpha answer\n" };
  const ZETA = {
    "03 Flashcards/zeta.md": "#flashcards/zeta\n\nzeta q::z <!--SR:!2026-11-05,4,250-->\n",
  };
  const DECKS = {
    ...ALPHA,
    ...ZETA,
    "03 Flashcards/pg.md":
      "#flashcards/databases/postgres\n\npg q::p <!--SR:!2026-10-20,4,250-->\n",
    "03 Flashcards/aardvark.md": "#flashcards/aardvark\n\nparked question::a !suspended\n",
  };
  const summary = (page: Page) => page.getByRole("heading", { name: "Review" }).locator("+ p");

  /** Saturday the 24th of October 2026 at noon, with the fixture's own deck emptied, so the counts are these decks'. */
  async function openDecks(page: Page, vault: string, decks: Record<string, string>) {
    await vaultWith(vault, { "03 Flashcards/Capitals.md": "# Capitals\n", ...decks });
    await page.clock.setFixedTime(new Date(2026, 9, 24, 12));
    await openReview(page);
  }

  test("counts what goes today, draws the decks with nothing due last, and opens the parked cards from their link", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, DECKS);
    await expect(summary(page)).toHaveText("2 cards to go today in 2 decks. 1 parked.");
    const zeta = page.locator('button[data-deck="zeta"]');
    await expect(zeta).toBeDisabled();
    await expect(zeta).toContainText("due next Thursday");
    await expect
      .poll(() => readAll(page, "button[data-deck]", (rows) => rows.map((row) => row.dataset.deck)))
      .toEqual(["alpha", "databases", "aardvark", "zeta"]);
    // The import sits after the last deck.
    expect(
      await zeta.evaluate((row) => {
        const entry = [...document.querySelectorAll("*")].find(
          (el) => el.textContent === "Import an Anki deck",
        );
        return entry !== undefined && !!(row.compareDocumentPosition(entry) & 4);
      }),
    ).toBe(true);

    await page.getByRole("button", { name: "unfold databases" }).click();
    await expect(page.locator('button[data-deck="databases/postgres"]')).toContainText(
      "/ postgres",
    );
    await page.getByRole("button", { name: "1 parked card" }).click();
    await expect(page.getByText("parked question")).toBeVisible();
  });

  test("Start with sits the first deck drawn with cards to go", async ({ page, stack }) => {
    await openDecks(page, stack.vault, DECKS);
    await page.getByRole("button", { name: "Start with alpha" }).click();
    await expect(page.getByTestId("review-question")).toHaveText("alpha question");
  });

  test("says card and deck in the singular, and leaves the parked part out when none is", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, ALPHA);
    await expect(summary(page)).toHaveText("1 card to go today in 1 deck.");
  });

  test("says Nothing to go today and offers no start when no card is due", async ({
    page,
    stack,
  }) => {
    await openDecks(page, stack.vault, ZETA);
    await expect(page.locator('button[data-deck="zeta"]')).toBeVisible();
    await expect(summary(page)).toHaveText("Nothing to go today.");
    await expect(page.getByRole("button", { name: /^Start with/ })).toHaveCount(0);
  });
});

test.describe("the Anki link import", () => {
  const LINK = "https://ankiweb.net/shared/info/1104981491";
  const DONE = { notes: ["Anki/AWS.md"], cards: 120, media: 2, added: 5, updated: 3 };
  const SUMMARY =
    "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki, 2 media files";
  type Answer = { status: number; detail?: string } | "hold";

  /** Answers each POST /api/anki/link with the next of `answers`, the last one over; the stack has no internet. */
  async function serveLink(page: Page, answers: Answer[]) {
    const asked: { url: string; carry: string | null }[] = [];
    await page.route(
      (url) => url.pathname === "/api/anki/link",
      async (route) => {
        const answer = answers[Math.min(asked.length, answers.length - 1)];
        const query = new URL(route.request().url()).searchParams;
        asked.push({ url: route.request().postDataJSON().url, carry: query.get("carry") });
        if (answer === "hold") return;
        const body = answer.detail ? { detail: answer.detail } : { ...DONE, kept: 110, removed: 2 };
        await route.fulfill({ status: answer.status, json: body });
      },
    );
    return asked;
  }

  /** The link field, with the import row opened under the decks. */
  async function openImport(page: Page) {
    await openReview(page);
    await page.getByText("Import an Anki deck").click();
    return page.getByLabel("a link to an Anki deck");
  }

  test("Import link sends the pasted link and shows the line a file import shows, and an empty or blank field sends nothing", async ({
    page,
  }) => {
    const asked = await serveLink(page, [{ status: 200 }]);
    const field = await openImport(page);
    const button = page.getByRole("button", { name: "Import link" });
    await button.click();
    await field.fill("   ");
    await button.click();
    await field.fill(LINK);
    await button.click();
    await expect(page.getByText(SUMMARY)).toBeVisible();
    expect(asked).toEqual([{ url: LINK, carry: null }]);
    await expect(field).toHaveValue("");
  });

  test("Enter in the field imports, carrying Anki's schedule when ticked", async ({ page }) => {
    const asked = await serveLink(page, [{ status: 200 }]);
    const field = await openImport(page);
    await page.getByRole("checkbox", { name: "Carry Anki's schedule" }).check();
    await field.fill(LINK);
    await field.press("Enter");
    await expect(page.getByText(SUMMARY)).toBeVisible();
    expect(asked).toEqual([{ url: LINK, carry: "true" }]);
  });

  test("a link that is not a URL reaches the backend, whose refusal shows word for word and keeps the link to try again", async ({
    page,
  }) => {
    const detail = "That page is not an AnkiWeb shared deck, and the link is not an .apkg";
    const asked = await serveLink(page, [{ status: 400, detail }, { status: 200 }]);
    const field = await openImport(page);
    await field.fill("ankiweb.net/shared/info/1");
    await field.press("Enter");
    await expect(page.getByText(detail, { exact: true })).toBeVisible();
    await expect(field).toHaveValue("ankiweb.net/shared/info/1");

    await page.getByRole("button", { name: "Import link" }).click();
    await expect(page.getByText(SUMMARY)).toBeVisible();
    expect(asked.map((ask) => ask.url)).toEqual(Array(2).fill("ankiweb.net/shared/info/1"));
    await expect(field).toHaveValue("");
  });

  test("a second click or Enter while importing sends no second import, the button disabled and the line saying Importing", async ({
    page,
  }) => {
    const asked = await serveLink(page, ["hold"]);
    const field = await openImport(page);
    const button = page.getByRole("button", { name: "Import link" });
    await field.fill(LINK);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(page.getByText("Importing…")).toBeVisible();
    await field.press("Enter");
    await button.click({ force: true });
    await expect.poll(() => asked.length).toBe(1);
    // Room for a second POST to reach the route, had one gone.
    await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
    expect(asked).toHaveLength(1);
  });

  test("j and p typed in the link field land in it and move nothing, while p on the pane opens the parked list", async ({
    page,
  }) => {
    const field = await openImport(page);
    await field.click();
    await page.keyboard.type("jp");
    await expect(field).toHaveValue("jp");
    await expect(field).toBeFocused();
    await expect(page.getByRole("button", { name: "← Decks" })).toHaveCount(0);

    await page.getByRole("heading", { name: "Review" }).click();
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "← Decks" })).toBeVisible();
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap imports the link, the field and button are 44 px tall and the row fits the screen", async ({
      page,
    }) => {
      const asked = await serveLink(page, [{ status: 200 }]);
      await page.goto("/");
      await page.getByRole("button", { name: "2 cards waiting" }).tap();
      await page.getByText("Import an Anki deck").tap();
      const field = page.getByLabel("a link to an Anki deck");
      const button = page.getByRole("button", { name: "Import link" });
      expect(await tapHeight(field)).toBeGreaterThanOrEqual(44);
      expect(await tapHeight(button)).toBeGreaterThanOrEqual(44);
      const right = await button.evaluate((el) => el.getBoundingClientRect().right);
      expect(right).toBeLessThanOrEqual(414);
      expect(await field.getAttribute("type")).toBe("url");

      await field.tap();
      await field.fill(LINK);
      await button.tap();
      await expect(page.getByText(SUMMARY)).toBeVisible();
      expect(asked).toEqual([{ url: LINK, carry: null }]);
    });
  });
});

test.describe("the parked list", () => {
  const SR = "<!--SR:!2026-08-20,4,270-->";
  const CLOUDS = "03 Flashcards/Clouds.md";
  const TLS = "01 Notes/tls.md";
  const CLOUDS_TEXT = `#flashcards/aws\n\nWhat is a VPC?::A private cloud !suspended ${SR}\n`;
  const CLOZE =
    "#flashcards/geo\n\n{{c1::France}} has {{c2::Paris}} !suspended <!--SR:c1!2026-08-20,4,270-->\n";
  const ESCAPED =
    "#flashcards/x\n\na\\\\-b \\*c\\*::back !suspended\n\n{{c1::d\\\\-e}} !suspended\n";
  // A token-parked card, an unanswered question, a divider nobody tagged and a note its frontmatter parks.
  const NOTES = {
    [CLOUDS]: CLOUDS_TEXT,
    "03 Flashcards/Terraform.md": "#flashcards/tf\n\nWhat is a moved block?::\n",
    "03 Flashcards/Loose.md": "Question::\n",
    [TLS]: "---\nsr-due: 2026-08-20\nsr-suspended: true\n---\n# TLS\n\n#review\n",
  };
  const rows = (page: Page) => page.locator("button[data-parked]");
  const putBack = (page: Page, note: string) => page.locator(`button[data-unpark^="${note}:"]`);
  const disk = (vault: string, note: string) => noteText(vault, note).then(bodyOf);

  async function openParked(page: Page, vault: string, notes: Record<string, string> = NOTES) {
    await vaultWith(vault, notes);
    await openReview(page);
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "← Decks" })).toBeVisible();
  }

  test("draws a row for a parked card, an unanswered question and a parked note by its name, saying why, and none for an untagged divider", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    await expect(rows(page)).toHaveText([
      "tlstlssuspended",
      "What is a VPC?awssuspended",
      "What is a moved block?tfunanswered",
    ]);
    await expect(page.getByText("Question", { exact: true })).toHaveCount(0);
    // A question with no answer has no token to take off.
    await expect(page.locator("button[data-unpark]")).toHaveCount(2);
    await expect(putBack(page, "03 Flashcards/Terraform.md")).toHaveCount(0);
  });

  test("Put back takes the token off the card's line, keeps its schedule and drops the row, and puts a note back through its frontmatter", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    await putBack(page, CLOUDS).click();
    await expect.poll(() => disk(stack.vault, CLOUDS)).toBe(CLOUDS_TEXT.replace(" !suspended", ""));
    await expect(page.getByText("What is a VPC?")).toHaveCount(0);

    await putBack(page, TLS).click();
    await expect.poll(() => noteText(stack.vault, TLS)).toContain("sr-suspended: false");
    expect(await noteText(stack.vault, TLS)).toContain("sr-due: 2026-08-20");
    await expect(rows(page)).toHaveCount(1);
  });

  test("a put back refused over a note changed on disk reads it again, says so, and the next Put back keeps the new line", async ({
    page,
    stack,
  }) => {
    const changed = `${CLOUDS_TEXT}\nsomebody else's line\n`;
    let first = true;
    // The note changes between the read and the write, so the backend refuses the base the row read.
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${CLOUDS}`,
      async (route) => {
        if (route.request().method() === "PUT" && first) {
          first = false;
          await vaultWith(stack.vault, { [CLOUDS]: changed });
        }
        await route.continue();
      },
    );
    await openParked(page, stack.vault);
    await putBack(page, CLOUDS).click();
    await expect(page.getByRole("alert")).toContainText("The note could not be written");
    await expect(putBack(page, CLOUDS)).toBeVisible();
    expect(await disk(stack.vault, CLOUDS)).toBe(changed);

    await putBack(page, CLOUDS).click();
    await expect.poll(() => disk(stack.vault, CLOUDS)).toBe(changed.replace(" !suspended", ""));
  });

  test("a parked cloze is one row by its sentence and Put back frees every number; an escaped a\\\\-b reads a\\-b", async ({
    page,
    stack,
  }) => {
    const GEO = "03 Flashcards/geo.md";
    await openParked(page, stack.vault, { [GEO]: CLOZE, "03 Flashcards/x.md": ESCAPED });
    await expect(rows(page)).toHaveText([/^France has Paris/, /^a\\-b \*c\*x/, /^d\\-ex/]);
    await putBack(page, GEO).click();
    await expect.poll(() => disk(stack.vault, GEO)).toBe(CLOZE.replace(" !suspended", ""));
    await expect(rows(page)).toHaveCount(2);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a long deck name is cut short inside the row", async ({ page, stack }) => {
      const deck = "cloud/aws/networking-and-security-groups-in-depth";
      await vaultWith(stack.vault, { [CLOUDS]: CLOUDS_TEXT.replace("aws", deck) });
      await page.goto("/");
      await page.getByRole("button", { name: /cards? waiting/ }).tap();
      await page.getByRole("button", { name: "1 parked card" }).tap();
      const row = rows(page);
      const name = row.getByText(deck);
      await expect(name).toBeVisible();
      const [box, cut] = await Promise.all([row.boundingBox(), name.boundingBox()]);
      expect(cut && box && cut.x + cut.width).toBeLessThanOrEqual(
        (box?.x ?? 0) + (box?.width ?? 0),
      );
      expect(cut?.width).toBeLessThanOrEqual((box?.width ?? 0) * 0.4 + 1);
      expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    });
  });
});
