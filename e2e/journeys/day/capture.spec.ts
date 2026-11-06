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
