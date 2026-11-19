import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import {
  bodyOf,
  cursorTo,
  holdStream,
  leader,
  noteText,
  openApp,
  plus,
  TODO_ROW,
  today,
  unstamped,
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
const disk = async (vault: string) => bodyOf(await noteText(vault, NOTE));
const note = (...lines: string[]) => `# Dentist\n\n${lines.join("\n")}\n`;

/** The todo pane, its cursor on the dentist's row. */
async function onDentist(page: Page, vault: string, vim = "on") {
  await vaultWith(vault, { [NOTE]: note(LINE, NEXT) });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else {
    // Space is a letter with vim off, so the palette opens the pane.
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(page.locator(TODO_ROW, { hasText: "book the checkup" })).toBeVisible();
  await cursorTo(page, "call the dentist");
}

/** Escape, then x on the dentist's row: one walk on disk proves no key before it walked the row. */
async function walkOnce(page: Page, vault: string) {
  await draft(page).focus();
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await page.keyboard.press("x");
  await expect.poll(() => disk(vault)).toBe(note(LINE.replace("[ ]", "[/]"), NEXT));
}

test("i turns the row under the cursor into its line as the vault holds it, keys in it", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await expect(draft(page)).toHaveValue(LINE);
  await expect(draft(page)).toBeFocused();
});

test("Enter writes the edited line into the note and draws a row again", async ({ page, stack }) => {
  const edited = "- [/] call the dentist at nine 📅 2026-01-07 ⏫ #health";
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect.poll(() => disk(stack.vault)).toBe(note(edited, NEXT));
  await expect(draft(page)).toHaveCount(0);
  await expect(page.locator(TODO_ROW, { hasText: "call the dentist at nine" })).toBeVisible();
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
  await expect.poll(() => disk(stack.vault)).toBe(note(LINE, NEXT.replace("[ ]", "[/]")));
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
          document.body.dataset.focused = document.activeElement?.getAttribute("data-row") ?? "none";
        });
        seen.observe(document.body, { childList: true, subtree: true });
      });
      await page.keyboard.press(key);
      await expect(page.locator("body")).toHaveAttribute("data-focused", row ?? "");
    });

test("x and a typed into the edit line are letters, not the list's keys", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("x");
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveValue(`${LINE}xa`);
  await expect(page.getByRole("dialog", { name: "Add todo" })).toHaveCount(0);
  await walkOnce(page, stack.vault);
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
  await hints(page).filter({ hasText: "⏳ scheduled" }).click();
  await expect(draft(page)).toHaveValue(`${LINE} ⏳ `);
  await expect(hints(page).nth(0)).toHaveText(`${today()} today`);
  await expect(hints(page).nth(1)).toHaveText(`${plus(1)} tomorrow`);
  await hints(page).nth(1).click();
  await expect(draft(page)).toHaveValue(`${LINE} ⏳ ${plus(1)}`);
  await expect(draft(page)).toBeFocused();
});

test("x on a hint the Tab key reached is not the list's x", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("Tab");
  await expect(hints(page).first()).toBeFocused();
  await page.keyboard.press("x");
  await walkOnce(page, stack.vault);
});

test("i with no row in the list opens no edit line and throws nothing", async ({ page, stack }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const plain = "# Plain\n\nno todos here\n";
  await vaultWith(stack.vault, {
    "02 Projects/Home.md": plain,
    "02 Projects/Garden.md": plain,
    "Long note.md": plain,
  });
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
  await expect.poll(() => disk(stack.vault)).toBe(note(edited, NEXT));
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Todos" }).locator(":focus")).toHaveCount(1);
});

