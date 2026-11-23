import type { Page } from "@playwright/test";
import { hold, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** Each read whose answer sets the height of something above the empty pane's editor. */
const READS: Record<string, RegExp> = {
  recent: /\/api\/search\?q=modified/,
  cards: /\/api\/cards\?/,
  limits: /\/api\/review\/limits/,
  timers: /\/api\/push\/timers/,
  push: /\/api\/push$/,
  todos: /\/api\/todos\?/,
  plan: /\/api\/plans\//,
};

const editor = (page: Page) => page.locator(".cm-editor:visible");
/** How much of the editor shows, through its parents, and whether a tap reaches it. */
const seen = (page: Page) =>
  editor(page).evaluate((view) => {
    let opacity = 1;
    for (let at: Element | null = view; at; at = at.parentElement) {
      opacity *= Number(getComputedStyle(at).opacity);
    }
    return { opacity, taps: getComputedStyle(view).pointerEvents !== "none" };
  });
const topOf = async (page: Page) => (await editor(page).boundingBox())?.y;
const recent = (page: Page) => page.locator("[data-today-column]").filter({ hasText: "Recent" });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/**
 * Opens the home view with one read held, sees no card claim to be empty and the editor unseen and
 * untouchable while it is out, then lets it go and sees the editor keep its place once shown (#2296).
 */
async function heldThenLanded(page: Page, listing: RegExp): Promise<void> {
  const release = await hold(page, listing);
  const others = Object.values(READS)
    .filter((read) => read !== listing)
    .map((read) => page.waitForResponse((answer) => read.test(answer.url())));
  const asked = page.waitForRequest((request) => listing.test(request.url()));
  await page.goto("/");
  await asked;
  await Promise.all(others);
  await expect(page.locator("[data-today]").getByText("Loading today…")).toBeVisible();
  await expect(page.getByText("Nothing written lately.")).toBeHidden();
  await expect(page.getByText("Nothing due.")).toBeHidden();
  expect(await seen(page)).toEqual({ opacity: 0, taps: false });

  await release();
  await expect.poll(() => seen(page)).toEqual({ opacity: 1, taps: true });
  const first = await topOf(page);
  await expect(recent(page).getByRole("button").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /cards waiting$/ })).toBeVisible();
  await expect(page.getByText("Remind me to drink water")).toBeVisible();
  expect(await topOf(page)).toBe(first);
}

test.describe("on a phone", () => {
  test.use(phone);

  for (const [name, listing] of Object.entries(READS)) {
    test(`the editor waits for the ${name} read and keeps its place once the cards land (#2296)`, async ({
      page,
    }) => {
      await heldThenLanded(page, listing);
    });
  }
});

test("on a desktop the editor waits for the Recent read and keeps its place once the cards land (#2296)", async ({
  page,
}) => {
  await heldThenLanded(page, READS.recent as RegExp);
});
