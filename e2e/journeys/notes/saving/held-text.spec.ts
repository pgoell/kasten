import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp, openFromTree } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const WELCOME = "Welcome.md";
const TYPED = "Words a failed save left.";

/** Fails each PUT of Welcome while `failing()` holds; returns the count of PUTs that went out. */
async function failWelcome(page: Page, failing: () => boolean = () => true) {
  const puts = { count: 0 };
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${WELCOME}`,
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      puts.count += 1;
      if (!failing()) return route.fallback();
      await route.fulfill({ status: 500, json: { detail: "refused by the test" } });
    },
  );
  return puts;
}

/** The save sign's word, the bar's held list as label and title, or nulls; an empty tab draws no sign. */
async function bar(page: Page) {
  const sign = page.getByTestId("save-status");
  const held = page.getByTestId("held");
  const shown = (await held.count()) > 0;
  return {
    status: (await sign.count()) > 0 ? await sign.getAttribute("aria-label") : null,
    held: shown ? await held.textContent() : null,
    title: shown ? await held.getAttribute("title") : null,
  };
}

const focused = (page: Page) => page.locator(".cm-content:focus");

/** Opens Welcome from the tree and waits until its editor holds the focus. */
async function openWelcome(page: Page) {
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").first().click();
  await expect(focused(page)).toHaveCount(1);
}

/** Fails the save of typed text with vim off, then reloads, so the page before it left the text held. */
async function heldBeforeReload(page: Page) {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  let failing = true;
  const puts = await failWelcome(page, () => failing);
  await openApp(page);
  await openWelcome(page);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${TYPED}`);
  await expect.poll(async () => (await bar(page)).status).toBe("Could not save");
  // The reload's own pagehide sends it once more, which must fail too, so the route fails until the
  // page restores the note's pane on the held text.
  await page.reload();
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(async () => (await bar(page)).status).toBe("Could not save");
  // A failed write is tried again, so the route fails until the journey lets writes through.
  return {
    puts,
    pass: () => {
      failing = false;
      return puts.count;
    },
  };
}

test("a note left mid-failure stays listed through a save in another note, and reopening puts its text back, which :w writes", async ({
  page,
  stack,
}) => {
  const before = await noteText(stack.vault, WELCOME);
  let failing = true;
  const puts = await failWelcome(page, () => failing);
  await openApp(page);
  await openWelcome(page);
  await page.keyboard.type(`Go${TYPED}`);
  await page.keyboard.press("Escape");
  // A new tab flushes first; the flush fails, and the note is left holding the text.
  await leader(page, "ct");
  await expect
    .poll(async () => [(await bar(page)).held, await noteText(stack.vault, WELCOME)])
    .toEqual(["Not saved: Welcome", before]);
  const failed = puts.count;

  await openFromTree(page, "Long note");
  await page.locator(".cm-content").first().click();
  await expect(focused(page)).toHaveCount(1);
  await page.keyboard.type("GoA line in the other note.");
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () => [
        (await noteText(stack.vault, "Long note.md")).includes("A line in the other note."),
        await bar(page),
      ],
      { timeout: 15_000 },
    )
    .toEqual([true, { status: "Saved", held: "Not saved: Welcome", title: expect.any(String) }]);

  await leader(page, "th");
  await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
  await expect(focused(page)).toHaveCount(1);
  // The buffer speaks for the held text now, so the list leaves it out; opening wrote nothing.
  await expect
    .poll(async () => [
      (await focused(page).textContent())?.includes(TYPED),
      await bar(page),
      puts.count,
    ])
    .toEqual([true, { status: "Could not save", held: null, title: null }, failed]);
  expect(await noteText(stack.vault, WELCOME)).toBe(before);

  failing = false;
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () => [
        (await noteText(stack.vault, WELCOME)).includes(TYPED),
        (await bar(page)).status,
      ],
      { timeout: 15_000 },
    )
    .toEqual([true, "Saved"]);
});

test("text not yet written when the page goes away is written on pagehide", async ({
  page,
  stack,
}) => {
  await page.clock.install();
  await openApp(page);
  await openWelcome(page);
  // A paused clock holds the quiet write back, so only the hide can send the text.
  await page.clock.pauseAt(Date.now() + 1_000);
  await page.keyboard.type(`Go${TYPED}`);
  await page.keyboard.press("Escape");
  await expect(focused(page)).toContainText(TYPED);
  expect(await noteText(stack.vault, WELCOME)).not.toContain(TYPED);

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => noteText(stack.vault, WELCOME), { timeout: 15_000 }).toContain(TYPED);
});

