import type { Page } from "@playwright/test";
import {
  cursorTo,
  noteText,
  openApp,
  openTodoList,
  phone,
  plus,
  recordEvents,
  TODO_ROW,
  today,
  todoRows,
  toTodoList,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, type Stack, test } from "../../../harness/stack.ts";

const NAMES = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "kilo",
  "zulu",
];
const A = "02 Projects/Order A.md";
const B = "02 Projects/Order B.md";
const DAILY = `01 Periodic/00 Daily/${today()}.md`;
const todos = (...lines: string[]) => `## TODOs\n${lines.join("\n")}\n`;
const doing = (...names: string[]) => names.map((name) => `- [/] ${name}`);
const NOTES = {
  [A]: todos(...doing("alpha", "bravo", "charlie", "delta")),
  [B]: todos(...doing("echo", "foxtrot")),
  [DAILY]: todos(...doing("golf")),
};
/** The GET /api/todos reads one press sends, its echo muted, measured with the clock run on and held. */
const PRESS_READS = 1;
const REFUSED = /^Nothing moved: POST .+ failed with 422$/;
const row = (page: Page, name: string) => page.locator(TODO_ROW, { hasText: name });
const struck = (page: Page, name: string) => row(page, name).locator(".line-through");
const cursorRow = (page: Page) => page.locator(`${TODO_ROW}[tabindex="0"]`);

/** The rows drawn, by the word each names, in the order drawn; the vault's other todos left out. */
const order = async (page: Page) =>
  (await todoRows(page)).texts.flatMap((text) =>
    // A row's text runs into its due chip, "alpha12-03", so no \b ends the word.
    NAMES.filter((name) => new RegExp(`(?<![a-z])${name}(?![a-z])`).test(text)).slice(0, 1),
  );

/** The store's row of the todo whose words hold `name`. */
const rowOf = async (stack: Stack, name: string) => {
  const rows: { id: string; words: string; state: string }[] = await (
    await fetch(`${stack.url}/api/todos/rows`)
  ).json();
  return rows.find((each) => new RegExp(`(?<![a-z])${name}(?![a-z])`).test(each.words));
};
const stateOf = async (stack: Stack, name: string) => (await rowOf(stack, name))?.state;
/** Writes `path` again with a line added, so the pane reads the list; the note holds embeds now. */
const touch = async (vault: string, path: string, line = "") =>
  vaultWith(vault, { [path]: `${await noteText(vault, path)}${line}\n` });

/** Lets the paused clock on by a step per read, so answers land while a press still holds the order. */
const heldRead = (page: Page) => async () => {
  await page.clock.runFor(20);
  return order(page);
};

type Open = { notes?: Record<string, string>; touch?: boolean };

/**
 * The todo pane over the Order notes. Each list answer comes rotated one further, as nothing
 * promises the backend's order, so a redraw that does not hold the order moves rows. While
 * `refuse.on`, the store answers a press's cycle with 422.
 */
async function openOrder(page: Page, vault: string, o: Open = {}) {
  let reads = 0;
  let out = 0;
  let gate: Promise<void> | undefined;
  const refuse = { on: false };
  await page.route("**/api/todos?**", async (route) => {
    out += 1;
    const wait = gate;
    gate = undefined;
    const answer = await route.fetch();
    const hits = (await answer.json()) as unknown[];
    reads += 1;
    const turn = reads % Math.max(hits.length, 1);
    await wait;
    await route.fulfill({ response: answer, json: [...hits.slice(turn), ...hits.slice(0, turn)] });
    out -= 1;
  });
  await page.route("**/api/todos/*/cycle", (route) =>
    refuse.on ? route.fulfill({ status: 422, json: {} }) : route.fallback(),
  );
  const seen = await recordEvents(page);
  await vaultWith(vault, { ...NOTES, ...o.notes });
  await page.clock.install();
  if (o.touch) {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
    await toTodoList(page);
  } else {
    await openApp(page);
    await openTodoList(page);
  }
  await expect(row(page, "golf")).toBeVisible({ timeout: 15_000 });
  await expect(row(page, "alpha")).toBeVisible();
  // The first reads can come in after the rows show, each rotated, so the order is read once they are in.
  await page.waitForTimeout(1000);
  /** Holds the next list answer until the returned call lets it land. */
  const holdNext = () => {
    let go = () => {};
    gate = new Promise((resolve) => {
      go = resolve;
    });
    return go;
  };
  return {
    reads: () => reads,
    idle: () => out === 0,
    seen,
    first: await order(page),
    refuse,
    holdNext,
  };
}

