/**
 * The html pane loading its page again when the vault says it was rewritten
 * (#1277), in a real browser. The rewrite is served by `servePage`, whose last
 * route wins, and announced by `pageWritten`, as the route's event stream does on
 * a `page` event. The frame is new after a reload, so each test reads it again.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import {
  late,
  renderPanes,
  report,
  rewrite as rewriteIn,
  SLOW,
  swap as swapIn,
  titleOf,
  WHICH,
} from "./html-pane-reload-fixture";
import {
  api,
  ask,
  frameOf,
  heardFrom,
  type Mounted,
  panelOf,
  ready,
  select,
  setUp,
  tearDown,
} from "./html-take-fixture";
import { page as pageOf } from "./html-take-pages";

const PATH = "reload-report.html";
const OTHER = "reload-other.html";
/** A page served with no ResizeObserver, to see the page script run without one. */
const NO_OBSERVER = "no-observer.html";

/** The scrolls the pane's frames reported, newest last. */
const scrolls: number[] = [];
window.addEventListener("message", (event: MessageEvent) => {
  if (event.data?.kasten === "scroll") scrolls.push(event.data.top);
});

let mounted: Mounted;
const render = (paths: string[], options: { phone?: boolean; anchor?: string }) =>
  renderPanes(mounted, paths, options);
const swap = (path: string, html: string, index: number) => swapIn(mounted, path, html, index);
const rewrite = (path: string, html: string, index: number) =>
  rewriteIn(mounted, path, html, index);

beforeEach(async () => {
  mounted = await setUp();
  scrolls.length = 0;
});

afterEach(async () => {
  await tearDown(mounted);
});

/** Scrolls the page by `by` and waits until the pane has heard where it landed. */
async function scrollBy(frame: HTMLIFrameElement, by: number): Promise<number> {
  const { y } = await ask(frame, { probe: "scroll", by }, "scroll");
  await expect.poll(() => scrolls.at(-1)).toBe(y);
  return y as number;
}

/** A page that scrolls, but less than the long page did. */
const SHORT = pageOf("short", `<p id="p1">Short.</p><div style="height:2000px"></div>${WHICH}`);

/**
 * Rewrites the page, scrolled to 3000, as `SHORT`, which opens clipped at its end
 * with the restored scroll held, and answers that clipped scroll once it is there.
 * Polled often: the hold lets go 1.5 s after the restore.
 */
