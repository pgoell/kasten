import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  phone,
  plus,
  recordEvents,
  TODO_ROW,
  today,
  todoRows,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

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
/** The GET /api/todos reads one press sends on main, its echoes muted, measured with the clock run on and held. */
const PRESS_READS = 3;
const REFUSED = /^Nothing moved: PUT .+ failed with 500$/;
const row = (page: Page, name: string) => page.locator(TODO_ROW, { hasText: name });
const struck = (page: Page, name: string) => row(page, name).locator(".line-through");
const cursorRow = (page: Page) => page.locator(`${TODO_ROW}[tabindex="0"]`);

/** The rows drawn, by the word each names, in the order drawn; the vault's other todos left out. */
const order = async (page: Page) =>
  (await todoRows(page)).texts.flatMap((text) =>
    NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).slice(0, 1),
  );

/** Lets the paused clock on by a step per read, so answers land while a press still holds the order. */
const heldRead = (page: Page) => async () => {
  await page.clock.runFor(20);
  return order(page);
};

type Open = { notes?: Record<string, string>; touch?: boolean };

/**
 * The todo pane over the Order notes. Each list answer comes rotated one further, as nothing
 * promises the backend's order, so a redraw that does not hold the order moves rows. PUTs past
 * `allow` answer 500, and one whose path holds `stall.path` lands but answers only once let go.
 */
async function openOrder(page: Page, vault: string, o: Open = {}) {
  let reads = 0;
  let gate: Promise<void> | undefined;
  const put = {
    allow: Number.POSITIVE_INFINITY,
    stall: undefined as { path: string; go: Promise<void> } | undefined,
  };
  await page.route("**/api/todos?**", async (route) => {
    const wait = gate;
    gate = undefined;
    const answer = await route.fetch();
    const hits = (await answer.json()) as unknown[];
    reads += 1;
    const turn = reads % Math.max(hits.length, 1);
    await wait;
    await route.fulfill({ response: answer, json: [...hits.slice(turn), ...hits.slice(0, turn)] });
  });
  await page.route("**/api/files/**", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    if (put.allow <= 0) return route.fulfill({ status: 500, body: "" });
    put.allow -= 1;
    const stall = put.stall;
    if (stall === undefined || !decodeURIComponent(route.request().url()).includes(stall.path))
      return route.fallback();
    const answer = await route.fetch();
    await stall.go;
    await route.fulfill({ response: answer });
  });
  const seen = await recordEvents(page);
  await vaultWith(vault, { ...NOTES, ...o.notes });
  await page.clock.install();
  if (o.touch) {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  } else {
    await openApp(page);
    await leader(page, "gt");
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
  return { reads: () => reads, seen, first: await order(page), put, holdNext };
}

/** Moves the cursor to the first Order row and stops the clock, so the order holds until the test lets it on. */
async function aim(page: Page, name: string) {
  await cursorTo(page, name);
  await page.clock.pauseAt(Date.now() + 60_000);
}

test("#947 A2 a row checked off stays in place, struck, until a beat after the last press", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault, {
    notes: { [B]: todos(...doing("echo", "foxtrot"), `- [x] kilo ✅ ${today()}`) },
  });
  await page.getByRole("button", { name: /Done this week/ }).click();
  const shown = await order(page);
  await aim(page, shown[0] ?? "");
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
  await expect.poll(() => noteText(stack.vault, A)).toContain(`- [ ] ${first[0]}`);
});

/** Presses x on the Order row `name`, waits for its writes, their echoes and the hold to let go, and counts the list reads. */
async function pressCount(
  page: Page,
  vault: string,
  o: { reads: () => number; seen: () => Promise<string> },
  name: string,
) {
  await cursorTo(page, name);
  const before = o.reads();
  await page.keyboard.press("x");
  await expect.poll(() => noteText(vault, DAILY), { timeout: 15_000 }).toContain(name);
  await expect.poll(o.seen, { timeout: 15_000 }).toContain(DAILY);
  // The echo asks nothing, so only a wait past it and the hold's beat can show a read it sent.
  await page.waitForTimeout(1500);
  return o.reads() - before;
}

test("#947 A3 one press asks the list once over, its own echoes ask nothing, a write from elsewhere asks", async ({
  page,
  stack,
}) => {
  const open = await openOrder(page, stack.vault);
  expect(await pressCount(page, stack.vault, open, open.first[0] ?? "")).toBe(PRESS_READS);
  const before = open.reads();
  await vaultWith(stack.vault, { "zz.md": "- [ ] hotel\n" });
  await expect(row(page, "hotel")).toBeVisible({ timeout: 15_000 });
  expect(open.reads() - before).toBe(1);
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
      await expect.poll(() => noteText(stack.vault, DAILY), { timeout: 15_000 }).toContain(name);
      await expect.poll(async () => (await heldRead(page)()) && struck(page, name).count()).toBe(1);
      await page.waitForTimeout(500);
      expect(await order(page)).toEqual(first);
      expect(reads() - before).toBe(PRESS_READS);
    }
  });
});