// A list read still out when a journey ends would throw in its handler once the page closes.
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

/** Moves the cursor to the first Order row and stops the clock, so the order holds until the test lets it on. */
async function aim(page: Page, name: string) {
  await cursorTo(page, name);
  await page.clock.pauseAt(Date.now() + 60_000);
}

test("#947 A2 a row checked off stays in place, struck, until a beat after the last press", async ({
  page,
  stack,
}) => {
  const { first, holdNext } = await openOrder(page, stack.vault, {
    notes: { [B]: todos(...doing("echo", "foxtrot"), `- [x] kilo ✅ ${today()}`) },
  });
  await page.getByRole("button", { name: /Done this week/ }).click();
  const shown = await order(page);
  await aim(page, shown[0] ?? "");
  // The press's read comes rotated: drawn after the hold lets go, it shifts the rows under the cursor (#2230).
  // So it stays out past the last check; I1, I2 and A4 draw a rotated answer under a hold.
  holdNext();
  await page.keyboard.press("x");
  await page.clock.runFor(500);
  await expect(struck(page, shown[0] ?? "")).toHaveText(shown[0] ?? "");
  await page.clock.runFor(450);
  expect(await order(page)).toEqual(shown);
  await page.clock.runFor(100);
  await expect
    .poll(async () => (await order(page)).slice(0, first.length - 1))
    .not.toContain(shown[0]);
  await expect(cursorRow(page)).toContainText(shown[1] ?? "");
});

test("#947 I1 O on a struck row reopens it in place", async ({ page, stack }) => {
  const { first } = await openOrder(page, stack.vault);
  await aim(page, first[0] ?? "");
  await page.keyboard.press("x");
  await expect
    .poll(async () => (await heldRead(page)()) && struck(page, first[0] ?? "").count())
    .toBe(1);
  await page.keyboard.press("O");
  await expect
    .poll(async () => (await heldRead(page)()) && struck(page, first[0] ?? "").count())
    .toBe(0);
  expect(await order(page)).toEqual(first);
  await expect.poll(() => stateOf(stack, first[0] ?? "")).toBe("open");
});

/** Presses x on the Order row `name`, waits for its writes, their echoes and the hold to let go, and counts the list reads. */
async function pressCount(
  page: Page,
  stack: Stack,
  o: { reads: () => number; seen: () => Promise<string> },
  name: string,
) {
  await cursorTo(page, name);
  const before = o.reads();
  await page.keyboard.press("x");
  await expect.poll(() => stateOf(stack, name), { timeout: 15_000 }).toBe("done");
  await expect.poll(o.seen, { timeout: 15_000 }).toContain('"todos"');
  // The echo asks nothing, so only a wait past it and the hold's beat can show a read it sent.
  await page.waitForTimeout(1500);
  return o.reads() - before;
}

test("#947 A3 one press asks the list once over, its own echoes ask nothing, a write from elsewhere asks", async ({
  page,
  stack,
}) => {
  const open = await openOrder(page, stack.vault);
  expect(await pressCount(page, stack, open, open.first[0] ?? "")).toBe(PRESS_READS);
  const before = open.reads();
  const writes = async () => (await open.seen()).split(`"${A}"`).length;
  const was = await writes();
  // No new todo line, so the import writes nothing back: one write, one event. A new line made two (#2266).
  await touch(stack.vault, A);
  await expect.poll(writes, { timeout: 15_000 }).toBeGreaterThan(was);
  await expect.poll(() => open.reads() - before, { timeout: 15_000 }).toBe(1);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#947 A4 three check-offs by tap keep every other row where it was, one round of reads each", async ({
    page,
    stack,
  }) => {
    const { first, reads } = await openOrder(page, stack.vault, { touch: true });
    await page.clock.pauseAt(Date.now() + 60_000);
    for (const name of first.slice(0, 3)) {
      const before = reads();
      const button = page.getByRole("button", { name: `cycle ${name}` });
      await button.tap();
      await button.tap();
      await expect.poll(() => stateOf(stack, name), { timeout: 15_000 }).toBe("done");
      await expect.poll(async () => (await heldRead(page)()) && struck(page, name).count()).toBe(1);
      await page.waitForTimeout(500);
      expect(await order(page)).toEqual(first);
      expect(reads() - before).toBe(PRESS_READS);
    }
  });
});

