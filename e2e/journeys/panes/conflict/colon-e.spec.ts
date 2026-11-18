import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, openApp, openNote, unstamped } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import {
  after,
  conflicted,
  ex,
  OUTSIDE,
  settled,
  sign,
  stillHeld,
  typed,
  welcome,
} from "./conflicted.ts";

const WELCOME = /\/api\/files\/Welcome\.md$/;

/** Each request to Welcome by method; `hold` keeps the next request of that method until `letGo` runs. */
async function watch(page: Page) {
  // `readsAtPut`: how many GETs had gone out when each PUT went.
  const sent = { GET: [] as string[], PUT: [] as string[], readsAtPut: [] as number[] };
  const holds: Partial<Record<"GET" | "PUT", { gate: Promise<void>; answer?: number }>> = {};
  const opens: Partial<Record<"GET" | "PUT", () => void>> = {};
  await page.route(
    (url) => WELCOME.test(decodeURIComponent(url.pathname)),
    async (route) => {
      const method = route.request().method();
      if (method !== "GET" && method !== "PUT") return route.fallback();
      if (method === "PUT") sent.readsAtPut.push(sent.GET.length);
      sent[method].push(method === "PUT" ? route.request().postDataJSON().content : "");
      const held = holds[method];
      if (held === undefined) return route.fallback();
      delete holds[method];
      await held.gate;
      if (held.answer !== undefined) {
        return route.fulfill({ status: held.answer, json: { detail: "refused by the test" } });
      }
      return route.fallback();
    },
  );
  const hold = (method: "GET" | "PUT", answer?: number) => {
    holds[method] = { gate: new Promise<void>((open) => (opens[method] = open)), answer };
  };
  return { sent, hold, letGo: (method: "GET" | "PUT") => opens[method]?.() };
}

const flashing = async (page: Page) =>
  (await sign(page).getAttribute("class"))?.includes("animate-flash") ?? false;

