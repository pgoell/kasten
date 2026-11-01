/**
 * A passage held for a take across a reload of the html pane's page (#1279,
 * #1293), and across a keep that lands late (#897), in a real browser. The new
 * page runs its script and draws long before its load where `serveSlowly` holds
 * an image of it back.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import { late, renderPanes, report, rewrite, SLOW, swap } from "./html-pane-reload-fixture";
import {
  api,
  ask,
  buttonNamed,
  frameOf,
  type Mounted,
  ready,
  select,
  setUp,
  takeButton,
  tearDown,
} from "./html-take-fixture";

/** Holds each take's keep until the test lets it go, and counts the keeps asked for. */
const { gate } = vi.hoisted(() => ({ gate: { hold: null as Promise<void> | null, asked: 0 } }));
vi.mock("@/lib/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/outbox")>();
  return {
    ...real,
    keep: async (text: string, date: string) => {
      gate.asked += 1;
      if (gate.hold !== null) await gate.hold;
      return real.keep(text, date);
    },
  };
});

/** Holds the keeps from now on, and answers the call that lets them all land. */
function holdKeeps(): () => void {
  let release = () => {};
  gate.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

/** The marks the page drew and its own selection, asked for and waited on. */
async function marksOf(frame: HTMLIFrameElement) {
  return (await ask(frame, { probe: "marks" }, "marks")).texts;
}

async function selected(frame: HTMLIFrameElement) {
  return (await ask(frame, { probe: "selection" }, "selection")).text;
}

const PATH = "reload-report.html";

let mounted: Mounted;

beforeEach(async () => {
  gate.hold = null;
  gate.asked = 0;
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

  /** Selects as this kind does: a mouse on a desktop, a finger on a phone. */
  async function choose(frame: HTMLIFrameElement, range: [string, number, string, number]) {
    await userEvent.click(frame);
    await ask(frame, { probe: phone ? "touchSelect" : "select", range }, "selected");
    await expect.poll(() => takeButton(mounted)).not.toBeNull();
  }

  it("a take whose keep lands after another selection marks the taken passage, and Undo unmarks it (#897)", async () => {
    await browser.servePage(PATH, report("old"));
    renderPanes(mounted, [PATH], { phone });
    const frame = frameOf(mounted, 0);
    await ready(frame);
    const release = holdKeeps();
    await choose(frame, ["p1", 0, "p1", 5]);

    // The phone has no `y`: its take is the button.
    if (phone) await userEvent.click(takeButton(mounted) as HTMLElement);
    else await userEvent.keyboard("y");
    await expect.poll(() => gate.asked).toBe(1);
    await choose(frame, ["p1", 6, "p1", 11]);
    release();

    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toContain("> Alpha");
    await expect.poll(() => marksOf(frame)).toEqual(["Alpha"]);
    expect(await selected(frame)).toBe("bravo");
    expect(takeButton(mounted)).not.toBeNull();

    await expect.poll(() => buttonNamed("Undo")).not.toBeUndefined();
    await userEvent.click(buttonNamed("Undo") as HTMLButtonElement);

    await expect.poll(() => marksOf(frame)).toEqual([]);
    expect(await selected(frame)).toBe("bravo");
  });
});

it("two takes in flight before either keep lands each mark their own passage (#897)", async () => {
  await browser.servePage(PATH, report("old"));
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  await ready(frame);
  const release = holdKeeps();
  await select(frame, ["p1", 0, "p1", 5]);
  await userEvent.keyboard("y");
  await expect.poll(() => gate.asked).toBe(1);
  await select(frame, ["p1", 6, "p1", 11]);
  await userEvent.keyboard("y");
  await expect.poll(() => gate.asked).toBe(2);

  release();

  await expect.poll(() => api.dumps.length).toBe(2);
  await expect.poll(() => marksOf(frame)).toEqual(["Alpha", "bravo"]);
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

it("after a reload, two passages taken with y in the new page are both taken", async () => {
  await browser.servePage(PATH, report("old"));
  renderPanes(mounted, [PATH], {});
  await ready(frameOf(mounted, 0));
  await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(1);

  await rewrite(mounted, PATH, report("new"), 0);
  const frame = frameOf(mounted, 0);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(2);
  await select(frame, ["p1", 6, "p1", 11]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();
  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(3);
  expect(api.dumps[2]).toContain("> bravo");
});
