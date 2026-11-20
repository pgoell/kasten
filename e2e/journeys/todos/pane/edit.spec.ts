import type { Page, Route } from "@playwright/test";
import {
  cursorTo,
  holdStream,
  leader,
  noteText,
  openApp,
  plus,
  runCommand,
  TODO_ROW,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const NOTE = "02 Projects/Dentist.md";
// Overdue and important, so neither a due date nor a priority is a hint.
const LINE = "- [ ] call the dentist 📅 2026-01-07 ⏫ #health";
const NEXT = "- [ ] book the checkup 📅 2026-01-08";
const draft = (page: Page) => page.getByLabel("edit line");
const hints = (page: Page) => page.getByTestId("todo-hint");
const cursorRow = (page: Page) => page.locator(`${TODO_ROW}[tabindex="0"]`);
const note = (...lines: string[]) => `# Dentist\n\n${lines.join("\n")}\n`;

type Row = {
  id: string;
  words: string;
  state: string;
  tags: string[];
  planned: string | null;
  version: number;
};
/** Every todo in the store, as the pane's writes leave it. */
const rows = async (url: string): Promise<Row[]> => (await fetch(`${url}/api/todos/rows`)).json();
/** The store's todo whose words hold `words`. */
const rowOf = async (url: string, words: string) =>
  (await rows(url)).find((one) => one.words.includes(words));
const stateOf = async (url: string, words: string) => (await rowOf(url, words))?.state;
/** A todo as the line the store renders it, which the edit line starts from. */
async function lineOf(url: string, words: string): Promise<string> {
  const hits: { text: string }[] = await (await fetch(`${url}/api/todos`)).json();
  return hits.find((hit) => hit.text.includes(words))?.text ?? "";
}

/** The todo pane, its cursor on the dentist's row. */
async function onDentist(page: Page, vault: string, vim = "on") {
  await vaultWith(vault, { [NOTE]: note(LINE, NEXT) });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  // Space is a letter with vim off, so the palette opens the pane.
  else await runCommand(page, /^Open the todo pane/);
  await expect(page.locator(TODO_ROW, { hasText: "book the checkup" })).toBeVisible();
  await cursorTo(page, "call the dentist");
}

/** Escape, then x on the dentist's row: one walk in the store proves no key before it walked the row. */
async function walkOnce(page: Page, url: string) {
  await draft(page).focus();
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await page.keyboard.press("x");
  await expect.poll(() => stateOf(url, "call the dentist")).toBe("doing");
  expect(await stateOf(url, "book the checkup")).toBe("open");
}

test("i turns the row under the cursor into its line as the vault holds it, keys in it", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await expect(draft(page)).toHaveValue(await lineOf(stack.url, "call the dentist"));
  await expect(draft(page)).toBeFocused();
});

test("Enter writes the edited line into the store and draws a row again", async ({
  page,
  stack,
}) => {
  const edited = "- [/] call the dentist at nine 📅 2026-01-07 ⏫ #health";
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect.poll(() => stateOf(stack.url, "call the dentist at nine")).toBe("doing");
  expect(await stateOf(stack.url, "book the checkup")).toBe("open");
  await expect(draft(page)).toHaveCount(0);
  await expect(page.locator(TODO_ROW, { hasText: "call the dentist at nine" })).toBeVisible();
});

test("#2247 Enter over a todo changed since i opened writes nothing, says so and keeps the line; Enter again writes it", async ({
  page,
  stack,
}) => {
  const edited = "- [ ] call the dentist at ten 📅 2026-01-07 ⏫ #health";
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  const read = (await rowOf(stack.url, "call the dentist")) as Row;
  // Changed elsewhere, as by another tab; the list reads it again under the open edit.
  const relisted = page.waitForResponse(
    (answer) => new URL(answer.url()).pathname === "/api/todos" && answer.status() === 200,
  );
  const change = JSON.stringify({ version: read.version, planned: plus(1) });
  const headers = { "Content-Type": "application/json" };
  const sent = await fetch(`${stack.url}/api/todos/${read.id}`, {
    method: "PATCH",
    body: change,
    headers,
  });
  expect(sent.status, await sent.text()).toBe(200);
  // The store's own event never reaches the page (#2250); a note's write makes the list read.
  await vaultWith(stack.vault, { "zz.md": "# zz\n" });
  await relisted;
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("notice")).toHaveText(
    /^Nothing moved: kt-[0-9a-f]{6} changed since it was read/,
  );
  await expect(draft(page)).toHaveValue(edited);
  const kept = (await rowOf(stack.url, "call the dentist")) as Row;
  expect([kept.words, kept.planned]).toEqual(["call the dentist #health", plus(1)]);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await rowOf(stack.url, "dentist"))?.words)
    .toBe("call the dentist at ten #health");
});

