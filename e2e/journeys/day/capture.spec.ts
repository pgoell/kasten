import type { Locator, Page } from "@playwright/test";
import { leader, noteText, openApp, phone, runCommand, today } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const THOUGHT = "call the plumber about the tap";

const dailyText = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

// The thought is the line under the dump heading, as the capture doc says it lands.
const UNDER_DUMP = new RegExp(`^## Dump\\n[\\s\\S]*^${THOUGHT}$`, "m");

test("a thought typed into the dump prompt lands under ## Dump in today's note", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "cd");
  const prompt = page.getByRole("dialog", { name: "Capture a thought" });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("dump").fill(THOUGHT);
  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
});

/** Opens the prompt by its keys over a note, after a typed key proves the focus sits in the field. */
async function openPrompt(page: Page): Promise<Locator> {
  await openApp(page);
  await leader(page, "cd");
  const prompt = page.getByRole("dialog", { name: "Capture a thought" });
  await expect(prompt).toBeVisible();
  return prompt;
}

/** Counts the dumps the page sends and keeps their text. */
function dumpsSent(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/dump")
      sent.push(request.postDataJSON().text);
  });
  return sent;
}

test.describe("the dump prompt", () => {
  test("takes the keys typed into it, names today, and sends the thought trimmed", async ({
    page,
    stack,
  }) => {
    const sent = dumpsSent(page);
    const prompt = await openPrompt(page);
    await expect(prompt).toContainText(`into ## Dump of ${today()}`);
    // Typed, not filled: fill focuses the field itself and would hide a prompt that took no focus.
    await page.keyboard.type(`  ${THOUGHT}  `);
    await expect(prompt.getByLabel("dump")).toHaveValue(`  ${THOUGHT}  `);
    await page.keyboard.press("Enter");
    await expect(prompt).toBeHidden();
    await expect(page.locator(".cm-content")).toBeFocused();
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
    expect(sent).toEqual([THOUGHT]);
    await expect(page.getByTestId("notice")).toHaveText("Captured into today's dump");
  });

  test("sends nothing on Enter with only blanks typed, and stays open for the thought", async ({
    page,
    stack,
  }) => {
    const sent = dumpsSent(page);
    const prompt = await openPrompt(page);
    await page.keyboard.type("   ");
    await page.keyboard.press("Enter");
    await expect(prompt).toBeVisible();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(THOUGHT);
    await page.keyboard.press("Enter");
    await expect(prompt).toBeHidden();
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
    expect(sent).toEqual([THOUGHT]);
  });

  test("shuts on Escape with nothing sent and the focus back in the editor", async ({
    page,
    stack,
  }) => {
    const sent = dumpsSent(page);
    const prompt = await openPrompt(page);
    await page.keyboard.type("half a thought");
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
    await expect(page.locator(".cm-content")).toBeFocused();
    // Opened again, it starts empty, and the next thought is the only one sent.
    await leader(page, "cd");
    await expect(prompt.getByLabel("dump")).toHaveValue("");
    await page.keyboard.type(THOUGHT);
    await page.keyboard.press("Enter");
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
    expect(sent).toEqual([THOUGHT]);
    expect(await dailyText(stack.vault)).not.toContain("half a thought");
  });

  /** Types `thought` into a fresh prompt and sends it. */
  async function dump(page: Page, thought: string) {
    await leader(page, "cd");
    await page.getByRole("dialog", { name: "Capture a thought" }).getByLabel("dump").fill(thought);
    await page.keyboard.press("Enter");
  }

  test("says the thought waits, and how many do, when it cannot be sent", async ({
    page,
    context,
  }) => {
    await openApp(page);
    await context.setOffline(true);
    await dump(page, "an older one");
    await expect(page.getByTestId("notice")).toHaveText("Captured, waiting to send (1 waiting)");
    await dump(page, THOUGHT);
    await expect(page.getByTestId("notice")).toHaveText("Captured, waiting to send (2 waiting)");
  });

  for (const [name, answer, notice] of [
    [
      "the vault's refusal",
      { status: 400, json: { detail: "Nothing to capture" } },
      "Nothing to capture",
    ],
    [
      "to sign in again after a 401",
      { status: 401, body: "" },
      "Captured, waiting to send: sign in again",
    ],
  ] as const)
    test(`says ${name} where the confirmation would have been`, async ({ page }) => {
      await page.route("**/api/dump", (route) => route.fulfill(answer));
      await openApp(page);
      await dump(page, THOUGHT);
      await expect(page.getByTestId("notice")).toHaveText(notice);
    });

  test("says why when the thought cannot be kept, and sends nothing", async ({ page }) => {
    // The browser refuses the outbox's write, as a full disk does.
    await page.addInitScript(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name !== "dumps") return add.apply(this, args);
        throw new DOMException("The quota has been exceeded", "QuotaExceededError");
      };
    });
    const sent = dumpsSent(page);
    await openApp(page);
    await dump(page, THOUGHT);
    await expect(page.getByTestId("notice")).toHaveText("The quota has been exceeded");
    await expect(page.getByRole("dialog", { name: "Capture a thought" })).toBeHidden();
    expect(sent).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a thought sent from the command palette lands under ## Dump in today's note", async ({
    page,
    stack,
  }) => {
    // A phone has no file tree to wait on, so the thumb row is what shows the app is up.
    await page.goto("/");
    await runCommand(page, /Capture a thought/, "capture");
    const prompt = page.getByRole("dialog", { name: "Capture a thought" });
    await expect(prompt).toBeVisible();
    await prompt.getByLabel("dump").fill(THOUGHT);
    await page.keyboard.press("Enter");
    await expect(prompt).toBeHidden();
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
  });
});

