import type { Page, Route } from "@playwright/test";
import {
  findNote,
  hold,
  leader,
  noteText,
  openApp,
  openFromTree,
  openNote,
  phone,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { daily, PAST, TODAY } from "./log.ts";

const DAILY = daily(TODAY);
const DAY_TEXT = `# ${TODAY}\n\n## TODOs\n`;
const query = (page: Page) => page.locator(".cm-log-food-query:visible");
const card = (page: Page) => page.locator(".cm-log:visible");
const tab = (page: Page, name: string) => page.getByRole("tab", { name, selected: true });

/** Runs the palette's Log food row: by the leader, by ctrl shift p, or by a tap on the toolbar. */
async function logFood(page: Page, how: "leader" | "keys" | "tap" = "leader"): Promise<void> {
  if (how === "leader") await leader(page, ":");
  else if (how === "keys") await page.keyboard.press("Control+Shift+P");
  else {
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
  }
  const row = page.getByRole("option", { name: /^Log food/ });
  if (how === "tap") await row.tap();
  else await row.click();
}

/** Each PUT and POST the page sends to a note, as "METHOD path". */
function writes(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (["PUT", "POST"].includes(request.method()) && url.includes("/api/files/")) {
      sent.push(`${request.method()} ${url.split("/api/files/")[1]}`);
    }
  });
  return sent;
}

/** Routes the `method` requests to note `path`; `answer` gets each route and its count from 1. */
async function onNote(
  page: Page,
  method: string,
  path: string,
  answer: (route: Route, n: number) => Promise<void>,
): Promise<() => number> {
  let n = 0;
  await page.route(
    (url) => decodeURIComponent(url.toString()).includes(`/api/files/${path}`),
    (route) => (route.request().method() === method ? answer(route, ++n) : route.fallback()),
  );
  return () => n;
}
const refuse = (route: Route) => route.fulfill({ status: 500, body: "refused" });

/** Types `text` at the cursor of the focused editor, in vim's insert mode. */
async function type(page: Page, text: string): Promise<void> {
  await page.keyboard.press("i");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

/** Opens today's note by <leader>gd once its card draws, and finds no food search on it. */
async function noSearchOnToday(page: Page): Promise<void> {
  await leader(page, "gd");
  await expect(tab(page, TODAY)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toBeVisible();
  await expect(query(page)).toHaveCount(0);
}

for (const vim of ["on", "off"]) {
  test(`#762 B2 B3 B4 with vim ${vim}, Log food over a note makes today's note, opens it in the pane and focuses the food query`, async ({
    page,
    stack,
  }) => {
    if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openApp(page);
    await openNote(page, "Welcome");
    await logFood(page, vim === "on" ? "leader" : "keys");
    await expect(tab(page, TODAY)).toBeVisible({ timeout: 15_000 });
    await expect(query(page)).toBeFocused();
    expect(await noteText(stack.vault, DAILY)).toContain(`# ${TODAY}`);
  });
}

test.describe("on a phone", () => {
  test.use(phone);

  test("#762 B1 B7 the toolbar's run button runs Log food over the home screen and over a note, each into today's food query", async ({
    page,
  }) => {
    await page.goto("/");
    await logFood(page, "tap");
    await expect(query(page)).toBeFocused({ timeout: 15_000 });
    await expect(page.locator(".cm-content:visible")).toContainText(TODAY);

    await page.goto("/?note=Welcome.md");
    await expect(page.locator(".cm-content:visible")).toContainText("front door");
    await logFood(page, "tap");
    await expect(query(page)).toBeFocused({ timeout: 15_000 });
    await expect(page.locator(".cm-content:visible")).toContainText(TODAY);
  });
});

test("#762 I4 Log food over a past daily note's card opens the search there, with no move and no write", async ({
  page,
  stack,
}) => {
  const past = `# ${PAST}\n\n## Log\n- 💧 500 ml\n`;
  await vaultWith(stack.vault, { [daily(PAST)]: past });
  const sent = writes(page);
  await openApp(page);
  await findNote(page, PAST);
  await expect(card(page)).toBeVisible();
  await logFood(page);
  await expect(query(page)).toBeFocused();
  await expect(tab(page, PAST)).toBeVisible();
  expect(await noteText(stack.vault, daily(PAST))).toBe(past);
  expect(await noteText(stack.vault, DAILY)).toBe("");
  expect(sent).toEqual([]);
});

test("#762 I6 with the focus off today's editor, Log food opens its food search and writes nothing", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [DAILY]: DAY_TEXT });
  const sent = writes(page);
  await openApp(page);
  await findNote(page, TODAY);
  await expect(card(page)).toBeVisible();
  await page.getByRole("button", { name: "Welcome", exact: true }).focus();
  await logFood(page, "keys");
  await expect(query(page)).toBeFocused();
  expect(await noteText(stack.vault, DAILY)).toBe(DAY_TEXT);
  expect(sent).toEqual([]);
});