test("Escape writes nothing and gives the keys back to the list: j moves, x walks that row", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await draft(page).fill("- [ ] something else entirely");
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await expect(cursorRow(page)).toBeFocused();
  await page.keyboard.press("j");
  await expect(cursorRow(page)).toContainText("book the checkup");
  await page.keyboard.press("x");
  await expect.poll(() => stateOf(stack.url, "book the checkup")).toBe("doing");
  expect(await rowOf(stack.url, "something else")).toBeUndefined();
  expect(await stateOf(stack.url, "call the dentist")).toBe("open");
});

for (const key of ["Escape", "Enter"])
  for (const vim of ["on", "off"])
    test(`#1515 ${key} puts the focus on the row in the commit that drops the edit line, vim ${vim}`, async ({
      page,
      stack,
    }) => {
      if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
      await onDentist(page, stack.vault, vim);
      const row = await cursorRow(page).getAttribute("data-row");
      await page.keyboard.press("i");
      await expect(draft(page)).toBeFocused();
      // Read in the observer pass that first sees the line gone, before any later task can move the focus.
      await page.evaluate(() => {
        const line = document.querySelector('[aria-label="edit line"]');
        const seen = new MutationObserver(() => {
          if (line?.isConnected) return;
          seen.disconnect();
          document.body.dataset.focused =
            document.activeElement?.getAttribute("data-row") ?? "none";
        });
        seen.observe(document.body, { childList: true, subtree: true });
      });
      await page.keyboard.press(key);
      await expect(page.locator("body")).toHaveAttribute("data-focused", row ?? "");
    });

test("x and a typed into the edit line are letters, not the list's keys", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("x");
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveValue(`${await lineOf(stack.url, "call the dentist")}xa`);
  await expect(page.getByRole("dialog", { name: "Add todo" })).toHaveCount(0);
  await walkOnce(page, stack.url);
});

test("the edit line offers the fields the line has not got", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await expect(hints(page)).toHaveText([
    "⏳ scheduled",
    "🛫 start",
    "🔁 daily",
    "🔁 weekly",
    "🔁 monthly",
    "🔁 repeat",
    "⏲ estimate",
  ]);
});

test("a hint taken writes its field, offers the days it takes next, and gives the keys back to the line", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  const line = await lineOf(stack.url, "call the dentist");
  await hints(page).filter({ hasText: "⏳ scheduled" }).click();
  await expect(draft(page)).toHaveValue(`${line} ⏳ `);
  await expect(hints(page).nth(0)).toHaveText(`${today()} today`);
  await expect(hints(page).nth(1)).toHaveText(`${plus(1)} tomorrow`);
  await hints(page).nth(1).click();
  await expect(draft(page)).toHaveValue(`${line} ⏳ ${plus(1)}`);
  await expect(draft(page)).toBeFocused();
});

test("x on a hint the Tab key reached is not the list's x", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("Tab");
  await expect(hints(page).first()).toBeFocused();
  await page.keyboard.press("x");
  await walkOnce(page, stack.url);
});

