import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { leader, noteText, openApp, openNote, phone, vaultWith } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { CONFIG_PATH, daily, TODAY } from "../log.ts";

const DAILY = daily(TODAY);
const DAY_TEXT = `# ${TODAY}\n\n## TODOs\n`;
const WATER = "- 💧 water: 250 ml\n";
const TEA = "- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n";
const DEFAULTS = ["Log water", "Log coffee", "Log alcohol"];
/** The palette's drink rows in its order; `Log food` is the card's own row, not a drink. */
const drinks = (page: Page) => page.getByRole("option", { name: /^Log (?!food)/ });
const row = (page: Page, name: string) =>
  page.getByRole("option", { name: new RegExp(`^${name}`) });
const button = (page: Page, name: string) =>
  page.locator(`.cm-log:visible button[aria-label='${name}']`);
const logged = (page: Page) => page.getByText(/^Logged /);
const written = (vault: string) => noteText(vault, DAILY);

/** Writes log.md, or removes it for `null`. */
const setConfig = (vault: string, config: string | null) =>
  config === null
    ? rm(join(vault, CONFIG_PATH), { force: true })
    : vaultWith(vault, { [CONFIG_PATH]: config });

/** Writes today's note and log.md, opens today's note by its address, and puts the focus in its editor. */
async function today(page: Page, vault: string, config: string | null): Promise<void> {
  await vaultWith(vault, { [DAILY]: DAY_TEXT });
  await setConfig(vault, config);
  await page.goto(`/?note=${encodeURIComponent(DAILY)}`);
  await expect(page.locator(".cm-content:visible")).toContainText(TODAY, { timeout: 15_000 });
  await page.locator(".cm-content:visible .cm-line").last().click();
  await page.keyboard.press("Escape");
}

/** Routes each GET of log.md to `answer`, and counts them. */
async function onConfig(page: Page, answer = (route: Route) => route.fallback()) {
  let n = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${CONFIG_PATH}`,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      n += 1;
      return answer(route);
    },
  );
  return () => n;
}
const refuse = (route: Route) => route.fulfill({ status: 500, body: "refused" });
const old = (route: Route) => route.fulfill({ json: { path: CONFIG_PATH, content: WATER } });

/** Holds the vault's event stream until the returned call lets it open. */
async function holdStream(page: Page): Promise<() => void> {
  let open = () => {};
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route("**/api/events", async (route) => {
    await held;
    await route.continue();
  });
  return open;
}

const ROWS: [string, string | null, string[], boolean?][] = [
  ["#770 without log.md", null, DEFAULTS],
  ["#770 with log.md", TEA, ["Log water", "Log tea"]],
  ["#770 a log.md that fails to load", TEA, DEFAULTS, true],
  ["#770 a broken line in log.md", "- 🧃 juice: lots\n- 🍵 tea: 1 cup\n", ["Log tea"]],
];
for (const [title, config, rows, fails] of ROWS) {
  test(`${title} gives the palette exactly ${rows.join(", ")}`, async ({ page, stack }) => {
    if (fails) await onConfig(page, refuse);
    await today(page, stack.vault, config);
    await leader(page, ":");
    await expect(drinks(page)).toHaveText(rows);
  });
}

for (const vim of ["on", "off"]) {
  test(`#770 with vim ${vim}, Log tea writes - 🍵 1 cup through today's open editor, with no notice`, async ({
    page,
    stack,
  }) => {
    if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await today(page, stack.vault, TEA);
    await (vim === "on" ? leader(page, ":") : page.keyboard.press("Control+Shift+P"));
    await row(page, "Log tea").click();
    await expect.poll(() => written(stack.vault)).toContain("## Log\n- 🍵 1 cup");
    await expect(logged(page)).toHaveCount(0);
  });
}

