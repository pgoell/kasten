import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import "@/styles/app.css";

/** The root and host of the last editor a test mounted. */
export type App = { root: Root; host: HTMLElement };

/** The test file's `app` variable, which the helpers here and the test bodies both set. */
export interface AppSlot {
  get: () => App | undefined;
  set: (app: App | undefined) => void;
}

let slot: AppSlot = { get: () => undefined, set: () => {} };

/** The hook each wikilink-tap test file calls first, with its `app`: it unmounts what a test mounted. */
export function tapCleanup(app: AppSlot): void {
  slot = app;
  afterEach(async () => {
    const current = slot.get();
    if (current !== undefined) {
      const { root, host } = current;
      root.unmount();
      host.remove();
      slot.set(undefined);
    }
    vi.restoreAllMocks();
    // All of it, not only the vim setting: the editor keeps each note's cursor
    // by path (`kasten.positions.1`), and R7 and R8 both open `Y.md`, so R7's
    // cursor on line 2 would open R8's note with that line showing its source.
    localStorage.clear();
    // A tap far from the links. Chrome counts a tap on the spot of the one
    // before as its second, so without this a test's tap on a link reaches the
    // click as `detail` 2 when the test before tapped there too.
    const frame = window.frameElement?.getBoundingClientRect();
    const corner = {
      x: (frame?.left ?? 0) + window.innerWidth - 2,
      y: (frame?.top ?? 0) + window.innerHeight - 2,
    };
    await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [corner] });
    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await page.viewport(414, 896);
  });
}

export type How = "tap" | "ctrl" | "meta";

/** The app's own editor on `doc`, on a phone for a tap and a desktop for a press, once `selector` is drawn. */
export async function appWith(doc: string, how: How, vim: string, selector: string) {
  if (how === "tap") {
    await page.viewport(414, 896);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  } else await page.viewport(1280, 900);
  localStorage.setItem("kasten.vim", vim);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${how === "tap" ? 896 : 900}px;`;
  const root = createRoot(host);
  const follow = vi.fn();
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={doc} onFollow={follow} />
    </QueryClientProvider>,
  );
  slot.set({ root, host });
  await expect.poll(() => host.querySelector(selector)).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  return { at, follow };
}

/** The `index`th rendered wikilink on line `line`, counted from 0. */
export function linkOn(at: EditorView, line: number, index = 0): Element {
  const row = at.contentDOM.querySelectorAll(".cm-line")[line] as Element;
  return row.querySelectorAll(".cm-wikilink")[index] as Element;
}

/** The wikilink in the drawn table's first body cell. */
export function cellLink(at: EditorView): Element {
  return at.dom.querySelector(".cm-table-block tbody .cm-wikilink") as Element;
}

/** The page coordinates of `element`'s centre, checked to be on it rather than beside it. */
export function on(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const point: [number, number] = [box.left + box.width / 2, box.top + box.height / 2];
  expect(document.elementFromPoint(...point)).toBe(element);
  return framed(point);
}

/** A point in the frame as the DevTools protocol takes it, in the page the frame sits in. */
export function framed([x, y]: [number, number]): [number, number] {
  const frame = window.frameElement?.getBoundingClientRect();
  return [x + (frame?.left ?? 0), y + (frame?.top ?? 0)];
}

/** The page coordinates `dx` across from position `pos`, as the DevTools protocol takes them. */
export function textAt(at: EditorView, pos: number, dx: number): [number, number] {
  const coords = at.coordsAtPos(pos) as { left: number; top: number; bottom: number };
  return framed([coords.left + dx, (coords.top + coords.bottom) / 2]);
}

/** The page coordinates just inside `element`'s left edge. */
export function leftOf(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  return framed([box.left + 2, box.top + box.height / 2]);
}

/** A finger put down at `x`, `y` in the page and lifted again. */
export async function tapAt([x, y]: [number, number]): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A left button pressed and let go at `x`, `y`, with ctrl as 2 and meta as 4, as click `count`. */
export async function pressAt(
  [x, y]: [number, number],
  modifiers: number,
  count = 1,
): Promise<void> {
  const at = { x, y, modifiers, button: "left" as const, clickCount: count };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** A finger, or a press with ctrl or meta, on `element`. */
export async function act(element: Element, how: How): Promise<void> {
  if (how === "tap") await tapAt(on(element));
  else await pressAt(on(element), how === "ctrl" ? 2 : 4);
}

/** Two of `act` on `element` in quick succession, the second counted as the second. */
export async function twice(element: Element, how: How): Promise<void> {
  const point = on(element);
  if (how === "tap") {
    await tapAt(point);
    await tapAt(point);
    return;
  }
  for (const count of [1, 2]) await pressAt(point, how === "ctrl" ? 2 : 4, count);
}

/**
 * The `detail` of every click on the editor. Seen in the capture phase, before
 * anything can stop it, so the second counted is the second sent.
 */
export function clicks(at: EditorView): number[] {
  const details: number[] = [];
  at.dom.addEventListener("click", (event) => details.push(event.detail), true);
  return details;
}

export const CAT = "https://example.com/cat.png";

/** A 320 by 180 PNG in one colour, as a data URL, for a picture to have a size. */
export function picture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "#61afef";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** `window.open`, stubbed so a follow is seen and no tab opens. */
export function stubOpen() {
  return vi.spyOn(window, "open").mockImplementation(() => null);
}

/** Two frames, for anything a click already handled set going to show. */
export async function settled(): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    await new Promise((done) => requestAnimationFrame(done));
  }
}

/** Waited on until the tap or press has landed: a note followed or the cursor moved off `head`. */
export async function landed(at: EditorView, follow: ReturnType<typeof vi.fn>, head: number) {
  await expect
    .poll(() => follow.mock.calls.length > 0 || at.state.selection.main.head !== head, {
      message: "the tap landing",
    })
    .toBe(true);
  await settled();
}

/** Both clicks of a double tap or press landed, the second counted as the second. */
export async function bothLanded(details: number[]) {
  await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(2);
  await settled();
  expect(details[1], "the second click's detail").toBe(2);
}

export const VIMS = ["off", "on"];
export const PRESSES = (["ctrl", "meta"] as const).flatMap((how) =>
  VIMS.map((vim) => [how, vim] as const),
);
export const WHERE = (["line", "cell"] as const).flatMap((where) =>
  PRESSES.map(([how, vim]) => [how, where, vim] as const),
);

/** Two links to one note on two lines. */
export const TWO = "[[Some note]] one\n[[Some note]] two";
/** A link to the note on a line, and another in a table's cell. */
export const TABLED = [
  "[[Some note]]",
  "",
  "| a | b |",
  "| --- | --- |",
  "| [[Some note]] | c |",
].join("\n");
/** A link to the note in a table's cell. */
export const CELL = ["A table", "", "| a | b |", "| --- | --- |", "| [[Some note]] | c |"].join(
  "\n",
);