test("i with no row in the list opens no edit line and throws nothing", async ({ page, stack }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The seed vault's todos are in the store: delete them all.
  for (const one of await rows(stack.url))
    await fetch(`${stack.url}/api/todos/${one.id}`, { method: "DELETE" });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByText("nothing to do", { exact: true })).toBeVisible();
  await expect(page.locator(TODO_ROW)).toHaveCount(0);
  await page.keyboard.press("i");
  await page.keyboard.press("x");
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByTestId("notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("#2118 a write the vault's stream opened too late to see still reaches the list once it opens", async ({
  page,
  stack,
}) => {
  // The stream waits until the write has landed, so only a read at its open can show it.
  const open = await holdStream(page);
  await onDentist(page, stack.vault);
  await vaultWith(stack.vault, { [NOTE]: note(LINE.replace("call", "ring"), NEXT) });
  await expect(page.locator(TODO_ROW, { hasText: "call the dentist" })).toBeVisible();
  open();
  await expect(page.locator(TODO_ROW, { hasText: "ring the dentist" })).toBeVisible();
});

test("an edit that moves the row under another heading writes the line and keeps the keys in the pane", async ({
  page,
  stack,
}) => {
  const edited = `- [ ] call the dentist ⏳ ${today()} #health`;
  await vaultWith(stack.vault, { [NOTE]: note("- [ ] call the dentist #health", NEXT) });
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "call the dentist");
  await page.keyboard.press("i");
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await rowOf(stack.url, "call the dentist"))?.planned)
    .toBe(today());
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Todos" }).locator(":focus")).toHaveCount(1);
});