/** Adds a todo by the store, from elsewhere: one write, one `todos` event. */
async function add(stack: Stack, words: string) {
  const answer = await fetch(`${stack.url}/api/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ words }),
  });
  expect(answer.ok).toBe(true);
}

test("#947 I2 a todo added while the order is held goes to the end, and one removed goes", async ({
  page,
  stack,
}) => {
  const { first, reads, idle } = await openOrder(page, stack.vault);
  await aim(page, first[0] ?? "");
  const before = reads();
  await page.keyboard.press("x");
  // From elsewhere, by the store: a todo line in a note is two writes, as the import rewrites it (#2269).
  // Each waits for the list read out, so the held order meets one write at a time.
  await expect.poll(() => reads() > before && idle()).toBe(true);
  await add(stack, "hotel");
  await expect.poll(heldRead(page), { timeout: 15_000 }).toEqual([...first, "hotel"]);
  const charlie = await rowOf(stack, "charlie");
  await expect.poll(idle).toBe(true);
  await fetch(`${stack.url}/api/todos/${charlie?.id}`, { method: "DELETE" });
  const left = [...first.filter((name) => name !== "charlie"), "hotel"];
  await expect.poll(heldRead(page), { timeout: 15_000 }).toEqual(left);
});

/** Holds a list read out while two todos come from elsewhere, then lets it land: both show, by one read more. */
async function addWhileHeld(page: Page, stack: Stack, touch: boolean) {
  const open = await openOrder(page, stack.vault, { touch });
  const go = open.holdNext();
  const before = open.reads();
  await add(stack, "india");
  await expect.poll(() => open.idle(), { timeout: 15_000 }).toBe(false);
  const events = async () => (await open.seen()).split('"todos"').length;
  const was = await events();
  await add(stack, "hotel");
  await add(stack, "kilo");
  await expect.poll(events, { timeout: 15_000 }).toBeGreaterThan(was + 1);
  go();
  await expect(row(page, "hotel")).toBeVisible({ timeout: 15_000 });
  await expect(row(page, "kilo")).toBeVisible();
  await page.waitForTimeout(1500);
  // The held read, then one more for every event that came while it was out (#2273).
  expect(open.reads() - before).toBe(2);
}

test("#2273 B1 todos added from elsewhere while a list read is out show once it lands", async ({
  page,
  stack,
}) => addWhileHeld(page, stack, false));

test.describe("on a phone, by tap", () => {
  test.use(phone);

  test("#2273 B2 todos added from elsewhere while a list read is out show once it lands", async ({
    page,
    stack,
  }) => addWhileHeld(page, stack, true));
});

test("#947 I3b a press landing while a list read is out draws the late answer with the press in it", async ({
  page,
  stack,
}) => {
  const { first, holdNext, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  const before = reads();
  const go = holdNext();
  await touch(stack.vault, B);
  await expect.poll(reads, { timeout: 15_000 }).toBe(before + 1);
  await page.keyboard.press("x");
  await expect.poll(() => stateOf(stack, first[0] ?? ""), { timeout: 15_000 }).toBe("done");
  go();
  await page.waitForTimeout(300);
  await expect(struck(page, first[0] ?? "")).toBeVisible();
  expect(await order(page)).toEqual(first);
});

test("#947 B1 a press the store refuses says so, draws its todo unstruck, and asks the list once", async ({
  page,
  stack,
}) => {
  const { first, refuse, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  const before = reads();
  refuse.on = true;
  await page.keyboard.press("x");
  await expect(page.getByText(REFUSED)).toBeVisible({ timeout: 15_000 });
  await expect(struck(page, first[0] ?? "")).toHaveCount(0);
  // A refused write commits nothing, so no event comes; only the press's own ask at its end reads.
  await page.waitForTimeout(1500);
  expect(reads() - before).toBe(1);
});

test("#947 B4 an edit with i during a held order puts the row where its new words put it", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault);
  await aim(page, first[0] ?? "");
  await page.keyboard.press("x");
  // An edit typed before the x lands is refused, so it waits for the write; the paused clock keeps the x's hold.
  await expect.poll(() => stateOf(stack, first[0] ?? ""), { timeout: 15_000 }).toBe("done");
  await page.keyboard.press("j");
  await page.keyboard.press("i");
  await page.getByLabel("edit line").fill("- [/] kilo ⏫");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await heldRead(page)())[0], { timeout: 15_000 }).toBe("kilo");
});

test("#947 B3 after b during a held order no todo is struck that was not checked off", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault, {
    notes: { [B]: `${NOTES[B]}- [ ] zulu 🛫 ${plus(30)}\n` },
  });
  await aim(page, first[0] ?? "");
  await page.keyboard.press("x");
  await page.keyboard.press("j");
  await page.keyboard.press("b");
  await expect.poll(async () => (await heldRead(page)()) && row(page, "zulu").count()).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await heldRead(page)()) && row(page, "zulu").count()).toBe(0);
  for (const name of first.slice(1)) await expect(struck(page, name)).toHaveCount(0);
});

for (const agent of [false, true]) {
  test(`#947 ${agent ? "B8 @ on a #agent row" : "B2 @ on a row"} keeps it in place with the cursor on it`, async ({
    page,
    stack,
  }) => {
    const notes = {
      [A]: todos(
        "- [/] alpha",
        `- [ ] ${agent ? "#agent " : ""}bravo`,
        ...doing("charlie", "delta"),
      ),
    };
    const { first } = await openOrder(page, stack.vault, { notes });
    await aim(page, "bravo");
    await page.keyboard.press("@");
    await expect
      .poll(async () => (await rowOf(stack, "bravo"))?.words.includes("#agent"))
      .toBe(!agent);
    await expect.poll(heldRead(page)).toEqual(first);
    await expect(cursorRow(page)).toContainText("bravo");
  });
}