test("#770 with the focus off today's editor and no log.md, Log water writes - 💧 250 ml through that editor", async ({
  page,
  stack,
}) => {
  await today(page, stack.vault, null);
  await page.getByRole("button", { name: "Welcome", exact: true }).focus();
  await page.keyboard.press("Control+Shift+P");
  await row(page, "Log water").click();
  await expect.poll(() => written(stack.vault)).toContain("## Log\n- 💧 250 ml");
  await expect(logged(page)).toHaveCount(0);
});

for (const [config, name, line] of [
  [TEA, "Log tea", "🍵 1 cup"],
  ["- 💧 water: 500 ml\n", "Log water", "💧 500 ml"],
]) {
  test(`#770 ${name} from another note writes - ${line} into today's note through the vault, and says so`, async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [DAILY]: DAY_TEXT, [CONFIG_PATH]: config });
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, ":");
    await row(page, name).click();
    await expect(page.getByTestId("notice")).toHaveText(`Logged ${line} into today's note`);
    expect(await written(stack.vault)).toContain(`## Log\n- ${line}`);
  });
}

test("#770 the palette logs nothing while today's note holds text not yet saved", async ({
  page,
  stack,
}) => {
  await page.addInitScript(
    (held) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("kasten.held.2", JSON.stringify(held));
    },
    { [DAILY]: [{ content: "typed", reason: "PUT failed with 500", conflicted: false }] },
  );
  await vaultWith(stack.vault, { [DAILY]: DAY_TEXT });
  await openApp(page);
  await openNote(page, "Welcome");
  await leader(page, ":");
  await row(page, "Log water").click();
  await expect(page.getByTestId("notice")).toHaveText(
    `Nothing logged: ${DAILY} holds text not yet saved`,
  );
  expect(await written(stack.vault)).toBe(DAY_TEXT);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#770 the toolbar's run button opens the palette and Log tea writes - 🍵 1 cup into today's note", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [DAILY]: DAY_TEXT, [CONFIG_PATH]: TEA });
    await page.goto(`/?note=${encodeURIComponent(DAILY)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
    await row(page, "Log tea").tap();
    await expect.poll(() => written(stack.vault)).toContain("## Log\n- 🍵 1 cup");
  });
});

test("#770 the open palette's rows follow log.md written and then removed, with no reload", async ({
  page,
  stack,
}) => {
  await today(page, stack.vault, null);
  await leader(page, ":");
  await expect(drinks(page)).toHaveText(DEFAULTS);
  await setConfig(stack.vault, TEA);
  await expect(drinks(page)).toHaveText(["Log water", "Log tea"]);
  await setConfig(stack.vault, null);
  await expect(drinks(page)).toHaveText(DEFAULTS);
});

test("#770 a failed reread of a written log.md keeps its kinds in the palette", async ({
  page,
  stack,
}) => {
  await today(page, stack.vault, TEA);
  const gets = await onConfig(page, refuse);
  await setConfig(stack.vault, WATER);
  await expect.poll(gets).toBeGreaterThan(0);
  await leader(page, ":");
  await expect(drinks(page)).toHaveText(["Log water", "Log tea"]);
});

test("#818 a log.md written while the stream is up puts its new kind on the card", async ({
  page,
  stack,
}) => {
  await today(page, stack.vault, WATER);
  await expect(button(page, "Log water")).toBeVisible();
  await expect(button(page, "Log tea")).toHaveCount(0);
  await setConfig(stack.vault, TEA);
  await expect(button(page, "Log tea")).toBeVisible();
});

test("#818 the stream's first open asks log.md no more often than the mount did", async ({
  page,
  stack,
}) => {
  const gets = await onConfig(page);
  await today(page, stack.vault, WATER);
  await expect(button(page, "Log water")).toBeVisible();
  await leader(page, ":");
  await expect(drinks(page)).toHaveText(["Log water"]);
  expect(gets()).toBe(2);
});

test.describe("before the stream opened", () => {
  test("#818 a kind added to log.md shows on the card and in the palette once it opens", async ({
    page,
    stack,
  }) => {
    const open = await holdStream(page);
    await today(page, stack.vault, WATER);
    await expect(button(page, "Log water")).toBeVisible();
    await setConfig(stack.vault, TEA);
    await expect(button(page, "Log tea")).toHaveCount(0);
    open();
    await expect(button(page, "Log tea")).toBeVisible();
    await leader(page, ":");
    await expect(row(page, "Log tea")).toBeVisible();
  });

  test("#818 a removed log.md puts the card and the palette back on the default kinds once it opens", async ({
    page,
    stack,
  }) => {
    const open = await holdStream(page);
    await today(page, stack.vault, TEA);
    await expect(button(page, "Log tea")).toBeVisible();
    await setConfig(stack.vault, null);
    open();
    await expect(button(page, "Log tea")).toHaveCount(0);
    await leader(page, ":");
    await expect(drinks(page)).toHaveText(DEFAULTS);
  });

  test("#818 a config arriving at the open keeps the food search's query text and focus", async ({
    page,
    stack,
  }) => {
    const open = await holdStream(page);
    await today(page, stack.vault, WATER);
    await button(page, "Log food").click();
    const query = page.locator(".cm-log-food-query:visible");
    await query.fill("apple");
    await expect(query).toBeFocused();
    await setConfig(stack.vault, TEA);
    open();
    await expect(button(page, "Log tea")).toBeVisible();
    await expect(query).toHaveValue("apple");
    await expect(query).toBeFocused();
  });

  test("#818 an open that cannot read log.md keeps the kinds the card and the palette have", async ({
    page,
    stack,
  }) => {
    const open = await holdStream(page);
    await today(page, stack.vault, TEA);
    await expect(button(page, "Log tea")).toBeVisible();
    const gets = await onConfig(page, refuse);
    open();
    await expect.poll(gets).toBeGreaterThan(0);
    await leader(page, ":");
    await expect(drinks(page)).toHaveText(["Log water", "Log tea"]);
    await expect(button(page, "Log tea")).toBeVisible();
  });
});

test("#818 two rereads of log.md answered out of order leave the card and the palette on the newer kinds", async ({
  page,
  stack,
}) => {
  const held: Route[] = [];
  let holding = false;
  await onConfig(page, async (route) => (holding ? void held.push(route) : route.fallback()));
  await today(page, stack.vault, WATER);
  await expect(button(page, "Log water")).toBeVisible();
  holding = true;
  await setConfig(stack.vault, TEA);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await setConfig(stack.vault, `${TEA}- ☕ coffee: 1\n`);
  await expect.poll(() => held.length).toBeGreaterThan(1);
  holding = false;
  // The newest read answers first with the vault's text, and the older ones land after it with the old kinds.
  await held.pop()?.continue();
  await expect(button(page, "Log coffee")).toBeVisible();
  for (const route of held) await old(route);
  await leader(page, ":");
  await expect(drinks(page)).toHaveText(["Log water", "Log tea", "Log coffee"]);
  await expect(button(page, "Log coffee")).toBeVisible();
});

test("#826 a log.md written while the first reads are out leaves the card and the palette on the new kinds", async ({
  page,
  stack,
}) => {
  const held: Route[] = [];
  let holding = true;
  await onConfig(page, async (route) => (holding ? void held.push(route) : route.continue()));
  await today(page, stack.vault, WATER);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const first = held.length;
  await setConfig(stack.vault, TEA);
  await expect.poll(() => held.length).toBeGreaterThan(first);
  holding = false;
  // The reads after the write know tea; the first reads land after them with the old kinds.
  for (const route of held.slice(first)) await route.continue();
  for (const route of held.slice(0, first)) await old(route);
  await leader(page, ":");
  await expect(row(page, "Log tea")).toBeVisible();
  await expect(button(page, "Log tea")).toBeVisible();
});
