/**
 * A passage held for a take across a reload of the html pane's page (#1279,
 * #1293), across a keep that lands late (#897) and across a slow page's own load
 * (#1295), in a real browser. The page runs its script and draws long before its
 * load where `serveSlowly` holds an image of it back. Also the keyboard's
 * selections (#1298) and a share per press (#1297).
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import { late, renderPanes, report, rewrite, SLOW, swap } from "./html-pane-reload-fixture";
import {
  api,
  ask,
  buttonNamed,
  frameOf,
  inFrame,
  type Mounted,
  ready,
  select,
  setUp,
  takeButton,
  tearDown,
} from "./html-take-fixture";
import { NEWS, page as pageOf } from "./html-take-pages";

/** Holds each take's keep until the test lets it go, and counts the keeps asked for. */
const { gate } = vi.hoisted(() => ({ gate: { hold: null as Promise<void> | null, asked: 0 } }));
vi.mock("@/lib/capture/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/capture/outbox")>();
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

/** A slow page's load, which a test waits on, and whether it has come yet. */
function loadOf(frame: HTMLIFrameElement) {
  let loaded = false;
  frame.addEventListener("load", () => {
    loaded = true;
  });
  return () => loaded;
}

/** The page's Share later button of the story at `index`. */
const shareButton = (frame: HTMLIFrameElement, index = 0) =>
  inFrame(frame).getByRole("button", { name: "Share later" }).nth(index);
const shares = () => api.dumps.filter((dump) => dump.includes("#share"));

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

  it("a selection made before a slow page's own load keeps its take button through the load, and the take takes it (#1295)", async () => {
    await browser.serveSlowly(SLOW, 2000);
    await browser.servePage(PATH, late("slow"));
    renderPanes(mounted, [PATH], { phone });
    const frame = frameOf(mounted, 0);
    const loaded = loadOf(frame);
    await ready(frame);
    await choose(frame, ["p1", 6, "p1", 11]);
    expect(loaded()).toBe(false);

    await expect.poll(loaded, { timeout: 5000 }).toBe(true);
    expect(takeButton(mounted)).not.toBeNull();
    if (phone) await userEvent.click(takeButton(mounted) as HTMLElement);
    else await userEvent.keyboard("y");

    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toContain("> bravo");
  });
});

describe.each(KINDS.filter((kind) => !kind.phone))("$name, keys", ({ vim }) => {
  beforeEach(() => localStorage.setItem("kasten.vim", vim));

  it("Ctrl+A in the page shows the take button and y takes the whole page (#1298)", async () => {
    await browser.servePage(PATH, report("old"));
    renderPanes(mounted, [PATH], {});
    const frame = frameOf(mounted, 0);
    await ready(frame);
    await userEvent.click(frame);
    await userEvent.keyboard("{Control>}a{/Control}");

    await expect.poll(() => takeButton(mounted)).not.toBeNull();
    await userEvent.keyboard("y");
    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toContain("> Alpha bravo charlie delta echo.");
  });

  it("a selection made by keys posts on the keyup of Meta, which a Mac's Cmd+A leaves (#1298)", async () => {
    await browser.servePage(PATH, report("old"));
    renderPanes(mounted, [PATH], {});
    const frame = frameOf(mounted, 0);
    await ready(frame);
    await userEvent.click(frame);
    await ask(frame, { probe: "keySelect", range: ["p1", 6, "p1", 11] }, "selected");
    await userEvent.keyboard("{Meta}");

    await expect.poll(() => takeButton(mounted)).not.toBeNull();
    await userEvent.keyboard("y");
    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toContain("> bravo");
  });

  it("Shift let go before the arrow key still posts the grown selection, and y takes it (#1298)", async () => {
    await browser.servePage(PATH, report("old"));
    renderPanes(mounted, [PATH], {});
    const frame = frameOf(mounted, 0);
    await ready(frame);
    await select(frame, ["p1", 0, "p1", 4]);
    await userEvent.keyboard("{Shift>}{ArrowRight>}{/Shift}{/ArrowRight}");
    await expect.poll(async () => (await selected(frame)) === "Alpha").toBe(true);

    await userEvent.keyboard("y");
    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toMatch(/^> Alpha$/m);
  });

  it("arrow keys with nothing selected show no take button", async () => {
    await browser.servePage(PATH, report("old"));
    renderPanes(mounted, [PATH], {});
    const frame = frameOf(mounted, 0);
    await ready(frame);
    await userEvent.click(frame);
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{End}{Home}");

    expect(await selected(frame)).toBe("");
    expect(takeButton(mounted)).toBeNull();
  });
});