test("#947 B5 a todo typed into today's note right after a press reaches the pane", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  await page.keyboard.press("x");
  await expect.poll(() => stateOf(stack, first[0] ?? ""), { timeout: 15_000 }).toBe("done");
  await touch(stack.vault, DAILY, "- [ ] kilo");
  await expect(row(page, "kilo")).toBeVisible({ timeout: 15_000 });
});

const crlf = (notes: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(notes).map(([path, text]) => [path, text.replaceAll("\n", "\r\n")]),
  );

test("#947 B7 #1705 a CRLF note shows its rows and a press asks the list once over", async ({
  page,
  stack,
}) => {
  const open = await openOrder(page, stack.vault, { notes: crlf(NOTES) });
  expect([...open.first].sort()).toEqual([
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
  ]);
  for (const name of open.first)
    await expect(row(page, name)).toHaveText(new RegExp(`^\\W*${name}[\\d-]*$`));
  const name = open.first[0] ?? "";
  expect(await pressCount(page, stack, open, name)).toBe(PRESS_READS);
});

test("#947 I3 a refused press keeps the notice and the row where it was through a redraw", async ({
  page,
  stack,
}) => {
  const { first, refuse, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  refuse.on = true;
  await page.keyboard.press("x");
  await expect(page.getByText(REFUSED)).toBeVisible({ timeout: 15_000 });
  await expect(struck(page, first[0] ?? "")).toHaveCount(0);
  refuse.on = false;
  const before = reads();
  await touch(stack.vault, B);
  await expect.poll(reads, { timeout: 15_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  expect(await order(page)).toEqual(first);
  await expect(page.getByText(REFUSED)).toBeVisible();
});
