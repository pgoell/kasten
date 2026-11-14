import type { Locator, Page } from "@playwright/test";
import { leader, noteText, openApp, phone, today } from "../../harness/app.ts";
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
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a thought sent from the command palette lands under ## Dump in today's note", async ({
    page,
    stack,
  }) => {
    // A phone has no file tree to wait on, so the thumb row is what shows the app is up.
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("combobox").fill("capture");
    await page.getByRole("option", { name: /Capture a thought/ }).tap();
    const prompt = page.getByRole("dialog", { name: "Capture a thought" });
    await expect(prompt).toBeVisible();
    await prompt.getByLabel("dump").fill(THOUGHT);
    await page.keyboard.press("Enter");
    await expect(prompt).toBeHidden();
    await expect.poll(() => dailyText(stack.vault), { timeout: 15_000 }).toMatch(UNDER_DUMP);
  });
});
