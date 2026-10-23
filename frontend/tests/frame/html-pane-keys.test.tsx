/**
 * The html pane with the which-key panel and key help beside it, in a real
 * browser (#785).
 *
 * The pane is the real one, its frame served by `servePage` the way `read_html`
 * serves a page. The keys are real ones pressed with `userEvent` once the frame
 * holds the focus, so the page script, the pane's listener and the panel all run
 * as they do in the app. Each hostile case is answered by a press from the page
 * itself, so a case that opens nothing is shown to be a refusal and not a
 * message that never arrived.
 */

import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands as browser, page, userEvent } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { KeyHelp } from "@/components/key-help";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";

type Spy = ReturnType<typeof stubCommands>;

/** One message the window heard, from whatever window sent it. */
interface Heard {
  source: MessageEventSource | null;
  data: { kasten?: string; key?: string; fixture?: string; y?: number };
}

const heard: Heard[] = [];
window.addEventListener("message", (event: MessageEvent) => {
  heard.push({ source: event.source, data: event.data ?? {} });
});

const REPORT_PATH = "report.html";
const NEST_PATH = "nest.html";
const HOSTILE_PATH = "hostile.html";

/**
 * A page tall enough to scroll, which answers the test's questions: where it has
 * scrolled, a `?` of its own on request, and a window opened on request.
 */
const REPORT = `<!doctype html><title>report</title><body><div style="height:3000px"></div><script>
addEventListener("message", (event) => {
  const { fixture } = event.data ?? {};
  if (fixture === "where") parent.postMessage({ fixture: "scroll", y: scrollY }, "*");
  if (fixture === "control") parent.postMessage({ kasten: "key", key: "?" }, "*");
  if (fixture === "open") window.open("/api/html/${HOSTILE_PATH}");
});
</script></body>`;

/**
 * A window the page opens. It is top level in its own tab, so the page script does
 * nothing in it, and it posts kasten's keys to the page's parent and top. The
 * `popup` message goes last, so once it has arrived the keys before it have too.
 */
const HOSTILE = `<!doctype html><title>hostile</title><body><script>
const target = window.opener;
target?.parent.postMessage({ kasten: "key", key: " " }, "*");
target?.parent.postMessage({ kasten: "key", key: "?" }, "*");
target?.top.postMessage({ kasten: "key", key: "?" }, "*");
target?.parent.postMessage({ fixture: "popup" }, "*");
</script></body>`;

/**
 * A page with a frame nested in it, sized to nothing so a click at the page's
 * centre lands on the page. Told to `relay`, the page asks the nested frame to
 * post kasten's keys to its grandparent and its top, then `nested` last.
 */
const NEST = `<!doctype html><title>nest</title><body><iframe style="position:absolute;width:10px;height:10px;border:0" srcdoc="<script>addEventListener('message', () => { parent.parent.postMessage({ kasten: 'key', key: ' ' }, '*'); parent.parent.postMessage({ kasten: 'key', key: '?' }, '*'); top.postMessage({ kasten: 'key', key: '?' }, '*'); parent.parent.postMessage({ fixture: 'nested' }, '*'); });</script>"></iframe><script>
const nested = document.querySelector("iframe");
addEventListener("message", (event) => {
  const { fixture } = event.data ?? {};
  if (fixture === "relay") nested.contentWindow.postMessage({ fixture: "fire" }, "*");
  if (fixture === "control") parent.postMessage({ kasten: "key", key: "?" }, "*");
});
</script></body>`;

/** A layout of one pane per path, the which-key panel, and key help when the page asks for it. */
function Layout({ paths, spy, phone = false }: { paths: string[]; spy: Spy; phone?: boolean }) {
  const [help, setHelp] = useState(false);
  // The help opens through the state the editor keeps, so Escape can close it.
  const commands = {
    ...spy,
    showHelp: () => {
      spy.showHelp();
      setHelp(true);
    },
  };
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        {paths.map((path) => (
          <div key={path} data-pane className="min-w-0 flex-1">
            <HtmlPane path={path} commands={commands} onFocus={() => {}} />
          </div>
        ))}
      </div>
      {phone && <Toolbar commands={commands} split={paths.length > 1} />}
      <WhichKey phone={phone} />
      {help && <KeyHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
let spy: Spy;

beforeEach(async () => {
  await page.viewport(1440, 900);
  heard.length = 0;
  localStorage.removeItem("kasten.vim");
  spy = stubCommands();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.removeItem("kasten.vim");
  await browser.unservePages();
  await page.viewport(1440, 900);
  await browser.emulateMedia({});
});

function render(paths: string[], phone = false) {
  flushSync(() => root.render(<Layout paths={paths} spy={spy} phone={phone} />));
}

function frameOf(index: number): HTMLIFrameElement {
  return host.querySelectorAll("iframe")[index] as HTMLIFrameElement;
}

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

function keyHelpOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Keyboard shortcuts']");
}

/** Waits for the page's own script to say hello, which it does once it has run. */
async function ready(frame: HTMLIFrameElement) {
  await expect
    .poll(() => heard.some((h) => h.source === frame.contentWindow && h.data.kasten === "hello"))
    .toBe(true);
}

/** The page's scroll position, asked for and waited on, since a frame's DOM is out of reach. */
async function scrollOf(frame: HTMLIFrameElement): Promise<number | undefined> {
  const before = heard.length;
  frame.contentWindow?.postMessage({ fixture: "where" }, "*");
  await expect
    .poll(() =>
      heard
        .slice(before)
        .some((h) => h.source === frame.contentWindow && h.data.fixture === "scroll"),
    )
    .toBe(true);
  return heard
    .slice(before)
    .find((h) => h.source === frame.contentWindow && h.data.fixture === "scroll")?.data.y;
}

it("Space over a real page opens the which-key panel and Space f f runs findNote", async () => {
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();
  await userEvent.keyboard("f");
  await userEvent.keyboard("f");

  await expect.poll(() => spy.findNote.mock.calls.length).toBe(1);
});

it("with vim off, Space over a real page opens the which-key panel and Space f f runs findNote", async () => {
  localStorage.setItem("kasten.vim", "off");
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();
  await userEvent.keyboard("f");
  await userEvent.keyboard("f");

  await expect.poll(() => spy.findNote.mock.calls.length).toBe(1);
});

it("? over a real page opens key help, Esc closes it, and the page keeps its scroll", async () => {
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);
  await userEvent.keyboard("j");
  await expect.poll(() => scrollOf(frame)).toBe(64);
  const src = frame.getAttribute("src");

  await userEvent.keyboard("?");
  await expect.poll(keyHelpOf).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await expect.poll(keyHelpOf).toBeNull();

  expect({ y: await scrollOf(frame), src: frame.getAttribute("src") }).toEqual({ y: 64, src });
});