test.describe("the capture page", () => {
  test.use(phone);

  const PAGE =
    "<html><head><title>A post</title></head><body><article><p>Long enough to be read as the article. Long enough to be read.</p></article></body></html>";
  const field = (page: Page) => page.getByRole("textbox", { name: "What is on your mind" });
  const send = (page: Page) => page.getByRole("button", { name: "Send" });
  const sentList = (page: Page) => page.getByRole("list", { name: "Sent" });
  const waitingList = (page: Page) => page.getByRole("list", { name: "Waiting" });

  /** Opens `/capture` at `query`, once its box is drawn. */
  async function capture(page: Page, query = ""): Promise<Locator> {
    await page.goto(`/capture${query}`);
    await expect(field(page)).toBeVisible({ timeout: 15_000 });
    return field(page);
  }

  test("opens on an empty box with the focus in it, today's date above, Send off and no clip", async ({
    page,
  }) => {
    const box = await capture(page);
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");
    await expect(page.getByText(today())).toBeVisible();
    await expect(send(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Clip to inbox" })).toHaveCount(0);
  });

  test("sends the thought trimmed for this browser's day, lists it under Sent, and empties the box", async ({
    page,
    stack,
  }) => {
    const sent = dumpsSent(page);
    const box = await capture(page);
    await box.fill(`  ${THOUGHT} \n`);
    await send(page).tap();
    await expect(box).toHaveValue("");
    await expect(sentList(page)).toContainText(THOUGHT);
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
    expect(sent).toEqual([THOUGHT]);
  });

  test("brings back a draft the page was closed on, and drops it once sent", async ({ page }) => {
    const box = await capture(page);
    await box.fill("half a thought");
    await page.reload();
    await expect(field(page)).toHaveValue("half a thought", { timeout: 15_000 });
    await send(page).tap();
    await expect(sentList(page)).toContainText("half a thought");
    await expect(field(page)).toHaveValue("");
    await page.reload();
    await expect(field(page)).toBeVisible({ timeout: 15_000 });
    await expect(field(page)).toHaveValue("");
  });

  test("leaves a stored draft alone while a share is in the box, and brings it back after", async ({
    page,
  }) => {
    await (await capture(page)).fill("half thought");
    const box = await capture(page, "?text=https%3A%2F%2Fx");
    await expect(box).toHaveValue("https://x");
    await box.fill("https://x edited");
    await send(page).tap();
    await expect(sentList(page)).toContainText("https://x edited");
    await expect(box).toHaveValue("half thought");
    await capture(page);
    await expect(field(page)).toHaveValue("half thought");
  });

  test("keeps a refused thought waiting and says why", async ({ page }) => {
    await page.route("**/api/dump", (route) =>
      route.fulfill({ status: 400, json: { detail: "Nothing to capture" } }),
    );
    const box = await capture(page);
    await box.fill("on a train");
    await send(page).tap();
    await expect(page.getByRole("alert")).toContainText("Nothing to capture");
    await expect(waitingList(page)).toContainText("on a train");
    await expect(box).toHaveValue("");
  });

  test("keeps a thought sent with no signal under Waiting, and sends it when the signal returns", async ({
    page,
    context,
    stack,
  }) => {
    const box = await capture(page);
    await context.setOffline(true);
    await box.fill(THOUGHT);
    await send(page).tap();
    const row = waitingList(page).getByRole("listitem").filter({ hasText: THOUGHT });
    await expect(row).toContainText(today());
    await expect(row).toContainText("waiting");
    await expect(box).toHaveValue("");
    await expect(sentList(page)).toHaveCount(0);
    await context.setOffline(false);
    await expect(sentList(page)).toContainText(THOUGHT, { timeout: 15_000 });
    await expect(waitingList(page)).toHaveCount(0);
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
  });

  for (const [name, answer] of [
    ["the proxy's redirect", { status: 302, headers: { Location: "/oauth2/sign_in" } }],
    ["a 401", { status: 401, body: "" }],
  ] as const)
    test(`says to sign in again after ${name}, the thought kept waiting`, async ({ page }) => {
      await page.route("**/api/dump", (route) => route.fulfill(answer));
      const box = await capture(page);
      await box.fill("behind the proxy");
      await send(page).tap();
      await expect(page.getByRole("status")).toContainText("Waiting: sign in again");
      await expect(page.getByRole("link", { name: "sign in again" })).toHaveAttribute("href", "/");
      await expect(waitingList(page)).toContainText("behind the proxy");
    });

  test("fills the box from a share, and drops the share from the address once it is sent", async ({
    page,
  }) => {
    const box = await capture(
      page,
      "?title=A%20post&text=https%3A%2F%2Fa.b%2Fc&url=https%3A%2F%2Fa.b%2Fc",
    );
    await expect(box).toHaveValue("A post\nhttps://a.b/c");
    await send(page).tap();
    await expect(sentList(page)).toContainText("A post");
    await expect(page).toHaveURL(/\/capture$/);
  });

  test("clips a shared page into the inbox the way the import key does, and sends no dump", async ({
    page,
    stack,
  }) => {
    const sent = dumpsSent(page);
    await page.route(
      (url) => url.pathname === "/api/fetch",
      (route) => route.fulfill({ json: { url: "https://a.b/c", html: PAGE } }),
    );
    await capture(page, "?text=https%3A%2F%2Fa.b%2Fc");
    await page.getByRole("button", { name: "Clip to inbox" }).tap();
    await expect(sentList(page)).toContainText("clipped to 00 Inbox/A post.md");
    expect(await noteText(stack.vault, "00 Inbox/A post.md")).toContain("type: Source");
    expect(sent).toEqual([]);
  });

  test("says where the files of a share went, and that they did not go with no signal", async ({
    page,
  }) => {
    for (const [query, words] of [
      [
        "?receipts=1&refused=1",
        "1 receipt kept for tax, waiting under Finance, To sort; 1 refused",
      ],
      ["?title=A+page&offline=2", "2 files not sent: no signal"],
      ["?text=x&toolarge=1", "1 file too large to send"],
    ]) {
      await capture(page, query);
      await expect(page.getByRole("status")).toContainText(words);
    }
  });
});
