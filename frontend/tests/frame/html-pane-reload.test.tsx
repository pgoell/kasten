/**
 * The html pane loading its page again when the vault says it was rewritten
 * (#1277), in a real browser. The rewrite is served by `servePage`, whose last
 * route wins, and announced by `pageWritten`, as the route's event stream does on
 * a `page` event. The frame is new after a reload, so each test reads it again.
 */

import "./html-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { commands as browser, page, userEvent } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import { pageWritten } from "@/lib/html/page-written";
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
  takeButton,
  tearDown,
} from "./html-take-fixture";
import { page as pageOf } from "./html-take-pages";

const PATH = "reload-report.html";
const OTHER = "reload-other.html";
/** A page served with no ResizeObserver, to see the page script run without one. */
const NO_OBSERVER = "no-observer.html";

/** Answers which version of the page is drawn, by its title. */
const WHICH = `<script>addEventListener("message", (event) => {
  if (event.source === parent && event.data?.probe === "which") parent.postMessage({ fixture: "which", title: document.title }, "*");
});</script>`;

/** A page tall enough to scroll, with a heading far down for a link to name. */
function report(title: string): string {
  return pageOf(
    title,
    `<p id="p1">Alpha bravo charlie delta echo.</p><div style="height:1500px"></div><h2 id="far">Far</h2><div style="height:3000px"></div>${WHICH}`,
  );
}

/** The scrolls the pane's frames reported, newest last. */
const scrolls: number[] = [];
window.addEventListener("message", (event: MessageEvent) => {
  if (event.data?.kasten === "scroll") scrolls.push(event.data.top);
});

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
  scrolls.length = 0;
});

afterEach(async () => {
  await tearDown(mounted);
});

/** One pane per path, the phone's toolbar when asked, and the heading a link named. */
function render(paths: string[], { phone = false, anchor }: { phone?: boolean; anchor?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-col">
          <div className="flex min-h-0 flex-1">
            {paths.map((path, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: keyed by place, so a pane moved to another page keeps its HtmlPane, as the app's does
              <div key={index} data-pane className="min-w-0 flex-1">
                <HtmlPane path={path} anchor={anchor} commands={mounted.spy} onFocus={() => {}} />
              </div>
            ))}
          </div>
          {phone && <Toolbar commands={mounted.spy} split={paths.length > 1} />}
          <WhichKey phone={phone} />
        </div>
      </QueryClientProvider>,
    ),
  );
}

async function titleOf(frame: HTMLIFrameElement): Promise<unknown> {
  return (await ask(frame, { probe: "which" }, "which")).title;
}

/** Scrolls the page by `by` and waits until the pane has heard where it landed. */
async function scrollBy(frame: HTMLIFrameElement, by: number): Promise<number> {
  const { y } = await ask(frame, { probe: "scroll", by }, "scroll");
  await expect.poll(() => scrolls.at(-1)).toBe(y);
  return y as number;
}

/** Rewrites the page on disk and tells the panes, then waits for the new frame's script. */
async function rewrite(path: string, html: string, index: number) {
  await browser.servePage(path, html);
  const before = frameOf(mounted, index);
  pageWritten(path);
  await expect.poll(() => frameOf(mounted, index)).not.toBe(before);
  await ready(frameOf(mounted, index));
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

it("after a take and a reload, the page's y takes a passage of the new page", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(1);

  await rewrite(PATH, report("new"), 0);
  await select(frameOf(mounted, 0), ["p1", 6, "p1", 11]);
  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(2);
  expect(api.dumps[1]).toContain("bravo");
});

it("a reload drops the old page's held passage and its take button", async () => {
  await browser.servePage(PATH, report("old"));
  render([PATH], {});
  await ready(frameOf(mounted, 0));
  await select(frameOf(mounted, 0), ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted)).not.toBeNull();

  await rewrite(PATH, report("new"), 0);

  expect(takeButton(mounted)).toBeNull();
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

  await browser.servePage(PATH, report("new"));
  const before = frameOf(mounted, 0);
  pageWritten(PATH);
  field.focus();
  await expect.poll(() => frameOf(mounted, 0)).not.toBe(before);
  await ready(frameOf(mounted, 0));
  expect(await titleOf(frameOf(mounted, 0))).toBe("new");

  expect(document.activeElement).toBe(field);
});