it("after the panel closes, j still scrolls the page", async () => {
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);
  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(frame);
  await userEvent.keyboard("j");

  await expect.poll(() => scrollOf(frame)).toBe(64);
});

it("Escape from a real page gives the keys back: the next Space reaches the pane", async () => {
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  await userEvent.keyboard("{Escape}");
  const section = host.querySelector("[data-html-pane]") as HTMLElement;
  await expect.poll(() => document.activeElement).toBe(section);
  await userEvent.keyboard(" ");

  await expect.poll(panelOf).not.toBeNull();
});

it("a nested frame inside the page posting kasten keys opens nothing", async () => {
  await browser.servePage(NEST_PATH, NEST);
  render([NEST_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  frame.contentWindow?.postMessage({ fixture: "relay" }, "*");
  await expect.poll(() => heard.some((h) => h.data.fixture === "nested")).toBe(true);
  expect({ panel: panelOf() !== null, help: spy.showHelp.mock.calls.length }).toEqual({
    panel: false,
    help: 0,
  });

  // The same page, with the focus in it, asks for help: the refusal above is not
  // the page failing to answer at all.
  frame.contentWindow?.postMessage({ fixture: "control" }, "*");
  await expect.poll(() => spy.showHelp.mock.calls.length).toBe(1);
});

it("a window the page opens posting kasten keys opens nothing", async () => {
  await browser.servePage(REPORT_PATH, REPORT);
  await browser.servePage(HOSTILE_PATH, HOSTILE);
  render([REPORT_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  frame.contentWindow?.postMessage({ fixture: "open" }, "*");
  await expect.poll(() => heard.some((h) => h.data.fixture === "popup")).toBe(true);
  const popup = heard.find((h) => h.data.fixture === "popup")?.source as Window | null;
  try {
    expect({ panel: panelOf() !== null, help: spy.showHelp.mock.calls.length }).toEqual({
      panel: false,
      help: 0,
    });

    // A click back into the page, since the window it opened may have taken the focus.
    await userEvent.click(frame);
    frame.contentWindow?.postMessage({ fixture: "control" }, "*");
    await expect.poll(() => spy.showHelp.mock.calls.length).toBe(1);
  } finally {
    popup?.close();
  }
});

it("two pages side by side: Space in the right page opens the panel at the foot of the right pane", async () => {
  await browser.servePage("left.html", REPORT);
  await browser.servePage("right.html", REPORT);
  render(["left.html", "right.html"]);
  const right = frameOf(1);
  await ready(frameOf(0));
  await ready(right);
  await userEvent.click(right);

  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();

  const pane = (right.closest("[data-pane]") as HTMLElement).getBoundingClientRect();
  const shown = (panelOf() as HTMLElement).getBoundingClientRect();
  expect({
    left: Math.abs(shown.left - pane.left) < 1,
    width: Math.abs(shown.width - pane.width) < 1,
    bottom: Math.abs(shown.bottom - pane.bottom) < 1,
  }).toEqual({ left: true, width: true, bottom: true });
});

it("at 390x844 with touch, the header shows and the toolbar's space button opens the panel over a page", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true });
  await browser.servePage(REPORT_PATH, REPORT);
  render([REPORT_PATH], true);
  const frame = frameOf(0);
  await ready(frame);
  await userEvent.click(frame);

  // The toolbar's own button, which hands the focus's pane to the panel.
  await userEvent.click(
    document.querySelector("button[aria-label='Show the leader keys']") as HTMLElement,
  );

  await expect.poll(panelOf).not.toBeNull();
  expect(panelOf()?.querySelector("[data-sheet-drag]")).not.toBeNull();
  const link = host.querySelector("[data-html-pane] a");
  expect(link).not.toBeNull();
  expect((link as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