async function openClipped(): Promise<number> {
  await rewrite(PATH, SHORT, 0);
  let clipped = 0;
  await expect
    .poll(
      async () => {
        clipped = (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll"))
          .y as number;
        return clipped;
      },
      { interval: 10 },
    )
    .toBeGreaterThan(0);
  expect(clipped).toBeLessThan(3000);
  return clipped;
}

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

  it("a rewrite of the open page shows the new page, at the scroll the reader left it", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    expect(await titleOf(frameOf(mounted, 0))).toBe("old");
    const y = await scrollBy(frameOf(mounted, 0), 900);

    await rewrite(PATH, report("new"), 0);

    expect(await titleOf(frameOf(mounted, 0))).toBe("new");
    await expect
      .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
      .toBe(y);
  });

  // The restored scroll is past the new page's end, so the pane holds it. A scroll the
  // page makes itself is no reader's input, so the pane hears it only once the hold lets go.
  it("a page rewritten shorter than its restored scroll, then scrolled and grown, stays put and restores the new scroll on the next rewrite", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    await scrollBy(frameOf(mounted, 0), 3000);

    const grow = `<div id="grow" style="height:1500px"></div><script>addEventListener("message", (event) => {
      if (event.source !== parent || event.data?.probe !== "grow") return;
      document.getElementById("grow").style.height = "6000px";
      requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ fixture: "grown" }, "*")));
    });</script>${WHICH}`;
    await rewrite(PATH, pageOf("short", grow), 0);

    const { y: at } = await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll");
    await ask(frameOf(mounted, 0), { probe: "scroll", by: 200 - (at as number) }, "scroll");
    await expect.poll(() => scrolls.at(-1), { timeout: 4000 }).toBe(200);

    await ask(frameOf(mounted, 0), { probe: "grow" }, "grown");
    expect((await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y).toBe(200);

    await rewrite(PATH, report("new"), 0);

    await expect
      .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y, {
        timeout: 4000,
      })
      .toBe(200);
  });

  // An input lets go of a held scroll. One that does not scroll the page must still tell
  // the pane where the page stands, or the next rewrite opens at the stale scroll (#1282).
  it("a touch or click that does not scroll while a restored scroll is held lets the next rewrite open at the clipped scroll", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    await scrollBy(frameOf(mounted, 0), 3000);

    const clipped = await openClipped();
    if (phone) await ask(frameOf(mounted, 0), { probe: "tap" }, "tapped");
    else await userEvent.click(frameOf(mounted, 0));
    await expect.poll(() => scrolls.at(-1)).toBe(clipped);

    await rewrite(PATH, report("new"), 0);

    await expect
      .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
      .toBe(clipped);
  });

  it("a key that does not scroll while a restored scroll is held lets the next rewrite open at the clipped scroll", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    await userEvent.click(frameOf(mounted, 0));
    await scrollBy(frameOf(mounted, 0), 3000);

    const clipped = await openClipped();
    await expect.poll(() => document.activeElement).toBe(frameOf(mounted, 0));
    await userEvent.keyboard("{Shift}");
    await expect.poll(() => scrolls.at(-1)).toBe(clipped);

    await rewrite(PATH, report("new"), 0);

    await expect
      .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
      .toBe(clipped);
  });

  // A page whose html and body are the height of the window grows inside them, so the
  // pane's observer on html never sees the change.
  it("a page in a full-height html box that grows after its load reports its scroll again", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    await scrollBy(frameOf(mounted, 0), 900);

    const boxed = pageOf(
      "boxed",
      `<div id="late"></div><script>addEventListener("load", () => setTimeout(() => { document.getElementById("late").style.height = "4000px"; parent.postMessage({ fixture: "grew" }, "*"); }, 300));</script>${WHICH}`,
      "<style>html,body{height:100%;margin:0}</style>",
    );
    await rewrite(PATH, boxed, 0);
    await expect.poll(() => heardFrom("grew"), { timeout: 4000 }).toBe(true);

    const { y } = await ask(frameOf(mounted, 0), { probe: "scroll", by: 300 }, "scroll");
    await expect.poll(() => scrolls.at(-1), { timeout: 4000 }).toBe(y);
  });

  // A page whose html box is the window's height grows in its body, which the
  // page script watches as well as html, so the restored scroll still lands.
  it("a page in a window-high html box whose body grows after its load opens at the reader's scroll", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    const y = await scrollBy(frameOf(mounted, 0), 900);

    const boxed = pageOf(
      "boxed body",
      `<p id="p1">Late.</p><div id="late"></div><script>addEventListener("load", () => setTimeout(() => { document.getElementById("late").style.height = "4000px"; }, 300));</script>${WHICH}`,
      "<style>html{height:100%}</style>",
    );
    await rewrite(PATH, boxed, 0);

    await expect
      .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
      .toBe(y);
  });

  // A log that follows its own tail scrolls to the end on each append. The pane must not
  // pull it back to the scroll it restored.
  it("a page that scrolls itself to its end on each append is not pulled back to the restored scroll", async () => {
    await browser.servePage(PATH, report("old"));
    render([PATH], { phone });
    await ready(frameOf(mounted, 0));
    await scrollBy(frameOf(mounted, 0), 900);

    const append = `<script>addEventListener("message", (event) => {
      if (event.source !== parent || event.data?.probe !== "append") return;
      document.body.appendChild(document.createElement("div")).style.height = "5000px";
      scrollTo(0, document.documentElement.scrollHeight);
      requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({
        fixture: "appended",
        y: scrollY,
        end: document.documentElement.scrollHeight - innerHeight,
      }, "*")));
    });</script>${WHICH}`;
    const count = scrolls.length;
    await rewrite(PATH, pageOf("log", `<p id="p1">First line.</p>${append}`), 0);
    await expect.poll(() => scrolls.length, { timeout: 4000 }).toBeGreaterThan(count);

    const { y, end } = await ask(frameOf(mounted, 0), { probe: "append" }, "appended");
    expect(y).toBe(end);
  });

  // The page script must still say hello, take a passage and open the leader on a
  // browser with no ResizeObserver.
  it("without ResizeObserver the page script still sends Space to kasten and takes a passage", async () => {
    await browser.hideResizeObserver(NO_OBSERVER);
    await browser.servePage(NO_OBSERVER, report("no observer"));
    render([NO_OBSERVER], { phone });
    await ready(frameOf(mounted, 0));

    await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
    await userEvent.keyboard("y");
    await expect.poll(() => api.dumps.length).toBe(1);

    await userEvent.click(frameOf(mounted, 0));
    await userEvent.keyboard(" ");
    await expect.poll(panelOf).not.toBeNull();
  });
});

