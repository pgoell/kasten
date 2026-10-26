/**
 * The shared harness of the page-script frame tests: the frame, the messages it
 * posts back, and the pages both test files serve. `html-page-script.test.tsx`
 * and `html-page-take.test.tsx` import it, and each calls `afterEach(cleanup)`.
 */

import { commands } from "vitest/browser";

/** The path `servePage` answers for, and the frame loads. */
export const PAGE = "fixture.html";

/**
 * What a fixture posts back. `y` is set on the scroll answer, `value` on a field's input,
 * and the theme, palette, open, marker fields on the state answer.
 */
export interface Message {
  kasten?: string;
  key?: string;
  fixture?: string;
  y?: number;
  value?: string;
  prevented?: boolean;
  atWindow?: boolean;
  theme?: string;
  palette?: string;
  open?: boolean;
  marker?: string;
  search?: string;
  text?: string;
  heading?: string;
  anchor?: string;
  rect?: { left: number; top: number; right: number; bottom: number } | null;
  texts?: string[];
  html?: string;
  styles?: number;
  selection?: string;
  source?: string;
  labels?: string[];
  disabled?: boolean[];
}

/**
 * Every fixture carries this, so a test can see what reached the page.
 *
 * `keydown` is reported in the bubble phase, so a key kasten stopped never
 * shows up in it. That is how a test knows kasten took the key. The frame posts
 * in order, so a letter pressed last is a barrier: once it has been reported,
 * everything pressed before it has been posted.
 */
export const REPORT = `<script>
addEventListener("keydown", (event) => parent.postMessage({ fixture: "keydown", key: event.key }, "*"));
addEventListener("message", () => parent.postMessage({ fixture: "scroll", y: scrollY }, "*"));
</script>`;

export const FIELD_STYLE =
  "position:fixed;inset:0;width:100%;height:100%;box-sizing:border-box;margin:0;font:32px sans-serif";

/**
 * A page whose one control fills the frame, so a click at its centre lands in it.
 * Tall as well, so a `j` or `k` that reached the page would move its scroll.
 */
export function field(control: string): string {
  return `<!doctype html><title>field</title><body>${control}<div style="height:3000px"></div>${REPORT}<script>
const field = document.querySelector("#field");
field.addEventListener("input", () => parent.postMessage({ fixture: "value", value: field.value }, "*"));
</script></body>`;
}

/**
 * The page as `servePage` serves it now: the backend puts Kasten's script at the
 * start of every page, so the body is all this adds.
 */
export function atStart(body: string): string {
  return `<!doctype html><title>start</title>${body}`;
}

/**
 * Selects a range in the page the way a mouse does, and ends it with the mouseup
 * a mouse sends. `range` is [element id, offset, element id, offset] over each
 * element's first text. `clear` empties the selection, `scrollBy` scrolls the
 * page, and `touch` sends a touch pointerdown first. A frame is sandboxed, so the
 * page makes its own selection on a message.
 */
export const SELECTING = `<script>
addEventListener("message", (event) => {
  const data = event.data;
  if (typeof data !== "object" || data === null) return;
  const selection = getSelection();
  if (data.touch) document.body.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
  if (data.range) {
    const [from, fromAt, to, toAt] = data.range;
    const range = document.createRange();
    // "document" starts the range at the document itself, which has no parent element.
    const at = (id) => (id === "document" ? document : document.getElementById(id).firstChild);
    range.setStart(at(from), fromAt);
    range.setEnd(at(to), toAt);
    selection.removeAllRanges();
    selection.addRange(range);
    if (data.mouseup) document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }
  if (data.clear) selection.removeAllRanges();
  if (data.scrollBy) scrollBy(0, data.scrollBy);
});
</script>`;

/** A page with no article and no heading: one passage under an id. */
export const PLAIN = atStart(
  `<div id="top"><p id="line">Alpha bravo charlie.</p></div><div style="height:3000px"></div>${SELECTING}`,
);

/** Two articles as the newspaper prints them, each with its story id link. */
export const NEWSPAPER = atStart(
  `<article id="2026-10-07-evals-01"><a class="sid" href="#2026-10-07-evals-01">#2026-10-07-evals-01</a><h2>First story</h2><p id="a">Alpha bravo charlie.</p></article><article id="2026-10-07-evals-02"><a class="sid" href="#2026-10-07-evals-02">#2026-10-07-evals-02</a><h2>Second story</h2><p id="b">Delta echo foxtrot.</p></article><div style="height:3000px"></div>${REPORT}${SELECTING}`,
);

