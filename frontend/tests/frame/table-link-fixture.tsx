import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim as vimKeymap } from "@replit/codemirror-vim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import { kastenTheme } from "@/lib/editor/editor-theme";
import { vimKeys } from "@/lib/editor/vim-mode";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/markdown/note-language";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

export const SITE = "https://example.com";

let view: EditorView | undefined;
let app: { root: Root; host: HTMLElement } | undefined;

/** The hook each table-link test file calls first: it unmounts what a test mounted. */
export function tableLinkCleanup(): void {
  afterEach(async () => {
    view?.dom.parentElement?.remove();
    view?.destroy();
    view = undefined;
    if (app !== undefined) {
      const { root, host } = app;
      root.unmount();
      host.remove();
      app = undefined;
    }
    vi.restoreAllMocks();
    localStorage.removeItem("kasten.vim");
    // A tap far from the table. Chrome counts a tap on the spot of the one
    // before as its second, so without this a test's tap on a cell reaches the
    // click as `detail` 2 when the test before tapped there too, and a follow,
    // which only the first click makes, never comes.
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

/** A 320 by 180 PNG in one colour, as a data URL. */
export function picture(colour: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** The editor the way the app mounts a note, filling the pane, the cursor on the first line. */
export function mount(doc: string, vim: boolean, height: number): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteLanguage(),
        kastenTheme,
        // As the app has it: vim's keys, or the facet saying there are none.
        vim ? vimKeymap() : vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
  view.dom.style.height = "100%";
  return view;
}

interface AppProps {
  /** The vim setting, "on" or "off"; absent is its default, on for a mouse and off for a finger. */
  vim?: string;
  onFollow?: (target: string) => void;
  paths?: string[];
  images?: string[];
}

/** The app's own editor on `doc`, as the route mounts it, `height` tall. */
export function mountApp(
  doc: string,
  height: number,
  { vim, ...props }: AppProps = {},
): HTMLElement {
  if (vim === undefined) localStorage.removeItem("kasten.vim");
  else localStorage.setItem("kasten.vim", vim);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={doc} {...props} />
    </QueryClientProvider>,
  );
  app = { root, host };
  return host;
}

/** A phone: 414 wide and a finger for a pointer, which is what `pointer: coarse` reads. */
export async function phone(): Promise<void> {
  await page.viewport(414, 896);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
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

/** A finger put down at `x`, `y` in the page and lifted again. */
export async function tapAt([x, y]: [number, number]): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A finger put down on `element` and lifted again. */
export async function tap(element: Element): Promise<void> {
  await tapAt(on(element));
}

/**
 * A finger put down on `element`, moved 80px up and held still before it lifts. A lift
 * at speed starts a fling, and Chrome swallows the tap that stops one (#1451).
 */
export async function drag(element: Element): Promise<void> {
  const [x, y] = on(element);
  // Stamped a second back, so the hold costs no wait.
  const start = Date.now() / 1000 - 1;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", up: number, after: number) =>
    cdp().send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: y - up }],
      timestamp: start + after,
    });
  await touch("touchStart", 0, 0);
  for (const step of [1, 2, 3, 4]) await touch("touchMove", step * 20, step / 60);
  // A pixel on, as a move that goes nowhere may be dropped.
  await touch("touchMove", 81, 0.5);
  await touch("touchEnd", 81, 0.5);
}

/**
 * Room for the frame's page to scroll, scrolled 100px down, so a fling a drag left
 * would outlive the lift. Gone when the test ends.
 */
export function roomToScroll(): void {
  // Above as well as below, so the first line is still in view after the scroll.
  const above = document.body.insertBefore(document.createElement("div"), document.body.firstChild);
  const below = document.body.appendChild(document.createElement("div"));
  above.style.height = "200px";
  below.style.height = "2000px";
  onTestFinished(() => {
    above.remove();
    below.remove();
    scrollTo(0, 0);
  });
  scrollTo(0, 100);
}

/** A left button pressed and let go on `element`, with ctrl as 2 and meta as 4. */
export async function press(element: Element, modifiers: number): Promise<void> {
  const [x, y] = on(element);
  const at = { x, y, modifiers, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
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

type How = "tap" | "ctrl" | "meta" | "plain";

/** A note of `lines` with its table last, and where that table starts, its first line being `head`. */
export function tabled(lines: string[], head: string): { doc: string; from: number } {
  const doc = lines.join("\n");
  return { doc, from: doc.indexOf(head) };
}

/** A note whose table, with outer pipes, holds `link` in its first body cell. */
export function linkedIn(link: string) {
  return tabled(["A table", "", "| a | b |", "| --- | --- |", `| ${link} | c |`], "| a | b |");
}

/**
 * The app's editor on `doc`, on a phone for a tap and a desktop for a press,
 * once `selector` is drawn in its table.
 */
export async function appWith(
  doc: string,
  how: How,
  vim: string,
  selector: string,
  props: AppProps = {},
) {
  if (how === "tap") await phone();
  else await page.viewport(1280, 900);
  const host = mountApp(doc, how === "tap" ? 896 : 900, { vim, ...props });
  await expect.poll(() => host.querySelector(`.cm-table-block ${selector}`)).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  const block = host.querySelector(".cm-table-block") as Element;
  return { at, block, element: block.querySelector(selector) as Element };
}

/** A finger on `element`, or a left press with ctrl, meta or neither. */
export async function act(element: Element, how: How): Promise<void> {
  if (how === "tap") await tap(element);
  else await press(element, { ctrl: 2, meta: 4, plain: 0 }[how]);
}

/**
 * Waited on until the press has landed whichever way it goes: a note
 * followed, a tab opened, the table opened, or the cursor moved off `head`.
 */
export async function landed(
  at: EditorView,
  block: Element,
  follow: ReturnType<typeof vi.fn>,
  open: ReturnType<typeof stubOpen>,
  head = 0,
) {
  await expect
    .poll(
      () =>
        follow.mock.calls.length > 0 ||
        open.mock.calls.length > 0 ||
        !block.isConnected ||
        at.state.selection.main.head !== head,
      { message: "the press landing" },
    )
    .toBe(true);
  await settled();
}

/** The press followed the wikilink to `target` once, opened no tab and left the table drawn. */
export async function followedNote(
  at: EditorView,
  block: Element,
  follow: ReturnType<typeof vi.fn>,
  open: ReturnType<typeof stubOpen>,
  target: string,
  head = 0,
) {
  await landed(at, block, follow, open, head);
  expect.soft(block.isConnected, "the table stays drawn").toBe(true);
  expect.soft(open, "no tab opened").not.toHaveBeenCalled();
  expect(follow).toHaveBeenCalledExactlyOnceWith(target);
}

/** The press opened the table and nothing else: the cursor in it, its source showing. */
export async function openedOnly(
  at: EditorView,
  from: number,
  block: Element,
  follow: ReturnType<typeof vi.fn>,
  open: ReturnType<typeof stubOpen>,
) {
  await landed(at, block, follow, open);
  expect.soft(block.isConnected, "the table shows its source").toBe(false);
  expect.soft(at.state.selection.main.head, "the cursor in the table").toBeGreaterThanOrEqual(from);
  expect.soft(follow, "no note followed").not.toHaveBeenCalled();
  expect(open, "no tab opened").not.toHaveBeenCalled();
}

export const VIMS = ["off", "on"];
export const BOTH = (["tap", "ctrl"] as const).flatMap((how) =>
  VIMS.map((vim) => [how, vim] as const),
);
export const PRESSES = (["ctrl", "meta"] as const).flatMap((how) =>
  VIMS.map((vim) => [how, vim] as const),
);