it("a rewrite of another page reloads that page only", async () => {
  await browser.servePage(PATH, report("this"));
  await browser.servePage(OTHER, report("other"));
  render([PATH, OTHER], {});
  const here = frameOf(mounted, 0);
  await ready(here);
  await ready(frameOf(mounted, 1));
  await scrollBy(here, 300);

  await rewrite(OTHER, report("other, new"), 1);

  expect(await titleOf(frameOf(mounted, 1))).toBe("other, new");
  expect(frameOf(mounted, 0)).toBe(here);
  expect(await titleOf(here)).toBe("this");
  expect((await ask(here, { probe: "scroll", by: 0 }, "scroll")).y).toBe(300);
});

it("a reload adds no entry to the browser's history", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  const length = history.length;

  await rewrite(PATH, report("new"), 0);

  expect(await titleOf(frameOf(mounted, 0))).toBe("new");
  expect(history.length).toBe(length);
});

it("after a reload, Space, ? and Escape from the page reach kasten without a new click", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await userEvent.click(frameOf(mounted, 0));

  await rewrite(PATH, report("new"), 0);

  await expect.poll(() => document.activeElement).toBe(frameOf(mounted, 0));
  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(frameOf(mounted, 0));
  await userEvent.keyboard("?");
  await expect.poll(() => mounted.spy.showHelp.mock.calls.length).toBe(1);
  await userEvent.keyboard("{Escape}");
  await expect
    .poll(() => document.activeElement)
    .toBe(mounted.host.querySelector("[data-html-pane]"));
});

it("a reload of a page opened at a heading keeps the reader's scroll, not the heading's", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], { anchor: "far" });
  await ready(frameOf(mounted, 0));
  await expect.poll(() => scrolls.length).toBeGreaterThan(0);
  const y = await scrollBy(frameOf(mounted, 0), -1000);

  await rewrite(PATH, report("new"), 0);

  await expect
    .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
    .toBe(y);
});

it("two rewrites in a row, the first one short, still end at the reader's scroll", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  const y = await scrollBy(frameOf(mounted, 0), 900);

  await rewrite(PATH, pageOf("short", `<p id="p1">Short.</p>${WHICH}`), 0);
  await rewrite(PATH, report("new"), 0);

  expect(await titleOf(frameOf(mounted, 0))).toBe("new");
  await expect
    .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
    .toBe(y);
});

// The input's report is the release's only one: the time limit finds the hold gone.
it("a click that lets go of a held scroll reports it once, and the time limit adds none", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await scrollBy(frameOf(mounted, 0), 3000);
  const clipped = await openClipped();
  const before = scrolls.length;

  await userEvent.click(frameOf(mounted, 0));
  await expect.poll(() => scrolls.length).toBe(before + 1);
  // Past the 1.5 s time limit, so a second report would have come by now.
  await new Promise((done) => setTimeout(done, 1700));

  expect(scrolls.slice(before)).toEqual([clipped]);
});

it("a page grown after its load still opens at the reader's scroll", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  const y = await scrollBy(frameOf(mounted, 0), 900);

  const grows = `<p id="p1">Late.</p><div id="late"></div><script>addEventListener("load", () => setTimeout(() => { document.getElementById("late").style.height = "4000px"; }, 300));</script>${WHICH}`;
  await rewrite(PATH, pageOf("grows", grows), 0);

  await expect
    .poll(async () => (await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y)
    .toBe(y);
});

it("a page left and opened again at its top reloads at its top", async () => {
  await browser.servePage(PATH, report("old"));
  await browser.servePage(OTHER, report("other"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await scrollBy(frameOf(mounted, 0), 900);
  render([OTHER], {});
  await expect.poll(async () => titleOf(frameOf(mounted, 0))).toBe("other");
  render([PATH], {});
  await expect.poll(async () => titleOf(frameOf(mounted, 0))).toBe("old");

  await rewrite(PATH, report("new"), 0);

  expect(await titleOf(frameOf(mounted, 0))).toBe("new");
  expect((await ask(frameOf(mounted, 0), { probe: "scroll", by: 0 }, "scroll")).y).toBe(0);
});

it("a reload does not take the focus from where the reader went while it loaded", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await userEvent.click(frameOf(mounted, 0));
  const field = mounted.host.appendChild(document.createElement("input"));

  await browser.serveSlowly(SLOW, 1500);
  const loaded = await swap(PATH, late("new"), 0);
  field.focus();
  await loaded();
  expect(await titleOf(frameOf(mounted, 0))).toBe("new");

  expect(document.activeElement).toBe(field);
});
