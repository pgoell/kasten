/**
 * A tap or a press on a picture inside a link follows the link (#558).
 *
 * The picture's own click listener from #552 is what hears the press, the
 * widget keeping it from the editor's tap and ctrl+click, so this runs where
 * picture-tap.test.tsx does: a real browser, a real finger from the DevTools
 * protocol, and the picture loaded from a canvas once its address is checked.
 * `window.open` is stubbed, so no tab opens. Two tests mount the app's own
 * editor, whose ctrl+click and tap handlers sit beside the picture's and must
 * not open the link a second time.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim as vimKeymap } from "@replit/codemirror-vim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

const CAT = "https://example.com/cat.png";
const SITE = "https://example.com";
const IMAGE = `![a](${CAT})`;
const linked = (address: string) => `[${IMAGE}](${address})`;
const LINKED = linked(SITE);
const NOTE = ["A cat", "", LINKED].join("\n");
const REFERENCE = `[${IMAGE}][ref]`;
const REFERENCED = ["A cat", "", REFERENCE, "", `[ref]: ${SITE}`].join("\n");
const UNLINKED = ["A cat", "", IMAGE].join("\n");

let view: EditorView | undefined;
let app: { root: Root; host: HTMLElement } | undefined;

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
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.viewport(414, 896);
});

/** A 320 by 180 PNG in one colour, as a data URL. */
function picture(colour: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** The editor the way the app mounts a note, filling the pane, the cursor on the first line. */
function mount(doc: string, vim: boolean, height: number): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteLanguage(),
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

/**
 * The app's own editor on `doc`, as the route mounts it, `height` tall. Vim
 * is the setting's default, on for a mouse and off for a finger.
 */
function mountApp(doc: string, height: number): HTMLElement {
  localStorage.removeItem("kasten.vim");
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={doc} />
    </QueryClientProvider>,
  );
  app = { root, host };
  return host;
}

/** The picture, its address checked and then loaded from a canvas so it has a size. */
async function loaded(within: Element): Promise<HTMLImageElement> {
  await expect.poll(() => within.querySelectorAll("img.cm-image").length).toBe(1);
  const image = within.querySelector("img.cm-image") as HTMLImageElement;
  expect(image.getAttribute("src")).toBe(CAT);
  image.src = picture("#61afef");
  await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
  return image;
}

/** A phone: 414 wide and a finger for a pointer, which is what `pointer: coarse` reads. */
async function phone(): Promise<void> {
  await page.viewport(414, 896);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
}

/** The page coordinates of `element`'s centre, checked to be on it rather than beside it. */
function on(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const point: [number, number] = [box.left + box.width / 2, box.top + box.height / 2];
  expect(document.elementFromPoint(...point)).toBe(element);
  // The DevTools protocol takes the page's coordinates, and the test runs in a
  // frame placed inside that page.
  const frame = window.frameElement?.getBoundingClientRect();
  return [point[0] + (frame?.left ?? 0), point[1] + (frame?.top ?? 0)];
}