test("#947 I2 a todo added while the order is held goes to the end, and one removed goes", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault);
  await aim(page, first[0] ?? "");
  await page.keyboard.press("x");
  await vaultWith(stack.vault, { [B]: `${NOTES[B]}- [ ] hotel\n` });
  await expect.poll(heldRead(page), { timeout: 15_000 }).toEqual([...first, "hotel"]);
  await vaultWith(stack.vault, { [A]: NOTES[A].replace("- [/] charlie\n", "") });
  const left = [...first.filter((name) => name !== "charlie"), "hotel"];
  await expect.poll(heldRead(page), { timeout: 15_000 }).toEqual(left);
});

test("#947 I3b a press landing while a list read is out draws the late answer with the press in it", async ({
  page,
  stack,
}) => {
  const { first, holdNext, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  const before = reads();
  const go = holdNext();
  await vaultWith(stack.vault, { [B]: `${NOTES[B]}\n` });
  await expect.poll(reads, { timeout: 15_000 }).toBe(before + 1);
  await page.keyboard.press("x");
  await expect
    .poll(() => noteText(stack.vault, DAILY), { timeout: 15_000 })
    .toContain(first[0] ?? "");
  go();
  await page.waitForTimeout(300);
  await expect(struck(page, first[0] ?? "")).toBeVisible();
  expect(await order(page)).toEqual(first);
});

test("#947 B1 a press whose done log is refused says so and still draws its todo struck", async ({
  page,
  stack,
}) => {
  const { first, put, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  const before = reads();
  put.allow = 1;
  await page.keyboard.press("x");
  await expect(page.getByText(REFUSED)).toBeVisible({ timeout: 15_000 });
  await expect(struck(page, first[0] ?? "")).toBeVisible();
  // The landed write's echo is muted, so only the press's own ask at its end redraws it.
  await page.waitForTimeout(1500);
  expect(reads() - before).toBe(2);
});

test("#947 B4 an edit with i during a held order puts the row where its new words put it", async ({
  page,
  stack,
}) => {
  const { first } = await openOrder(page, stack.vault);
  await aim(page, first[0] ?? "");
  await page.keyboard.press("x");
  // An edit typed before the x lands is refused, so it waits for the write; the paused clock keeps the x's hold.
  await expect
    .poll(() => noteText(stack.vault, A), { timeout: 15_000 })
    .toContain(`- [x] ${first[0]}`);
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
      .poll(() => noteText(stack.vault, A))
      .toMatch(agent ? /- \[ \] bravo/ : /bravo #agent/);
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
  await expect
    .poll(() => noteText(stack.vault, DAILY), { timeout: 15_000 })
    .toContain(first[0] ?? "");
  await vaultWith(stack.vault, { [DAILY]: `${await noteText(stack.vault, DAILY)}- [ ] kilo\n` });
  await expect(row(page, "kilo")).toBeVisible({ timeout: 15_000 });
});

const crlf = (notes: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(notes).map(([path, text]) => [path, text.replaceAll("\n", "\r\n")]),
  );

test("#947 B7 #1705 a CRLF note shows its rows, x keeps it CRLF, and the press asks the list once over", async ({
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
    await expect(row(page, name)).toHaveText(new RegExp(`^\\W*${name}$`));
  const name = open.first[0] ?? "";
  expect(await pressCount(page, stack.vault, open, name)).toBe(PRESS_READS);
  const path =
    Object.keys(NOTES).find((each) => NOTES[each as keyof typeof NOTES].includes(name)) ?? "";
  const text = await noteText(stack.vault, path);
  expect(text).toContain(`- [x] ${name}`);
  expect(text).not.toMatch(/[^\r]\n/);
});

test("#947 I3 a refused press keeps the notice and the row where it was through a redraw", async ({
  page,
  stack,
}) => {
  const { first, put, reads } = await openOrder(page, stack.vault);
  await cursorTo(page, first[0] ?? "");
  put.allow = 0;
  await page.keyboard.press("x");
  await expect(page.getByText(REFUSED)).toBeVisible({ timeout: 15_000 });
  await expect(struck(page, first[0] ?? "")).toHaveCount(0);
  put.allow = Number.POSITIVE_INFINITY;
  const before = reads();
  await vaultWith(stack.vault, { [B]: `${NOTES[B]}\n` });
  await expect.poll(reads, { timeout: 15_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  expect(await order(page)).toEqual(first);
  await expect(page.getByText(REFUSED)).toBeVisible();
});