test.describe("with vim off, text held before a reload", () => {
  test("is offered in the buffer, and the bar's Write my text writes it", async ({
    page,
    stack,
  }) => {
    const before = await noteText(stack.vault, WELCOME);
    const held = await heldBeforeReload(page);
    // The reload restores the note's pane, which opens on the held text.
    await openWelcome(page);
    await expect(page.locator(".cm-vimMode")).toHaveCount(0);
    await expect
      .poll(async () => [
        (await focused(page).textContent())?.includes(TYPED),
        (await bar(page)).status,
        await noteText(stack.vault, WELCOME),
      ])
      .toEqual([true, "Could not save", before]);

    held.pass();
    await page.getByTestId("save-status").click();
    await page.getByRole("button", { name: "Write my text" }).click();
    await expect
      .poll(
        async () => [
          (await noteText(stack.vault, WELCOME)).includes(TYPED),
          await bar(page),
          await page.evaluate(() => localStorage.getItem("kasten.held.2")),
        ],
        { timeout: 15_000 },
      )
      .toEqual([true, { status: "Saved", held: null, title: null }, null]);
  });

  test("is dropped by the bar's Drop my text, which writes nothing", async ({ page, stack }) => {
    const before = await noteText(stack.vault, WELCOME);
    const held = await heldBeforeReload(page);
    await openWelcome(page);
    await expect(focused(page)).toContainText(TYPED);

    const sent = held.pass();
    await page.getByTestId("save-status").click();
    await page.getByRole("button", { name: "Drop my text" }).click();
    await expect
      .poll(async () => [
        (await page.locator(".cm-content").first().textContent())?.includes(TYPED),
        (await bar(page)).status,
        await page.evaluate(() => localStorage.getItem("kasten.held.2")),
      ])
      .toEqual([false, "Saved", null]);
    expect([held.puts.count, await noteText(stack.vault, WELCOME)]).toEqual([sent, before]);
  });
});

/** Puts `entries` in the held store under Welcome before the app loads, as a page before a reload left it. */
async function seedHeld(page: Page, entries: object[]) {
  await page.addInitScript(
    (held) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("kasten.held.2", JSON.stringify(held));
    },
    { [WELCOME]: entries },
  );
}

test("a second held text of the open note stays listed, and only the one in the buffer leaves the list", async ({
  page,
  stack,
}) => {
  const before = await noteText(stack.vault, WELCOME);
  const hidden = {
    content: `${before}${TYPED}\n`,
    reason: "Not yet written when the page was hidden",
    conflicted: false,
  };
  const failed = { content: `${before}!\n`, reason: "PUT failed with 502", conflicted: false };
  await seedHeld(page, [hidden, failed]);
  await openApp(page);
  await openWelcome(page);
  await expect
    .poll(async () => [(await focused(page).textContent())?.includes(TYPED), await bar(page)])
    .toEqual([
      true,
      {
        status: "Could not save",
        held: "Not saved: Welcome",
        title: expect.stringMatching(/^(?!.*hidden).*Welcome\.md: PUT failed with 502/s),
      },
    ]);
  expect(await noteText(stack.vault, WELCOME)).toBe(before);
});

test("held text the vault already holds, but for its stamp, is dropped when the note opens", async ({
  page,
  stack,
}) => {
  // A keepalive write that landed after the page was gone: the file differs from what was sent by the stamp alone.
  const body = `# Welcome\n\n${TYPED}\n`;
  await writeFile(
    join(stack.vault, WELCOME),
    `---\nmodified: 2026-10-14T10:00:03+00:00\n---\n${body}`,
  );
  const on = await noteText(stack.vault, WELCOME);
  await seedHeld(page, [
    {
      content: `---\nmodified: 2026-10-14T10:00:00+00:00\n---\n${body}`,
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    },
  ]);
  const puts = await failWelcome(page, () => false);
  await openApp(page);
  await openWelcome(page);
  await expect
    .poll(async () => [
      await bar(page),
      await page.evaluate(() => localStorage.getItem("kasten.held.2")),
      puts.count,
    ])
    .toEqual([{ status: "Saved", held: null, title: null }, null, 0]);
  expect(await noteText(stack.vault, WELCOME)).toBe(on);
});