/** A finger put down on `element` and lifted again. */
async function tap(element: Element): Promise<void> {
  const [x, y] = on(element);
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A left button pressed and let go on `element`, with ctrl as 2. */
async function press(element: Element, modifiers: number): Promise<void> {
  const [x, y] = on(element);
  const at = { x, y, modifiers, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** Two clicks on `element` in quick succession, the second counted as the second. */
async function doublePress(element: Element): Promise<void> {
  const [x, y] = on(element);
  for (const clickCount of [1, 2]) {
    const at = { x, y, modifiers: 0, button: "left" as const, clickCount };
    await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
  }
}

/** Where `source` sits in `doc`. */
function range(doc: string, source: string): [number, number] {
  const from = doc.indexOf(source);
  return [from, from + source.length];
}

/** `window.open`, stubbed so a follow is seen and no tab opens. */
function stubOpen() {
  return vi.spyOn(window, "open").mockImplementation(() => null);
}

/** Two frames, by which a click the press made has been handled. */
async function settled(): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    await new Promise((done) => requestAnimationFrame(done));
  }
}

/** The cursor comes to rest in `from..to`; `what` names the press in the failure. */
async function cursorIn(at: EditorView, [from, to]: [number, number], what: string) {
  await expect
    .poll(() => at.state.selection.main.head, { message: `the cursor after ${what}` })
    .toSatisfy((head: number) => head >= from && head <= to);
}

/**
 * The press followed the link to `address` once and left the cursor where it
 * was. The cursor is a soft check, so on a build that moves it instead the
 * open is still asked about.
 */
async function followed(at: EditorView, open: ReturnType<typeof stubOpen>, address: string) {
  await settled();
  expect.soft(at.state.selection.main.head, "the cursor stays out of the link").toBe(0);
  expect(open).toHaveBeenCalledExactlyOnceWith(address, "_blank", "noopener");
}

describe("a tap or a press on a picture inside a link (#558)", () => {
  it.each(["off", "on"])("A1 a tap on a linked picture with vim %s opens the link", async (vim) => {
    await phone();
    const at = mount(NOTE, vim === "on", 896);
    const image = await loaded(at.dom);
    const open = stubOpen();

    await tap(image);
    await followed(at, open, SITE);
  });

  it.each([
    ["plain", "off"],
    ["ctrl", "off"],
    ["plain", "on"],
    ["ctrl", "on"],
  ])(
    "A2 a %s press on a linked picture on a desktop with vim %s opens the link once",
    async (kind, vim) => {
      await page.viewport(1280, 900);
      const at = mount(NOTE, vim === "on", 900);
      const image = await loaded(at.dom);
      const open = stubOpen();

      await press(image, kind === "ctrl" ? 2 : 0);
      await followed(at, open, SITE);
    },
  );

  it("A3 a tap on a picture not inside a link moves the cursor onto it and opens nothing", async () => {
    await phone();
    const at = mount(UNLINKED, false, 896);
    const image = await loaded(at.dom);
    const open = stubOpen();

    await tap(image);
    await cursorIn(at, range(UNLINKED, IMAGE), "a tap");
    await settled();
    expect(open).not.toHaveBeenCalled();
  });

  it("A3 a press on a picture not inside a link on a desktop moves the cursor onto it and opens nothing", async () => {
    await page.viewport(1280, 900);
    const at = mount(UNLINKED, false, 900);
    const image = await loaded(at.dom);
    const open = stubOpen();

    await press(image, 0);
    await cursorIn(at, range(UNLINKED, IMAGE), "a press");
    await settled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "notes/x.md"])(
    "I1 a tap on a picture inside a link to %s moves the cursor onto it and opens nothing",
    async (address) => {
      const doc = ["A cat", "", linked(address)].join("\n");
      await phone();
      const at = mount(doc, false, 896);
      const image = await loaded(at.dom);
      const open = stubOpen();

      await tap(image);
      await cursorIn(at, range(doc, linked(address)), "a tap");
      await settled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("I2 a tap on a picture inside a reference link opens the address its definition gives", async () => {
    await phone();
    const at = mount(REFERENCED, false, 896);
    const image = await loaded(at.dom);
    const open = stubOpen();

    await tap(image);
    await followed(at, open, SITE);
  });

  it("I3 a finger that lands on a linked picture and scrolls opens nothing", async () => {
    await phone();
    const at = mount(NOTE, false, 896);
    const image = await loaded(at.dom);
    const open = stubOpen();

    const [x, y] = on(image);
    await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const step of [20, 40, 60, 80]) {
      await cdp().send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step }],
      });
    }
    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await settled();
    expect(at.state.selection.main.head).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  it("I4 a tap on a linked picture with vim on and the cursor in the link moves the cursor and opens nothing", async () => {
    await phone();
    const at = mount(NOTE, true, 896);
    const [, end] = range(NOTE, LINKED);
    // The link's end, the one place in it a cursor rests with vim reading:
    // every character of the link is hidden, and `skipHidden` walks a cursor
    // forward off a hidden one.
    at.dispatch({ selection: { anchor: end } });
    const image = await loaded(at.dom);
    const open = stubOpen();
    const before = at.state;

    await tap(image);
    // The cursor the tap puts on the picture walks to the same end, so the
    // move shows as a new state rather than a new head.
    await expect.poll(() => at.state, { message: "a state after the tap" }).not.toBe(before);
    expect(at.state.selection.main.head).toBe(end);
    await settled();
    expect(open).not.toHaveBeenCalled();
  });

  it("A2 a ctrl press on a linked picture in the app's editor opens the link once", async () => {
    await page.viewport(1280, 900);
    const image = await loaded(mountApp(NOTE, 900));
    const open = stubOpen();

    await press(image, 2);
    await settled();
    expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
  });

  it("A1 a tap on a linked picture in the app's editor opens the link once", async () => {
    await phone();
    const image = await loaded(mountApp(NOTE, 896));
    const open = stubOpen();

    await tap(image);
    await settled();
    expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
  });

  it("B1 a double-click on a linked picture on a desktop opens the link once", async () => {
    await page.viewport(1280, 900);
    const at = mount(NOTE, false, 900);
    const image = await loaded(at.dom);
    const open = stubOpen();

    await doublePress(image);
    await settled();
    expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
  });
});