test("#762 I5 another note opened while today's note loads gets no food search, nor does today opened by hand", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [DAILY]: DAY_TEXT });
  await openApp(page);
  await openNote(page, "Welcome");
  const release = await hold(page, new RegExp(`/api/files/.*${TODAY}\\.md`));
  await logFood(page);
  // The tree, since the pane waits on today's note with no editor to take a leader.
  await openFromTree(page, "Long note");
  await release();
  await expect(tab(page, "Long note")).toBeVisible();
  await expect(query(page)).toHaveCount(0);
  await noSearchOnToday(page);
});

test("#762 I5 a refused save of the open note leaves nothing waiting for today's note opened by hand", async ({
  page,
  stack,
}) => {
  const refused = await onNote(page, "PUT", "Welcome.md", refuse);
  await openApp(page);
  await openNote(page, "Welcome");
  await type(page, "zq");
  await logFood(page);
  await expect.poll(refused).toBeGreaterThan(0);
  await expect(tab(page, "Welcome")).toBeVisible();
  await expect(page.locator(".cm-content:visible")).toContainText("zq");
  expect(await noteText(stack.vault, DAILY)).toBe("");
  await page.unrouteAll();
  await noSearchOnToday(page);
});

test("#762 I5 today's note with no card gets no food search, nor once a heading typed into it draws one", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [DAILY]: "## TODOs\n" });
  await openApp(page);
  await openNote(page, "Welcome");
  await logFood(page);
  await expect(tab(page, TODAY)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cm-content:visible")).toContainText("TODOs");
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("O");
  await page.keyboard.type(`# ${TODAY}`);
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeVisible();
  await expect(query(page)).toHaveCount(0);
});

test("#762 I5 a failed create of today's note leaves nothing waiting for a later <leader>gd", async ({
  page,
}) => {
  const refused = await onNote(page, "POST", DAILY, refuse);
  await openApp(page);
  await openNote(page, "Welcome");
  await logFood(page);
  await expect.poll(refused).toBe(1);
  await expect(tab(page, "Welcome")).toBeVisible();
  await expect(query(page)).toHaveCount(0);
  await page.unrouteAll();
  await noSearchOnToday(page);
});

test("#822 a failed load of today's note ends the wait, and the write on disk that loads it opens no food search", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [DAILY]: DAY_TEXT });
  let failing = true;
  await onNote(page, "GET", DAILY, (route) => (failing ? refuse(route) : route.fallback()));
  await openApp(page);
  await openNote(page, "Welcome");
  await logFood(page);
  await expect(page.getByText(`Could not open ${DAILY}`)).toBeVisible({ timeout: 15_000 });
  failing = false;
  await vaultWith(stack.vault, { [DAILY]: `${DAY_TEXT}- [ ] later\n` });
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cm-content:visible")).toContainText("later");
  await expect(query(page)).toHaveCount(0);
});

test("#822 a save refused as today's note opens leaves nothing waiting for a later <leader>gd", async ({
  page,
}) => {
  // The first save is held while a key is typed, so the save that opens today's note has text to write.
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const puts = await onNote(page, "PUT", "Welcome.md", async (route, n) => {
    if (n > 1) return refuse(route);
    await held;
    await route.fallback();
  });
  await openApp(page);
  await openNote(page, "Welcome");
  await type(page, "zq");
  await logFood(page);
  await expect.poll(puts).toBe(1);
  await type(page, "y");
  release();
  await expect.poll(puts).toBe(2);
  await expect(tab(page, "Welcome")).toBeVisible();
  await expect(query(page)).toHaveCount(0);
  await page.unrouteAll();
  await noSearchOnToday(page);
});

test("#822 a save refused after today's note is made leaves nothing waiting for a later <leader>gd", async ({
  page,
  stack,
}) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const posts = await onNote(page, "POST", DAILY, async (route) => {
    await held;
    await route.fallback();
  });
  const refused = await onNote(page, "PUT", "Welcome.md", refuse);
  await openApp(page);
  await openNote(page, "Welcome");
  await logFood(page);
  await expect.poll(posts).toBe(1);
  await type(page, "zq");
  release();
  await expect.poll(refused).toBeGreaterThan(0);
  await expect.poll(() => noteText(stack.vault, DAILY)).toContain(`# ${TODAY}`);
  await expect(tab(page, "Welcome")).toBeVisible();
  await expect(page.locator(".cm-content:visible")).toContainText("zq");
  await expect(query(page)).toHaveCount(0);
  await page.unrouteAll();
  await noSearchOnToday(page);
});
