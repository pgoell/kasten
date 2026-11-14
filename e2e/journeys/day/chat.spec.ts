import type { Locator, Page } from "@playwright/test";
import { openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/**
 * The e2e stack starts no shell container, so the route answers the runner's stream with one
 * `reset`; `retry` holds off a reconnect.
 */
async function chatWith(page: Page, texts: string[]): Promise<Locator> {
  const log = texts.map((text) => ({ type: "text", text }));
  await page.route("**/chat/events", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: `retry: 3600000\ndata: ${JSON.stringify({ type: "reset", log })}\n\n`,
    }),
  );
  await openApp(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /^Open the chat with Claude Code/ }).click();
  const transcript = page.getByRole("log", { name: "Conversation" });
  await expect(transcript).toBeVisible();
  return transcript;
}

test("a reply draws its lists, bold, code, fenced blocks and tables, not the marks that spell them", async ({
  page,
}) => {
  const transcript = await chatWith(page, [
    "Done:\n\n- the **three todos**\n- a `## Focus`\n\n```\nrg todo\n```",
    "1. step\n\n   ```\n   a\n   b\n   ```",
    "> ```\n> c\n> d\n> ```",
    "| a | b |\n| - | - |\n| 1 | 2 |",
  ]);

  await expect(transcript.getByText("three todos", { exact: true })).toBeVisible();
  expect(
    await transcript.getByText("three todos", { exact: true }).evaluate((e) => e.tagName),
  ).toBe("STRONG");
  expect(await transcript.getByText("## Focus", { exact: true }).evaluate((e) => e.tagName)).toBe(
    "CODE",
  );
  await expect(transcript.locator("li")).toHaveCount(3);
  // A fenced block keeps to its own lines, under a list item and in a quote too.
  expect(await transcript.locator("pre").allTextContents()).toEqual(["rg todo", "a\nb", "c\nd"]);
  await expect(transcript.locator("th")).toHaveText(["a", "b"]);
  await expect(transcript.locator("td")).toHaveText(["1", "2"]);
  await expect(transcript).not.toContainText("**");
  await expect(transcript).not.toContainText("```");
  await expect(transcript).not.toContainText("| -");
});

test("a reply links a web address, and leaves another scheme and raw HTML as text", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const transcript = await chatWith(page, [
    "[docs](https://example.com) and [trap](javascript:alert(1))",
    "<img src=x onerror=alert(2)>",
  ]);

  await expect(transcript.getByRole("link", { name: "docs" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  await expect(transcript.getByText(/and trap/)).toBeVisible();
  await expect(transcript.getByRole("link", { name: "trap" })).toHaveCount(0);
  await expect(transcript.getByText("<img src=x onerror=alert(2)>")).toBeVisible();
  await expect(transcript.locator("img")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