const SLOW_NEWS = pageOf(
  "Slow news",
  `<article><a class="sid" href="#s1">#s1</a><h2>One story</h2><p id="p1">Alpha bravo.</p></article><img src="${SLOW}">`,
);

it("a Share later pressed before a slow page's load and again after it saves once, and its Undo gives the button back (#1295)", async () => {
  await browser.serveSlowly(SLOW, 2000);
  await browser.servePage(PATH, SLOW_NEWS);
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  const loaded = loadOf(frame);
  await ready(frame);
  const release = holdKeeps();
  await userEvent.click(shareButton(frame));
  await expect.poll(() => gate.asked).toBe(1);
  expect(loaded()).toBe(false);

  await expect.poll(loaded, { timeout: 5000 }).toBe(true);
  await userEvent.click(shareButton(frame));
  // Answered after the page's share message, so that message has been heard.
  await selected(frame);
  expect(gate.asked).toBe(1);
  release();

  await expect.poll(() => api.dumps.length).toBe(1);
  await expect.poll(() => buttonNamed("Undo")).not.toBeUndefined();
  await userEvent.click(buttonNamed("Undo") as HTMLButtonElement);
  // The button is back, and a press on it saves the story again.
  await userEvent.click(shareButton(frame));
  await expect.poll(() => shares().length).toBe(2);
});

it("a link followed inside the page drops the held passage and its take button", async () => {
  await browser.servePage("other.html", report("other"));
  await browser.servePage(
    PATH,
    pageOf("link", `<p id="p1">Alpha bravo.</p><a href="other.html">go</a>`),
  );
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();

  await userEvent.click(inFrame(frame).getByText("go"));

  await expect.poll(() => takeButton(mounted)).toBeNull();
});

it("a link to a document kasten's script is not in drops the held passage at its load", async () => {
  await browser.serveSlowly(SLOW, 10);
  await browser.servePage(
    PATH,
    pageOf("link", `<p id="p1">Alpha bravo.</p><a href="${SLOW}">go</a>`),
  );
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  const loaded = loadOf(frame);
  await ready(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();
  await expect.poll(loaded).toBe(true);

  await userEvent.click(inFrame(frame).getByText("go"));

  await expect.poll(() => takeButton(mounted), { timeout: 5000 }).toBeNull();
});

it("a page that posts many share messages after one click saves at most one (#1297)", async () => {
  await browser.servePage(PATH, NEWS);
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);
  await ask(frame, { probe: "shareMany", anchors: ["f1", "f2", "f3"] }, "sharedMany");

  // One real press, which the forged messages came before.
  await userEvent.click(shareButton(frame, 1));
  await expect.poll(() => shares().some((dump) => dump.includes("Second story"))).toBe(true);
  expect(shares().length).toBe(2);
});

it("two real Share later presses on two stories save both", async () => {
  await browser.servePage(PATH, NEWS);
  renderPanes(mounted, [PATH], {});
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(shareButton(frame, 1));
  await expect.poll(() => shares().length).toBe(1);
  // The saved story's button is named otherwise now, so the first is the other story's.
  await userEvent.click(shareButton(frame, 0));

  await expect.poll(() => shares().length).toBe(2);
  expect(shares().some((dump) => dump.includes("First story"))).toBe(true);
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
