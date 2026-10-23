/**
 * The mounting and the helpers the take tests share (#787): the real pane over a
 * served page, the messages the frame posts back, and the outbox cleared between
 * tests. Each test file imports `./html-take-api` first, so the API stub is
 * installed before the client is made.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands as browser, page, userEvent } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import { reset } from "@/lib/outbox";
import { periodicNote } from "@/lib/periodic";
import { PALETTE_KEY, THEME_KEY } from "@/lib/theme";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";
import { api, resetApi } from "./html-take-api";

export type Spy = ReturnType<typeof stubCommands>;

/** One message the window heard, from whatever window sent it. */
interface Heard {
  source: MessageEventSource | null;
  data: Record<string, unknown>;
}

const heard: Heard[] = [];
window.addEventListener("message", (event: MessageEvent) => {
  heard.push({ source: event.source, data: event.data ?? {} });
});

/** What a test mounts with, so its teardown can take it down. */
export interface Mounted {
  host: HTMLDivElement;
  root: Root;
  spy: Spy;
}

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** The viewport, the outbox and the look cleared, and a host to mount into. */
export async function setUp(): Promise<Mounted> {
  await page.viewport(1440, 900);
  localStorage.removeItem("kasten.vim");
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(PALETTE_KEY);
  await reset();
  await dropped();
  resetApi(periodicNote("daily", new Date()).path);
  heard.length = 0;
  const host = document.body.appendChild(document.createElement("div"));
  return { host, root: createRoot(host), spy: stubCommands() };
}

/** Unmounts, and gives back the viewport, the emulated media and the served pages. */
export async function tearDown({ host, root }: Mounted) {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(PALETTE_KEY);
  await browser.unservePages();
  await page.viewport(1440, 900);
  await browser.emulateMedia({});
}

/** The pane's own commands, the layout's panels, and one pane per path. */
function Layout({ paths, spy, phone }: { paths: string[]; spy: Spy; phone: boolean }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        {paths.map((path) => (
          <div key={path} data-pane className="min-w-0 flex-1">
            <HtmlPane path={path} commands={spy} onFocus={() => {}} />
          </div>
        ))}
      </div>
      {phone && <Toolbar commands={spy} split={paths.length > 1} />}
      <WhichKey phone={phone} />
    </div>
  );
}

/** Mounts one pane per path, the phone's toolbar when asked. */
export function render(mounted: Mounted, paths: string[], phone = false) {
  flushSync(() => mounted.root.render(<Layout paths={paths} spy={mounted.spy} phone={phone} />));
}

/** The iframe of the pane at `index`. */
export function frameOf(mounted: Mounted, index: number): HTMLIFrameElement {
  return mounted.host.querySelectorAll("iframe")[index] as HTMLIFrameElement;
}

/** Waits for the page's own script to say hello, which it does once it has run. */
export async function ready(frame: HTMLIFrameElement) {
  await expect
    .poll(() => heard.some((h) => h.source === frame.contentWindow && h.data.kasten === "hello"))
    .toBe(true);
}

/** The frame's document, for the locators a drag starts and ends on. */
export function inFrame(frame: HTMLIFrameElement) {
  return page.frameLocator(page.elementLocator(frame));
}

/**
 * Asks the page a question and answers with its reply, waited on, since the
 * frame's DOM is out of reach. The reply is the one named `fixture`.
 */
export async function ask(
  frame: HTMLIFrameElement,
  probe: Record<string, unknown>,
  fixture: string,
): Promise<Record<string, unknown>> {
  const before = heard.length;
  const reply = () =>
    heard.slice(before).find((h) => h.source === frame.contentWindow && h.data.fixture === fixture);
  frame.contentWindow?.postMessage(probe, "*");
  await expect.poll(reply).not.toBeUndefined();
  return reply()?.data ?? {};
}

/**
 * Selects `range` in the page as a mouse does, and waits for the page to say it has.
 * A click into the frame first, since the pane counts a selection only while the
 * frame holds the focus, and a reader's selection is made by a press in it.
 */
export async function select(frame: HTMLIFrameElement, range: [string, number, string, number]) {
  await userEvent.click(frame);
  await ask(frame, { probe: "select", range }, "selected");
}

/** Whether a message with `fixture` has been heard from any window. */
export function heardFrom(fixture: string): boolean {
  return heard.some((h) => h.data.fixture === fixture);
}

/** The window a message with `fixture` came from, for closing a window the page opened. */
export function sourceOf(fixture: string): MessageEventSource | null {
  return heard.find((h) => h.data.fixture === fixture)?.source ?? null;
}

/** The take button, once the pane has drawn one over the selection. */
export function takeButton(mounted: Mounted): HTMLElement | null {
  return mounted.host.querySelector<HTMLElement>("[data-take]");
}

/** The take button's own text, one span each: the word, the `y`, the heading. */
export function buttonParts(mounted: Mounted): string[] {
  return [...(takeButton(mounted)?.querySelectorAll("span") ?? [])].map((s) => s.textContent ?? "");
}

/** The button in the document with exactly `text`, such as the toast's Undo. */
export function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text,
  );
}

/** The panel of the which-key leader, when it is open. */
export function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

/** Whether the whole of `inner` lies inside `outer`. */
export function inside(inner: Element, outer: Element): boolean {
  const a = inner.getBoundingClientRect();
  const b = outer.getBoundingClientRect();
  return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
}

/** What the take has written, read back from the stub: the dumps sent and the daily note's writes. */
export { api };