test("a folder renamed and a note deleted from outside move the board's card to the lane they leave it in", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "02 Projects/FDE/Kickoff.md": "# Kickoff\n",
    "01 Notes/Deck.md": "# Deck\n\n- [ ] send deck [[Kickoff]]\n",
  });
  await openApp(page);
  await leader(page, "gt");
  await page.keyboard.press("c");
  await page.keyboard.press("g");
  const lane = (name: string) =>
    page.locator("h3:has(button[data-count])", { hasText: new RegExp(`^${name}$`) }).locator("..");
  await expect(lane("FDE")).toContainText("send deck");
  await rename(join(stack.vault, "02 Projects/FDE"), join(stack.vault, "02 Projects/FDE Client"));
  await expect(lane("FDE Client")).toContainText("send deck");
  await rm(join(stack.vault, "02 Projects/FDE Client/Kickoff.md"));
  await expect(lane("No project")).toContainText("send deck");
});
test.describe("@ sends the cursor's todo to the agent (#523)", () => {
  const AT = "02 Projects/Agent.md";
  const SEND = "- [ ] send the deck 📅 2026-10-20";
  const TAGGED = "- [ ] send the deck #agent 📅 2026-10-20";
  const FOOS = ["- [ ] foo", "- [ ] foo #agent"];
  const CHANGED = "that line has changed since it was listed";
  const CLIENT = "the agent skips client work";
  const text = (lines: string[] | string) => (typeof lines === "string" ? lines : `# Agent\n\n${lines.join("\n")}\n`);
  const row = (page: Page, words: string) => page.locator(TODO_ROW, { hasText: words });
  const disk = async (vault: string) => bodyOf(await noteText(vault, AT));
  const notice = (page: Page) => page.getByTestId("notice");
  type Opts = { moved?: string[]; held?: boolean; vim?: string; put?: (route: Route) => Promise<void> };

  /** The pane over `lines` with the event stream held; `moved` lands on disk once listed, `held` holds every later listing. */
  async function agentPane(page: Page, vault: string, lines: string[] | string, words: string, o: Opts = {}) {
    const puts: string[] = [];
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${AT}`,
      (route) =>
        route.request().method() !== "PUT" ? route.fallback() : (puts.push(AT), (o.put ?? ((r) => r.fallback()))(route)),
    );
    await page.route("**/api/events", () => new Promise(() => {}));
    if (o.vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(vault, { [AT]: text(lines) });
    await openApp(page);
    if (o.vim === "off") {
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: /^Open the todo pane/ }).click();
    } else await leader(page, "gt");
    await expect(row(page, words).first()).toBeVisible({ timeout: 15_000 });
    if (o.held) await page.route("**/api/todos*", () => new Promise(() => {}));
    if (o.moved) await vaultWith(vault, { [AT]: text(o.moved) });
    await cursorTo(page, words);
    return puts;
  }

  /** Nothing written: the notice says why, no PUT went out and the note is as it was. */
  async function refused(page: Page, vault: string, puts: string[], why: string, lines: string[]) {
    await expect(notice(page)).toHaveText(`Nothing moved: ${why}`);
    expect([puts, await disk(vault)]).toEqual([[], text(lines)]);
  }

  const TO: [string, string[], string[]][] = [
    ["A1 adds #agent before the fields, the next todo untouched", [SEND, "- [ ] buy milk"], [TAGGED, "- [ ] buy milk"]],
    ["A1 adds #agent to a todo in progress", ["- [/] send the deck"], ["- [/] send the deck #agent"]],
    ["A2 takes #agent off an open todo", [TAGGED], [SEND]],
  ];
  for (const [name, lines, to] of TO)
    test(name, async ({ page, stack }) => {
      await agentPane(page, stack.vault, lines, "send the deck");
      await page.keyboard.press("@");
      await expect.poll(() => disk(stack.vault)).toBe(text(to));
    });

  const NO: [string, string[], string][] = [
    ["A3 leaves a todo in progress carrying #agent and says so", ["- [/] send the deck #agent"], "that todo is already with the agent"],
    ["A5 a #client todo writes nothing and says why", ["- [ ] send the deck #client"], CLIENT],
    ["A5 a part of a #client todo writes nothing and says why", ["- [ ] the job #client", "  - [ ] send the deck"], CLIENT],
  ];
  for (const [name, lines, why] of NO)
    test(name, async ({ page, stack }) => {
      const puts = await agentPane(page, stack.vault, lines, "send the deck");
      await page.keyboard.press("@");
      await refused(page, stack.vault, puts, why, lines);
    });

  test("vim off, @ adds #agent too", async ({ page, stack }) => {
    await agentPane(page, stack.vault, [SEND], "send the deck", { vim: "off" });
    await page.keyboard.press("@");
    await expect.poll(() => disk(stack.vault)).toBe(text([TAGGED]));
  });

  test("A7 changes the tag and not one other byte of the note", async ({ page, stack }) => {
    const line = "- [ ] send the deck #p/fde ⏫ 📅 2026-10-20 🆔 kt-abc123";
    const all = `---\ntype: Note\ntitle: Agent\n---\n## TODOs\n${line}\n  - [ ] draw the chart\n\nSome prose with #agent in it.\n`;
    await agentPane(page, stack.vault, all, "send the deck");
    await page.keyboard.press("@");
    const want = all.replace("#p/fde ⏫", "#p/fde #agent ⏫");
    await expect.poll(async () => unstamped(await noteText(stack.vault, AT))).toBe(want);
  });

  test("A8 I3 writes nothing while the note holds text not yet saved", async ({ page, stack }) => {
    await page.addInitScript((path) => {
      const entry = { content: "typed", reason: "PUT failed with 500", conflicted: false };
      localStorage.setItem("kasten.held.2", JSON.stringify({ [path]: [entry] }));
    }, AT);
    const puts = await agentPane(page, stack.vault, [SEND], "send the deck");
    await page.keyboard.press("@");
    await refused(page, stack.vault, puts, `${AT} holds text not yet saved`, [SEND]);
  });

  test("A8 I3 a write the vault refuses says Nothing moved and why", async ({ page, stack }) => {
    const put = (route: Route) => route.fulfill({ status: 500, json: { detail: "refused by the test" } });
    await agentPane(page, stack.vault, [SEND], "send the deck", { put });
    await page.keyboard.press("@");
    await expect(notice(page)).toHaveText(/^Nothing moved: .*500/);
    expect(await disk(stack.vault)).toBe(text([SEND]));
  });

  test("A10 the palette over the pane sends the cursor's todo, and over a note lists no such row", async ({
    page,
    stack,
  }) => {
    await agentPane(page, stack.vault, [SEND], "send the deck");
    await leader(page, ":");
    await page.getByRole("option", { name: /^Send the todo under the cursor to the agent/ }).click();
    await expect.poll(() => disk(stack.vault)).toBe(text([TAGGED]));
    await page.keyboard.press("Enter");
    await expect(page.locator(".cm-activeLine")).toContainText("send the deck");
    await page.keyboard.press("Escape");
    await leader(page, ":");
    await expect(page.getByRole("option", { name: /^Send this todo to the agent/ })).toHaveCount(1);
    await expect(page.getByRole("option", { name: /^Send the todo under the cursor/ })).toHaveCount(0);
  });

  const STALE: [string, string[], string[], string[] | string, number?][] = [
    ["I2 tags its todo after a line was written above it", [SEND], ["- [ ] new one", SEND], ["- [ ] new one", TAGGED]],
    ["I2 on a line gone since the listing writes nothing and says so", [SEND], ["- [ ] buy milk"], CHANGED],
    ["B1 on a row whose line was deleted leaves the tag on the todo below", FOOS, [FOOS[1] ?? ""], CHANGED],
  ];
  for (const [name, lines, moved, to] of STALE)
    test(name, async ({ page, stack }) => {
      const words = lines === FOOS ? "foo" : "send the deck";
      const puts = await agentPane(page, stack.vault, lines, words, { moved });
      await page.keyboard.press("@");
      if (typeof to === "string") await refused(page, stack.vault, puts, to, moved);
      else await expect.poll(() => disk(stack.vault)).toBe(text(to));
    });

  test("I2 on a twin tags that twin after a shift", async ({ page, stack }) => {
    const twins = ["- [ ] water the fern", "- [ ] water the fern"];
    await agentPane(page, stack.vault, twins, "water the fern", { moved: ["- [ ] buy milk", ...twins] });
    await cursorTo(page, "water the fern", 1);
    await page.keyboard.press("@");
    await expect.poll(() => disk(stack.vault)).toBe(text(["- [ ] buy milk", twins[0] ?? "", "- [ ] water the fern #agent"]));
  });

  test("I5 two @ before the list redraws add the tag and take it off again", async ({ page, stack }) => {
    const puts = await agentPane(page, stack.vault, [SEND], "send the deck", { held: true });
    await page.keyboard.press("@");
    await page.keyboard.press("@");
    await expect.poll(() => puts.length).toBe(2);
    await expect.poll(() => disk(stack.vault)).toBe(text([SEND]));
  });

  // The first press's frontmatter stamp moved both twins; #2210's stamp record reads them where they went (#2188).
  test("B1 three quick @ on two rows of the same words each press their own todo", async ({ page, stack }) => {
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
    await expect.poll(() => disk(stack.vault)).toBe(text(["- [ ] foo #agent", "- [ ] foo #agent"]));
  });

  test("B2 a second @ whose line now has a twin below a deleted line writes nothing and says so", async ({
    page,
    stack,
  }) => {
    let first = true;
    // Another writer takes x out once the first write lands, before the page hears back.
    const put = async (route: Route) => {
      if (!first) return route.fallback();
      first = false;
      const response = await route.fetch();
      await vaultWith(stack.vault, { [AT]: text(["- [ ] foo #agent", "- [ ] foo #agent"]) });
      await route.fulfill({ response });
    };
    const puts = await agentPane(page, stack.vault, ["- [ ] x", ...FOOS], "foo", { held: true, put });
    await page.keyboard.press("@");
    await expect.poll(() => puts.length).toBe(1);
    await page.keyboard.press("@");
    await expect(notice(page)).toHaveText(`Nothing moved: ${CHANGED}`);
    expect([puts.length, await disk(stack.vault)]).toEqual([1, text(["- [ ] foo #agent", "- [ ] foo #agent"])]);
  });
});
