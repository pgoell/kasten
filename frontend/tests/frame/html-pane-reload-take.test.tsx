/**
 * A passage held for a take across a reload of the html pane's page (#1279,
 * #1293), in a real browser. The new page runs its script and draws long before
 * its load where `serveSlowly` holds an image of it back.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import { late, renderPanes, report, rewrite, SLOW, swap } from "./html-pane-reload-fixture";
import {
  api,
  frameOf,
  type Mounted,
  ready,
  select,
  setUp,
  takeButton,
  tearDown,
} from "./html-take-fixture";

const PATH = "reload-report.html";

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
});

afterEach(async () => {
  await tearDown(mounted);
});

const KINDS = [
  { name: "desktop, vim on", phone: false, vim: "on" },
  { name: "desktop, vim off", phone: false, vim: "off" },
  { name: "phone at 414, vim on", phone: true, vim: "on" },
  { name: "phone at 414, vim off", phone: true, vim: "off" },
];

describe.each(KINDS)("$name", ({ phone, vim }) => {
  beforeEach(async () => {
    localStorage.setItem("kasten.vim", vim);
    if (phone) {
      await page.viewport(414, 896);
      await browser.emulateMedia({ touch: true });
    }
  });

  it("a reload drops the old page's held passage and its take button", async () => {
    await browser.servePage(PATH, report("old"));
    await browser.serveSlowly(SLOW, 1500);
    renderPanes(mounted, [PATH], { phone });
    await ready(frameOf(mounted, 0));
    await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
    await expect.poll(() => takeButton(mounted)).not.toBeNull();

    const loaded = await swap(mounted, PATH, late("new"), 0);

    expect(takeButton(mounted)).toBeNull();
    await loaded();
    expect(takeButton(mounted)).toBeNull();
  });
});

// The phone has no `y`: its take is the button.
it("a y while the reloaded page loads takes nothing of the old page", async () => {
  await browser.servePage(PATH, report("old"));
  await browser.serveSlowly(SLOW, 1500);
  renderPanes(mounted, [PATH], {});
  await ready(frameOf(mounted, 0));
  await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();

  const loaded = await swap(mounted, PATH, late("new"), 0);
  mounted.host.querySelector<HTMLElement>("[data-html-pane]")?.focus();
  await userEvent.keyboard("y");
  await loaded();

  expect(api.dumps).toEqual([]);
});

it("after a take and a reload, the page's y takes a passage of the new page", async () => {
  await browser.servePage(PATH, report("old"));
  renderPanes(mounted, [PATH], {});
  await ready(frameOf(mounted, 0));
  await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(1);

  await rewrite(mounted, PATH, report("new"), 0);
  await select(frameOf(mounted, 0), ["p1", 6, "p1", 11]);
  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(2);
  expect(api.dumps[1]).toContain("bravo");
});