test.describe(":e and :e! on the open note", () => {
  test("text typed while the vault's answer to an outside write was on its way stays, and the next write is refused", async ({
    page,
    stack,
  }) => {
    // Every read that answers with the outside text waits at the gate: the echo of the reader's own write passes.
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let held = 0;
    await page.route(
      (url) => WELCOME.test(decodeURIComponent(url.pathname)),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const response = await route.fetch();
        if ((await response.text()).includes(OUTSIDE.trim())) {
          held += 1;
          await gate;
        }
        await route.fulfill({ response });
      },
    );
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => [await sign(page).getAttribute("aria-label"), await welcome(stack.vault)])
      .toEqual(["Saved", expect.stringContaining("typed here")]);
    await writeFile(join(stack.vault, "Welcome.md"), OUTSIDE);
    await expect.poll(() => held, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.keyboard.type("Aand more");
    await page.keyboard.press("Escape");
    open();
    await expect
      .poll(
        async () => [
          await sign(page).getAttribute("aria-label"),
          await page.locator(".cm-content", { hasText: "typed hereand more" }).count(),
          await welcome(stack.vault),
        ],
        { timeout: 15_000 },
      )
      .toEqual(["Changed on disk", 1, OUTSIDE]);
  });

  test(":e! over a conflict takes the vault's text and writes nothing", async ({ page, stack }) => {
    const { puts } = await conflicted(page, stack.vault);
    await ex(page, "e!");
    await expect
      .poll(async () => [...(await after(page, stack.vault, puts)), await page.locator(".cm-content").textContent()])
      .toEqual([settled, OUTSIDE, 1, 0, false, OUTSIDE.trim()]);
  });

  test(":e! during a write puts the vault's text back on screen and on disk once the write lands", async ({
    page,
    stack,
  }) => {
    const before = await welcome(stack.vault);
    const { sent, hold, letGo } = await watch(page);
    hold("PUT");
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await expect.poll(() => sent.PUT.length).toBe(1);
    await ex(page, "e!");
    await expect(typed(page)).toHaveCount(0);
    letGo("PUT");
    await expect
      .poll(
        async () => [
          await sign(page).getAttribute("aria-label"),
          await typed(page).count(),
          unstamped(await welcome(stack.vault)),
          sent.PUT.length,
        ],
        { timeout: 15_000 },
      )
      .toEqual(["Saved", 0, before, 2]);
  });

  test(":e! during a write that fails keeps none of its text, and :w after sends nothing", async ({
    page,
    stack,
  }) => {
    const before = await welcome(stack.vault);
    const { sent, hold, letGo } = await watch(page);
    hold("PUT", 500);
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await expect.poll(() => sent.PUT.length).toBe(1);
    await ex(page, "e!");
    await expect(typed(page)).toHaveCount(0);
    letGo("PUT");
    await expect
      .poll(
        async () => [
          await sign(page).getAttribute("aria-label"),
          sent.PUT.length,
          await stillHeld(page),
          await page.getByTestId("held").count(),
          await typed(page).count(),
        ],
        { timeout: 15_000 },
      )
      .toEqual(["Saved", 2, false, 0, 0]);
    await ex(page, "w");
    // A later edit's write marks the moment: a write from :w would go out before it.
    await page.keyboard.type("Gotyped again");
    await page.keyboard.press("Escape");
    await expect.poll(() => sent.PUT.length, { timeout: 15_000 }).toBe(3);
    expect(sent.PUT[1]).toBe(before);
    expect(sent.PUT[2]).toContain("typed again");
    expect(sent.PUT[2]).not.toContain("typed here");
  });

  test(":e with a file name reads nothing", async ({ page, stack }) => {
    const { sent } = await watch(page);
    const { puts } = await conflicted(page, stack.vault);
    const reads = sent.GET.length;
    await ex(page, "e Long note.md");
    // The write :w sends marks the moment: a read from :e would have gone out before it.
    const writes = sent.PUT.length;
    await ex(page, "w");
    await expect
      .poll(async () => [await sign(page).getAttribute("aria-label"), puts(), await typed(page).count()])
      .toEqual(["Saved", 2, 1]);
    expect(sent.readsAtPut[writes]).toBe(reads);
  });

  test(":e! with a trailing space takes the vault's text", async ({ page, stack }) => {
    const { puts } = await conflicted(page, stack.vault);
    await ex(page, "e! ");
    await expect
      .poll(async () => [...(await after(page, stack.vault, puts)), await page.locator(".cm-content").textContent()])
      .toEqual([settled, OUTSIDE, 1, 0, false, OUTSIDE.trim()]);
  });

  test(":e! with nobody else writing puts the text back and leaves no write waiting", async ({
    page,
    stack,
  }) => {
    const { sent } = await watch(page);
    await openApp(page);
    await openNote(page, "Welcome");
    const before = await page.locator(".cm-content").textContent();
    await page.keyboard.type("x:e!");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => [await page.locator(".cm-content").textContent(), await sign(page).getAttribute("aria-label")])
      .toEqual([before, "Saved"]);
    // A later edit's write marks the moment: the dropped x would have gone out before it.
    await page.keyboard.type("Gotyped here");
    await page.keyboard.press("Escape");
    await expect.poll(() => sent.PUT.length, { timeout: 15_000 }).toBe(1);
    expect(sent.PUT[0]).toContain("# Welcome");
    expect(sent.PUT[0]).toContain("typed here");
  });

  test(":e! keeps the typing and the conflict when the vault cannot be read", async ({
    page,
    stack,
  }) => {
    const { sent, hold, letGo } = await watch(page);
    const { puts } = await conflicted(page, stack.vault);
    const reads = sent.GET.length;
    hold("GET", 500);
    letGo("GET");
    await ex(page, "e!");
    await expect.poll(() => sent.GET.length).toBe(reads + 1);
    await expect
      .poll(async () => (await after(page, stack.vault, puts)).slice(0, 4))
      .toEqual([expect.objectContaining({ status: "Changed on disk" }), OUTSIDE, 1, 1]);
  });

  test(":e! over a conflict leaves nothing for :w to send and lets a new tab open", async ({
    page,
    stack,
  }) => {
    const { puts } = await conflicted(page, stack.vault);
    await ex(page, "e!");
    await expect.poll(() => after(page, stack.vault, puts)).toEqual([settled, OUTSIDE, 1, 0, false]);
    await ex(page, "w");
    await leader(page, "ct");
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect(puts()).toBe(1);
  });

  test(":e on unsaved text is refused with a flash and keeps the typing", async ({ page, stack }) => {
    const { puts } = await conflicted(page, stack.vault);
    await expect.poll(() => flashing(page)).toBe(false);
    await ex(page, "e");
    await expect
      .poll(async () => [...(await after(page, stack.vault, puts)).slice(1, 4), await flashing(page)])
      .toEqual([OUTSIDE, 1, 1, true]);
    expect(await sign(page).getAttribute("aria-label")).toBe("Changed on disk");
  });

  test(":e while a write is on its way is refused with a flash and reads nothing", async ({ page }) => {
    const { sent, hold } = await watch(page);
    hold("PUT");
    await openApp(page);
    await openNote(page, "Welcome");
    await page.keyboard.type("Gotyped here");
    await expect.poll(() => sent.PUT.length).toBe(1);
    const reads = sent.GET.length;
    await expect.poll(() => flashing(page)).toBe(false);
    await ex(page, "e");
    await expect.poll(() => flashing(page)).toBe(true);
    expect([sent.GET.length, await typed(page).count()]).toEqual([reads, 1]);
  });
});
