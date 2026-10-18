/**
 * A tap on a drawn picture puts the cursor on it, as a press does (#552).
 *
 * jsdom has no touch and loads no image, so this runs in a real browser with a
 * real finger from the DevTools protocol: CodeMirror reads a touch apart from a
 * mouse, and a click would test the mouse. The frame runner fetches nothing
 * from `example.com`, so the picture is pointed at one drawn on a canvas once
 * the address the widget wrote is checked.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim as vimKeymap } from "@replit/codemirror-vim";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, page, userEvent } from "vitest/browser";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

const CAT = "https://example.com/cat.png";
const INLINE = `![cat](${CAT})`;
const REFERENCE = "![cat][pic]";
const NOTE = ["A cat", "", INLINE].join("\n");
const REFERENCED = ["A cat", "", REFERENCE, "", `[pic]: ${CAT}`].join("\n");

let view: EditorView | undefined;

afterEach(async () => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
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

/** The picture, its address checked and then loaded from a canvas so it has a size. */
async function loaded(at: EditorView): Promise<HTMLImageElement> {
  await expect.poll(() => at.dom.querySelectorAll("img.cm-image").length).toBe(1);
  const image = at.dom.querySelector("img.cm-image") as HTMLImageElement;
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

/** The centre of `element`, in the frame's coordinates. */
function centre(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

/**
 * A point in the frame put in the page's coordinates, which is what the
 * DevTools protocol takes: the test runs in a frame placed inside that page.
 */
function toPage(x: number, y: number): [number, number] {
  const frame = window.frameElement?.getBoundingClientRect();
  return [x + (frame?.left ?? 0), y + (frame?.top ?? 0)];
}

/** The page coordinates of `element`'s centre, checked to be on it rather than beside it. */
function on(element: Element): [number, number] {
  const point = centre(element);
  // Beside the picture, a tap or press would put the cursor on the line by
  // another road.
  expect(document.elementFromPoint(...point)).toBe(element);
  return toPage(...point);
}

/** A finger put down on `element` and lifted again. */
async function tap(element: Element): Promise<void> {
  const [x, y] = on(element);
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A left button pressed and let go on `element`, with ctrl as 2 and meta as 4. */
async function press(element: Element, modifiers: number): Promise<void> {
  const [x, y] = on(element);
  const at = { x, y, modifiers, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** Where `source` sits in `doc`, which is the range the picture stands in for. */
function range(doc: string, source: string): [number, number] {
  const from = doc.indexOf(source);
  return [from, from + source.length];
}

/** The cursor comes to rest in `from..to`; `what` names the press in the failure. */
async function cursorIn(at: EditorView, [from, to]: [number, number], what: string) {
  await expect
    .poll(() => at.state.selection.main.head, { message: `the cursor after ${what}` })
    .toSatisfy((head: number) => head >= from && head <= to);
}

/** A tap with vim off: the picture goes and its source shows, the note unchanged. */
async function tapShowsSource(doc: string, source: string): Promise<void> {
  await phone();
  const at = mount(doc, false, 896);
  const image = await loaded(at);

  await tap(image);
  await expect.poll(() => at.dom.querySelector("img.cm-image")).toBeNull();
  expect(at.contentDOM.textContent).toContain(source);
  expect(at.state.doc.toString()).toBe(doc);
}

/**
 * A tap with vim on: normal mode reads, so the picture stays drawn with the
 * cursor on it, and `i` shows its source.
 */
async function tapThenInsert(doc: string, source: string): Promise<void> {
  await phone();
  const at = mount(doc, true, 896);
  const image = await loaded(at);

  await tap(image);
  await cursorIn(at, range(doc, source), "a tap");
  expect(at.dom.querySelector("img.cm-image")).not.toBeNull();
  expect(at.state.doc.toString()).toBe(doc);
  // The keys go where the focus is, so a tap that left it elsewhere would
  // leave `i` nothing to reach.
  expect(at.hasFocus).toBe(true);

  await userEvent.keyboard("i");
  await expect.poll(() => at.dom.querySelector("img.cm-image")).toBeNull();
  expect(at.contentDOM.textContent).toContain(source);
  expect(at.state.doc.toString()).toBe(doc);
}

/** A press on a desktop, plain, with ctrl and with meta, each on a fresh note. */
async function pressesReach(vim: boolean): Promise<void> {
  await page.viewport(1280, 900);
  for (const modifiers of [0, 2, 4]) {
    const at = mount(NOTE, vim, 900);
    const image = await loaded(at);

    await press(image, modifiers);
    await cursorIn(at, range(NOTE, INLINE), `a press with modifiers ${modifiers}`);
    // Vim off writes, so the source shows; vim on reads, so the picture stays.
    if (vim) expect(at.dom.querySelector("img.cm-image")).not.toBeNull();
    else await expect.poll(() => at.dom.querySelector("img.cm-image")).toBeNull();
    expect(at.state.doc.toString()).toBe(NOTE);

    at.dom.parentElement?.remove();
    at.destroy();
    view = undefined;
  }
}

describe("a tap on a drawn picture (#552)", () => {
  it("A1 a tap on an inline picture with vim off shows its source", async () => {
    await tapShowsSource(NOTE, INLINE);
  });

  it("A1 a tap on an inline picture with vim on puts the cursor on it, and i shows its source", async () => {
    await tapThenInsert(NOTE, INLINE);
  });

  it("A2 a tap on a reference picture with vim off shows its source", async () => {
    await tapShowsSource(REFERENCED, REFERENCE);
  });

  it("A2 a tap on a reference picture with vim on puts the cursor on it, and i shows its source", async () => {
    await tapThenInsert(REFERENCED, REFERENCE);
  });

  it("A3 a press, a ctrl press and a meta press on a picture on a desktop with vim off show its source", async () => {
    await pressesReach(false);
  });

  it("A3 a press, a ctrl press and a meta press on a picture on a desktop with vim on put the cursor on it", async () => {
    await pressesReach(true);
  });
});