test.describe("@ sends the cursor's todo to the agent (#523)", () => {
  const AT = "02 Projects/Agent.md";
  const SEND = "- [ ] send the deck 📅 2026-10-20";
  const TAGGED = "- [ ] send the deck #agent 📅 2026-10-20";
  const FOOS = ["- [ ] foo", "- [ ] foo #agent"];
  const CLIENT = "the agent skips client work";
  const text = (lines: string[] | string) =>
    typeof lines === "string" ? lines : `# Agent\n\n${lines.join("\n")}\n`;
  const row = (page: Page, words: string) => page.locator(TODO_ROW, { hasText: words });
  const notice = (page: Page) => page.getByTestId("notice");
  /** The deck's todo: its state and whether it carries #agent. */
  const deck = async (url: string) => {
    const one = await rowOf(url, "send the deck");
    return [one?.state, one?.tags.includes("#agent")];
  };
  type Opts = { held?: boolean; vim?: string; put?: (route: Route) => Promise<void> };

  /** The pane over `lines` with the event stream held; `held` holds every later listing. Returns the line writes sent. */
  async function agentPane(
    page: Page,
    vault: string,
    lines: string[] | string,
    words: string,
    o: Opts = {},
  ) {
    const puts: string[] = [];
    await page.route("**/api/todos/*/line", (route) =>
      route.request().method() !== "PUT"
        ? route.fallback()
        : (puts.push(route.request().url()), (o.put ?? ((r) => r.fallback()))(route)),
    );
    await page.route("**/api/events", () => new Promise(() => {}));
    if (o.vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(vault, { [AT]: text(lines) });
    await openApp(page);
    if (o.vim === "off") await runCommand(page, /^Open the todo pane/);
    else await leader(page, "gt");
    await expect(row(page, words).first()).toBeVisible({ timeout: 15_000 });
    if (o.held) await page.route("**/api/todos*", () => new Promise(() => {}));
    await cursorTo(page, words);
    return puts;
  }

  const TO: [string, string[], (string | boolean)[]][] = [
    [
      "A1 adds #agent before the fields, the next todo untouched",
      [SEND, "- [ ] buy milk"],
      ["open", true],
    ],
    ["A1 adds #agent to a todo in progress", ["- [/] send the deck"], ["doing", true]],
    ["A2 takes #agent off an open todo", [TAGGED], ["open", false]],
  ];
  for (const [name, lines, to] of TO)
    test(name, async ({ page, stack }) => {
      await agentPane(page, stack.vault, lines, "send the deck");
      await page.keyboard.press("@");
      await expect.poll(() => deck(stack.url)).toEqual(to);
      if (lines.length > 1) expect((await rowOf(stack.url, "buy milk"))?.tags).toEqual([]);
    });

  const NO: [string, string[], string][] = [
    [
      "A3 leaves a todo in progress carrying #agent and says so",
      ["- [/] send the deck #agent"],
      "that todo is already with the agent",
    ],
    ["A5 a #client todo writes nothing and says why", ["- [ ] send the deck #client"], CLIENT],
    [
      "A5 a part of a #client todo writes nothing and says why",
      ["- [ ] the job #client", "  - [ ] send the deck"],
      CLIENT,
    ],
  ];
  for (const [name, lines, why] of NO)
    test(name, async ({ page, stack }) => {
      const puts = await agentPane(page, stack.vault, lines, "send the deck");
      const before = await rowOf(stack.url, "send the deck");
      await page.keyboard.press("@");
      await expect(notice(page)).toHaveText(`Nothing moved: ${why}`);
      expect([puts, await rowOf(stack.url, "send the deck")]).toEqual([[], before]);
    });

  test("vim off, @ adds #agent too", async ({ page, stack }) => {
    await agentPane(page, stack.vault, [SEND], "send the deck", { vim: "off" });
    await page.keyboard.press("@");
    await expect.poll(() => deck(stack.url)).toEqual(["open", true]);
  });

  test("A7 changes the tag and nothing else of the todo, and writes no note", async ({
    page,
    stack,
  }) => {
    const line = "- [ ] send the deck #p/fde ⏫ 📅 2026-10-20 🆔 kt-abc123";
    const all = `---\ntype: Note\ntitle: Agent\n---\n## TODOs\n${line}\n  - [ ] draw the chart\n\nSome prose with #agent in it.\n`;
    await agentPane(page, stack.vault, all, "send the deck");
    const note = await noteText(stack.vault, AT);
    const lineNow = await lineOf(stack.url, "send the deck");
    await page.keyboard.press("@");
    await expect
      .poll(() => lineOf(stack.url, "send the deck"))
      .toBe(lineNow.replace("#p/fde", "#p/fde #agent"));
    expect(await noteText(stack.vault, AT)).toBe(note);
  });

  test("A8 I3 a write the store refuses says Nothing moved and why", async ({ page, stack }) => {
    const put = (route: Route) => route.fulfill({ status: 500, json: {} });
    await agentPane(page, stack.vault, [SEND], "send the deck", { put });
    await page.keyboard.press("@");
    await expect(notice(page)).toHaveText(/^Nothing moved: .*500/);
    expect(await deck(stack.url)).toEqual(["open", false]);
  });

  test("A10 the palette over the pane sends the cursor's todo, and over a note lists no such row", async ({
    page,
    stack,
  }) => {
    await agentPane(page, stack.vault, [SEND], "send the deck");
    await leader(page, ":");
    await page
      .getByRole("option", { name: /^Send the todo under the cursor to the agent/ })
      .click();
    await expect.poll(() => deck(stack.url)).toEqual(["open", true]);
    await page.keyboard.press("Enter");
    await expect(page.locator(".cm-activeLine")).toContainText("send the deck");
    await page.keyboard.press("Escape");
    await leader(page, ":");
    await expect(page.getByRole("option", { name: /^Send this todo to the agent/ })).toHaveCount(1);
    await expect(page.getByRole("option", { name: /^Send the todo under the cursor/ })).toHaveCount(
      0,
    );
  });

  test("I5 two @ before the list redraws add the tag and take it off again", async ({
    page,
    stack,
  }) => {
    const puts = await agentPane(page, stack.vault, [SEND], "send the deck", { held: true });
    await page.keyboard.press("@");
    await page.keyboard.press("@");
    await expect.poll(() => puts.length).toBe(2);
    await expect.poll(() => deck(stack.url)).toEqual(["open", false]);
  });

  // #2188: each press names its todo by id, so none is refused.
  test("B1 three quick @ on two rows of the same words each press their own todo", async ({
    page,
    stack,
  }) => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    // Every write held until the last press, so all three queue before one lands.
    const put = async (route: Route) => {
      await gate;
      await route.fallback();
    };
    const puts = await agentPane(page, stack.vault, FOOS, "foo", { held: true, put });
    for (const key of ["j", "@", "k", "@", "j", "@"]) await page.keyboard.press(key);
    await expect.poll(() => puts.length).toBe(1);
    open();
    const foos = async () =>
      (await rows(stack.url)).filter((one) => one.words.startsWith("foo")).map((one) => one.tags);
    await expect.poll(foos).toEqual([["#agent"], ["#agent"]]);
  });
});