/**
 * Two paragraphs to mark, and a probe that answers with the marks kasten made
 * and the page's markup. A message from anywhere but the parent is reported as
 * `heard`, and `nest` makes the page tell a nested frame to take.
 */
const MARKS = `<p id="a">Alpha bravo charlie.</p><p id="b">Delta echo foxtrot.</p><div style="height:3000px"></div>${SELECTING}<script>
addEventListener("message", (event) => {
  if (event.source !== parent) parent.postMessage({ fixture: "heard" }, "*");
  if (event.data === "nest") document.querySelector("iframe").contentWindow.postMessage("go", "*");
  if (event.data === "marks") {
    const highlight = CSS.highlights.get("kasten-taken");
    parent.postMessage({ fixture: "marks", texts: highlight ? [...highlight].map((range) => range.toString()) : [], html: document.documentElement.outerHTML, styles: document.querySelectorAll("style").length, selection: getSelection().toString() }, "*");
  }
});
</script>`;

/** A page with the marks, with `head` and `extra` added before its body. */
export function marksPage(head = "", extra = ""): string {
  return `<!doctype html><title>marks</title>${head}<body>${extra}${MARKS}</body>`;
}

/** A frame that takes the passage when the page tells it to go, as a window other than kasten would. */
export const NESTED = `<iframe srcdoc="<script>addEventListener('message', () => parent.postMessage({kasten: 'take', id: 1}, '*'));</script>"></iframe>`;

let frame: HTMLIFrameElement | undefined;
export const messages: Message[] = [];

window.addEventListener("message", (event: MessageEvent<Message>) => {
  if (frame && event.source === frame.contentWindow) messages.push(event.data);
});

/** Removes the frame and its messages after each test. Each test file runs it in `afterEach`. */
export async function cleanup() {
  frame?.remove();
  frame = undefined;
  messages.length = 0;
  await commands.unservePages();
}

/**
 * Serve `html` as the page, and draw it in a frame sandboxed the way the pane sandboxes one.
 * `query` is the request's query, which the backend reads for the theme and palette.
 */
export async function mount(html: string, query = ""): Promise<HTMLIFrameElement> {
  await commands.servePage(PAGE, html);
  const element = document.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  element.style.cssText = "position:fixed;top:0;left:0;width:800px;height:400px;border:0";
  const loaded = new Promise((resolve) =>
    element.addEventListener("load", resolve, { once: true }),
  );
  element.src = `/api/html/${PAGE}${query}`;
  frame = element;
  document.body.append(element);
  await loaded;
  return element;
}

/** The keys kasten was sent, in the order the frame posted them. */
export function keysSent(): (string | undefined)[] {
  return messages.filter((m) => m.kasten === "key").map((m) => m.key);
}

/** Whether the page saw `key` reach its own window. */
export function reported(key: string): boolean {
  return messages.some((m) => m.fixture === "keydown" && m.key === key);
}

/** The page's scroll position, asked for and waited on, since a frame's DOM is out of reach. */
export async function scrollY(): Promise<number | undefined> {
  const before = messages.length;
  frame?.contentWindow?.postMessage("read", "*");
  await expect.poll(() => messages.slice(before).some((m) => m.fixture === "scroll")).toBe(true);
  return messages.slice(before).find((m) => m.fixture === "scroll")?.y;
}

/** Post `data` to the frame from this window, which is the frame's parent, as kasten is. */
export function sendToPage(data: unknown) {
  frame?.contentWindow?.postMessage(data, "*");
}

/** The page's state, asked for and waited on, since a frame's DOM is out of reach. */
export async function pageState(): Promise<Message | undefined> {
  const before = messages.length;
  frame?.contentWindow?.postMessage("state", "*");
  await expect.poll(() => messages.slice(before).some((m) => m.fixture === "state")).toBe(true);
  return messages.slice(before).find((m) => m.fixture === "state");
}

/** The last selection kasten was sent. */
export function lastSelection(): Message | undefined {
  return messages.filter((m) => m.kasten === "selection").at(-1);
}

/** Selects a range of the page as a mouse would, and ends it with a mouseup. */
export function selectMouse(range: [string, number, string, number]) {
  sendToPage({ range, mouseup: true });
}

/** The page's marks and markup, asked for and waited on. */
export async function marks(): Promise<Message | undefined> {
  const before = messages.length;
  sendToPage("marks");
  await expect.poll(() => messages.slice(before).some((m) => m.fixture === "marks")).toBe(true);
  return messages.slice(before).find((m) => m.fixture === "marks");
}
