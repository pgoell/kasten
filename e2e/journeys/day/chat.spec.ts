import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Locator, Page } from "@playwright/test";
import { openApp, phone, runCommand } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/**
 * The e2e stack starts no shell container, so a node server plays the chat runner: a stream stays
 * open, each connection starts with a `reset` of `log`, and `say` writes to every open one.
 */
type Runner = {
  log: object[];
  /** Connections still to answer with a 502, as the proxy does while the shell restarts. */
  down: number;
  /** What a stream asks of the browser's own reconnect, in ms. */
  retry: number;
  /** What a POST to `/chat/*` answers. */
  answer: number;
  posts: { path: string; body: unknown }[];
  /** Streams the page asked for, counted at the route in the order the page sent them. */
  asked: number;
  streams: ServerResponse[];
  open: number;
  /** Waits for an open stream first: a pane shows before its stream reaches the runner (#2298). */
  say: (...events: object[]) => Promise<void>;
};

async function runner(page: Page): Promise<Runner> {
  const it: Runner = {
    log: [],
    down: 0,
    retry: 3_600_000,
    answer: 204,
    posts: [],
    asked: 0,
    streams: [],
    open: 0,
    say: async (...events) => {
      await expect.poll(() => it.open).toBeGreaterThan(0);
      for (const res of it.streams.filter((stream) => !stream.writableEnded && !stream.destroyed))
        for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    },
  };
  const server = createServer((_req, res) => {
    if (it.down > 0) {
      it.down -= 1;
      res.writeHead(502).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(`retry: ${it.retry}\ndata: ${JSON.stringify({ type: "reset", log: it.log })}\n\n`);
    it.streams.push(res);
    it.open += 1;
    res.on("close", () => {
      it.open -= 1;
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  page.once("close", () => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  await page.route("**/chat/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/chat/events") {
      it.asked += 1;
      return route.continue({ url });
    }
    it.posts.push({ path, body: route.request().postDataJSON() });
    return route.fulfill({ status: it.answer });
  });
  return it;
}

/** Opens the chat as a desk does, from the palette, and hands back its pane. */
async function openChat(page: Page): Promise<Locator> {
  await openApp(page);
  await runCommand(page, /^Open the chat with Claude Code/);
  const pane = page.getByRole("region", { name: "chat" });
  await expect(pane).toBeVisible();
  return pane;
}

async function chatWith(page: Page, texts: string[]): Promise<Locator> {
  const it = await runner(page);
  it.log = texts.map((text) => ({ type: "text", text }));
  await openChat(page);
  return page.getByRole("log", { name: "Conversation" });
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

const ASK = {
  type: "ask",
  id: "ask1",
  questions: [
    {
      question: "Which day?",
      header: "Day",
      multiSelect: false,
      options: [
        { label: "Today", description: "The day that is ending" },
        { label: "Yesterday", description: "The day before" },
      ],
    },
    {
      question: "Which sections?",
      header: "Sections",
      multiSelect: true,
      options: [
        { label: "Focus", description: "" },
        { label: "Errands", description: "" },
      ],
    },
  ],
};

test.describe("the chat pane and its runner", () => {
  test("C1 closing the pane closes the runner's stream", async ({ page }) => {
    const it = await runner(page);
    await openChat(page);
    await expect.poll(() => it.open).toBe(1);

    await page.keyboard.press("Space");
    await page.keyboard.press("q");
    await expect(page.getByRole("region", { name: "chat" })).toHaveCount(0);
    await expect.poll(() => it.open).toBe(0);
  });

  test("C2 each skill card sends its skill", async ({ page }) => {
    const it = await runner(page);
    const pane = await openChat(page);
    for (const skill of ["/close-day", "/process-meeting", "/meal-planner"]) {
      await pane.getByRole("button", { name: skill }).click();
    }
    await expect
      .poll(() => it.posts)
      .toEqual(
        ["/close-day", "/process-meeting", "/meal-planner"].map((text) => ({
          path: "/chat/send",
          body: { text },
        })),
      );
  });

  test("C3 Enter sends what was typed, Shift+Enter breaks the line and sends nothing", async ({
    page,
  }) => {
    const it = await runner(page);
    await openChat(page);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.click();
    await page.keyboard.type("hello");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("there");
    await expect(box).toHaveValue("hello\nthere");
    expect(it.posts).toEqual([]);

    await page.keyboard.press("Enter");
    await expect
      .poll(() => it.posts)
      .toEqual([{ path: "/chat/send", body: { text: "hello\nthere" } }]);
    await expect(box).toHaveValue("");
  });

  test("C4 a run draws the message, the text as it arrives, a folded tool call, and Stop", async ({
    page,
  }) => {
    const it = await runner(page);
    const pane = await openChat(page);
    await it.say(
      { type: "user", text: "/close-day" },
      { type: "tool", id: "t1", name: "Bash", input: { command: "rg todo /vault" } },
      { type: "tool_result", id: "t1", text: "3 matches", error: false },
      { type: "delta", text: "Three todos are" },
    );
    const log = pane.getByRole("log");
    await expect(log.getByText("/close-day")).toBeVisible();
    await expect(log.getByText("Three todos are")).toBeVisible();
    const call = log.locator("details", { hasText: "rg todo /vault" });
    await expect(call).not.toHaveAttribute("open");
    await expect(call).toContainText("3 matches");
    await expect(log.getByText("3 matches")).toBeHidden();
    await expect(pane.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  test("C5 Stop shows only during a run, and New always", async ({ page }) => {
    const it = await runner(page);
    const pane = await openChat(page);
    await it.say({ type: "user", text: "hi" });
    await pane.getByRole("button", { name: "Stop" }).click();
    await it.say({ type: "done", error: "Stopped." });

    await expect(pane.getByText("Stopped.")).toBeVisible();
    await expect(pane.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await pane.getByRole("button", { name: "New session" }).click();
    await expect.poll(() => it.posts.map((post) => post.path)).toEqual(["/chat/stop", "/chat/new"]);
  });

  test("C6 a question is a form that waits for every answer, then sends the picks", async ({
    page,
  }) => {
    const it = await runner(page);
    const pane = await openChat(page);
    await it.say({ type: "user", text: "/close-day" }, ASK);
    const send = pane.getByRole("button", { name: "Answer" });

    await expect(send).toBeDisabled();
    await pane.getByRole("radio", { name: /Today/ }).check();
    await expect(send).toBeDisabled();
    await pane.getByRole("checkbox", { name: /Focus/ }).check();
    await pane.getByRole("textbox", { name: "Other answer to: Which sections?" }).fill("Reading");
    await send.click();
    await expect
      .poll(() => it.posts)
      .toEqual([
        {
          path: "/chat/answer",
          body: {
            id: "ask1",
            answers: { "Which day?": "Today", "Which sections?": "Focus, Reading" },
          },
        },
      ]);
  });

  test("C7 an answered question shows what was asked and what was said", async ({ page }) => {
    const it = await runner(page);
    const answers = { "Which day?": "Today", "Which sections?": "Focus" };
    it.log = [ASK, { type: "answered", id: "ask1", answers }];
    const pane = await openChat(page);

    await expect(pane.getByText("Which day?")).toBeVisible();
    await expect(pane.getByText("Today", { exact: true })).toBeVisible();
    await expect(pane.getByRole("button", { name: "Answer" })).toHaveCount(0);
  });

  test("C8 a message the runner refused stays in the box, and the pane says so", async ({
    page,
  }) => {
    const it = await runner(page);
    it.answer = 403;
    await openChat(page);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("hello");
    await box.press("Enter");

    await expect(page.getByRole("alert")).toContainText("did not take that (send)");
    await expect(box).toHaveValue("hello");
  });

  test("C9 a button keeps its own keys, and Escape leads back to the pane", async ({ page }) => {
    const it = await runner(page);
    it.log = [{ type: "tool", id: "t1", name: "Bash", input: { command: "ls" } }];
    const pane = await openChat(page);

    await pane.locator("summary", { hasText: "ls" }).press("Enter");
    await expect(pane.locator("details")).toHaveAttribute("open");
    const skill = pane.getByRole("button", { name: "/close-day" });
    await skill.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("q");
    await expect
      .poll(() => it.posts)
      .toEqual([{ path: "/chat/send", body: { text: "/close-day" } }]);
    await expect(pane).toBeVisible();

    await skill.press("Escape");
    await expect(pane).toBeFocused();
  });

  test("C10 a half-filled form stays across a reconnect", async ({ page }) => {
    const it = await runner(page);
    it.retry = 100;
    it.log = [{ type: "user", text: "/close-day" }, ASK];
    const pane = await openChat(page);
    await pane.getByRole("radio", { name: /Today/ }).check();

    // The stream dropped and came back: the same run, told again from the top.
    it.streams[0].end();
    await expect.poll(() => it.streams.length).toBe(2);
    await expect(pane.getByText("Which day?")).toBeVisible();
    await expect(pane.getByRole("radio", { name: /Today/ })).toBeChecked();
  });

  test("C11 a runner that cannot be reached says so, and a 502 is asked again after the wait", async ({
    page,
  }) => {
    await page.clock.install();
    const it = await runner(page);
    it.down = 1;
    const pane = await openChat(page);
    await expect(pane.getByRole("status")).toContainText("Could not reach the chat runner");
    expect(it.streams).toHaveLength(0);

    await page.clock.runFor(3_000);
    await expect.poll(() => it.open).toBe(1);
    await expect(pane.getByRole("status")).toHaveCount(0);
  });

  test("C12 a dropped stream comes back as one stream, not two", async ({ page }) => {
    await page.clock.install();
    const it = await runner(page);
    it.retry = 100;
    await openChat(page);
    await expect.poll(() => it.open).toBe(1);

    // The browser reconnects by itself; a pane that asked as well would hold two.
    it.streams[0].end();
    await expect.poll(() => it.streams.length).toBe(2);
    await page.clock.runFor(5_000);
    // A POST sent after any stream the pane asked for in that time, so the count has seen it.
    await page.evaluate(() => fetch("/chat/sync", { method: "POST", body: "{}" }));
    expect(it.asked).toBe(2);
    expect(it.open).toBe(1);
  });

  test("C13 Space q from the pane closes it, and typed in the box is text", async ({ page }) => {
    await runner(page);
    const pane = await openChat(page);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.click();
    await page.keyboard.press("Space");
    await page.keyboard.press("q");
    await expect(box).toHaveValue(" q");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Space");
    await page.keyboard.press("q");
    await expect(pane).toHaveCount(0);
  });

  test("C14 i and Enter held with Ctrl, Alt or Meta leave the focus on the pane", async ({
    page,
  }) => {
    await runner(page);
    const pane = await openChat(page);
    await expect(pane).toBeFocused();
    for (const held of ["Control", "Alt", "Meta"]) {
      await page.keyboard.press(`${held}+i`);
      await page.keyboard.press(`${held}+Enter`);
    }
    await expect(pane).toBeFocused();
  });

  test("C15 i goes to the box, and Escape back to the pane", async ({ page }) => {
    await runner(page);
    const pane = await openChat(page);
    await expect(pane).toBeFocused();
    await page.keyboard.press("i");
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pane).toBeFocused();
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("C16 a tap on a skill card sends it", async ({ page }) => {
      const it = await runner(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Open the chat with Claude Code" }).tap();
      await page.getByRole("button", { name: "/close-day" }).tap();
      await expect
        .poll(() => it.posts)
        .toEqual([{ path: "/chat/send", body: { text: "/close-day" } }]);
    });
  });
});
