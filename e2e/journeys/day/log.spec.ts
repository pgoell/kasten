import { leader, noteText, openApp, phone, today } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const dailyText = (vault: string) => noteText(vault, `01 Periodic/00 Daily/${today()}.md`);

test("a beer logged in the log pane shows as an entry and lands under ## Log in today's note", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane).toBeVisible();
  await pane.getByRole("button", { name: "Log alcohol" }).click();
  await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
  await expect
    .poll(() => dailyText(stack.vault), {
      timeout: 15_000,
    })
    .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a beer tapped in the log pane opened from the palette lands under ## Log in today's note", async ({
    page,
    stack,
  }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Open the log/ }).tap();
    const pane = page.getByRole("region", { name: "Log" });
    await pane.getByRole("button", { name: "Log alcohol" }).tap();
    await expect(pane.getByRole("button", { name: "🍺 1", exact: true })).toBeVisible();
    await expect
      .poll(() => dailyText(stack.vault), { timeout: 15_000 })
      .toMatch(/^## Log\n(?:.*\n)*?- 🍺 1$/m);
  });
});
