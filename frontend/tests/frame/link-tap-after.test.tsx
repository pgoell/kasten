/**
 * A tap or a press on a linked picture, or on a link in a drawn table's cell,
 * opens it right after a tap or press beside it (#572).
 *
 * Chrome counts a tap within about 20 pixels and 300 milliseconds of the one
 * before as its second, whatever the first landed on, so the click here
 * carries `detail` 2. It is a repeat only when the press before it followed
 * the same target. This runs where linked-picture.test.tsx does: a real
 * browser, a real finger from the DevTools protocol, and the pictures loaded
 * from a canvas once their addresses are checked. `window.open` is stubbed,
 * so no tab opens.
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
import { vimKeys } from "@/lib/editor/vim-mode";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

const CAT = "https://example.com/cat.png";
const SITE = "https://example.com";
const LINKED = `[![a](${CAT})](${SITE})`;
/** A linked picture on the line under a line of text, close enough for a tap on each to count as two. */
const PICTURE = ["A cat", LINKED].join("\n");
/**
 * A table right under a line of text, `link` in the header row, which sits
 * closest to that line. One link to a table: a picture beside link text
 * makes the row tall and puts the text far below the line.
 */
const tableOf = (link: string) =>
  ["A table", `| ${link} | b |`, "| --- | --- |", "| c | d |"].join("\n");
const CELLS = { "link text": tableOf(`[text](${SITE})`), "linked picture": tableOf(LINKED) };
type Part = keyof typeof CELLS;

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
  localStorage.removeItem("kasten.vim");
  // A tap far from the links, as linked-picture.test.tsx has it: without it a
  // test's first tap reaches the click as `detail` 2 when the test before
  // tapped near there.
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

/** A 320 by 180 PNG in one colour, as a data URL. */
function picture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "#61afef";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** On a phone for a tap and a desktop for a press, the editor the way the app mounts a note, the cursor on the first line. */
async function mount(doc: string, vim: string, touch: boolean): Promise<EditorView> {
  if (touch) {
    await page.viewport(414, 896);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  } else await page.viewport(1280, 900);
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.cssText = `width: 100%; height: ${touch ? 896 : 900}px; background: #282c34;`;
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteLanguage(),
        // As the app has it: vim's keys, or the facet saying there are none.
        vim === "on" ? vimKeymap() : vimKeys.of(false),
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
 * The app's own editor on `doc` on a phone, as the route mounts it: the one
 * place a tap on a markdown link's text follows it.
 */
async function mountApp(doc: string, vim: string): Promise<EditorView> {
  await page.viewport(414, 896);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  localStorage.setItem("kasten.vim", vim);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = "width: 100%; height: 896px;";
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={doc} />
    </QueryClientProvider>,
  );
  app = { root, host };
  await expect.poll(() => host.querySelector(".cm-editor")).not.toBeNull();
  return EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

/** Every picture in `at`, `count` of them, its address checked and then loaded from a canvas so it has a size. */
async function loaded(at: EditorView, count: number): Promise<void> {
  await expect.poll(() => at.dom.querySelectorAll("img.cm-image").length).toBe(count);
  for (const image of at.dom.querySelectorAll<HTMLImageElement>("img.cm-image")) {
    expect(image.getAttribute("src")).toBe(CAT);
    image.src = picture();
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
  }
}

/** A point in the frame as the DevTools protocol takes it, in the page the frame sits in. */
function framed([x, y]: [number, number]): [number, number] {
  const frame = window.frameElement?.getBoundingClientRect();
  return [x + (frame?.left ?? 0), y + (frame?.top ?? 0)];
}

/** The page coordinates of `element`'s centre, checked to be on it rather than beside it. */
function on(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const point: [number, number] = [box.left + box.width / 2, box.top + box.height / 2];
  expect(document.elementFromPoint(...point)).toBe(element);
  return framed(point);
}

/**
 * Two points: one just under the first line's text, and one just inside the
 * top of `element` straight below it. Close enough for Chrome to count a tap
 * on the second right after one on the first as its second click, which from
 * the middle of the line a cell's padding puts out of reach. Lower than that
 * the finger lands nearer the table's text than the line's, and opens it.
 */
function beside(
  at: EditorView,
  element: Element,
): { first: [number, number]; second: [number, number] } {
  const box = element.getBoundingClientRect();
  const x = box.left + 4;
  const second: [number, number] = [x, box.top + 1];
  expect(element.contains(document.elementFromPoint(...second)), "the second point on it").toBe(
    true,
  );
  const row = at.contentDOM.querySelector(".cm-line") as Element;
  const line = at.coordsAtPos(0) as { bottom: number };
  const first: [number, number] = [x, line.bottom + 2];
  expect(
    document.elementFromPoint(...first)?.closest(".cm-line"),
    "the first point on line one",
  ).toBe(row);
  return { first: framed(first), second: framed(second) };
}

/**
 * The times for the taps of one gesture, in seconds since the epoch as the
 * protocol takes them, 150 milliseconds apart.
 */
function stamps(): () => number {
  let next = Date.now() / 1000;
  return () => {
    const stamp = next;
    next += 0.15;
    return stamp;
  };
}

/**
 * A finger put down at `x`, `y` in the page and lifted again, both events
 * stamped by the browser's clock. Chrome counts a tap as a repeat within about
 * 300 milliseconds of the one before by the events' own times. The round trips
 * between taps on a loaded CI runner passed that, so the stamps carry the gap
 * instead (#879).
 */
async function tapAt([x, y]: [number, number], stamp: number): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
    timestamp: stamp,
  });
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: stamp + 0.05,
  });
}

/** A left button pressed and let go at `x`, `y`, with ctrl as 2, as click `count`. */
async function pressAt([x, y]: [number, number], modifiers: number, count: number): Promise<void> {
  const at = { x, y, modifiers, button: "left" as const, clickCount: count };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/**
 * The `detail` of every click on the editor. Seen in the capture phase, before
 * anything can stop it, so the second counted is the second sent.
 */
function clicks(at: EditorView): number[] {
  const details: number[] = [];
  at.dom.addEventListener("click", (event) => details.push(event.detail), true);
  return details;
}

/** `window.open`, stubbed so a follow is seen and no tab opens. */
function stubOpen() {
  return vi.spyOn(window, "open").mockImplementation(() => null);
}

/** Two frames, for anything a click already handled set going to show. */
async function settled(): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    await new Promise((done) => requestAnimationFrame(done));
  }
}

/** All `details` clicks landed, counted as the browser counts them, and then two frames more. */
async function allLanded(details: number[], counts: number[]): Promise<void> {
  await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(counts.length);
  await settled();
  expect(details, "the clicks' details").toEqual(counts);
}

/** The first tap or press beside the link landed, and left the link there and the cursor out of it. */
async function firstLanded(at: EditorView, details: number[], link: Element, from: number) {
  await expect.poll(() => details.length, { message: "the first click handled" }).toBe(1);
  expect(link.isConnected, "the link still drawn").toBe(true);
  expect(at.state.selection.main.head, "the cursor before the link").toBeLessThan(from);
}

/** The drawn table and the link in its header, a picture loaded first. */
async function drawn(at: EditorView, part: Part): Promise<{ block: Element; link: Element }> {
  await loaded(at, part === "linked picture" ? 1 : 0);
  const selector = part === "linked picture" ? "img.cm-image" : ".cm-link";
  await expect.poll(() => at.dom.querySelector(`.cm-table-block thead ${selector}`)).not.toBeNull();
  const block = at.dom.querySelector(".cm-table-block") as Element;
  return { block, link: block.querySelector(`thead ${selector}`) as Element };
}

const VIMS = ["off", "on"];
const PARTS = (["link text", "linked picture"] as const).flatMap((part) =>
  VIMS.map((vim) => [part, vim] as const),
);

describe("a tap or a press on a link right after one beside it (#572)", () => {
  it.each(VIMS)(
    "A1 #572 a tap on a linked picture right after a tap beside it with vim %s opens the link",
    async (vim) => {
      const at = await mount(PICTURE, vim, true);
      await loaded(at, 1);
      const image = at.dom.querySelector("img.cm-image") as Element;
      const open = stubOpen();
      const details = clicks(at);
      const { first, second } = beside(at, image);

      const next = stamps();
      await tapAt(first, next());
      await firstLanded(at, details, image, PICTURE.indexOf(LINKED));
      await tapAt(second, next());
      await allLanded(details, [1, 2]);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  it.each(PARTS)(
    "A2 #572 a tap on the %s in a cell right after a tap beside the table with vim %s opens the link",
    async (part, vim) => {
      const at = await mount(CELLS[part], vim, true);
      const { block, link } = await drawn(at, part);
      const open = stubOpen();
      const details = clicks(at);
      const { first, second } = beside(at, link);

      const next = stamps();
      await tapAt(first, next());
      await firstLanded(at, details, block, CELLS[part].indexOf("|"));
      await tapAt(second, next());
      await allLanded(details, [1, 2]);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  it.each(VIMS)(
    "A3 #572 a plain press on a linked picture on a desktop right after a plain press beside it with vim %s opens the link",
    async (vim) => {
      const at = await mount(PICTURE, vim, false);
      await loaded(at, 1);
      const image = at.dom.querySelector("img.cm-image") as Element;
      const open = stubOpen();
      const details = clicks(at);
      const { first, second } = beside(at, image);

      await pressAt(first, 0, 1);
      await firstLanded(at, details, image, PICTURE.indexOf(LINKED));
      await pressAt(second, 0, 2);
      await allLanded(details, [1, 2]);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  it.each(VIMS)(
    "A3 #572 a ctrl press on link text in a cell on a desktop right after a plain press beside the table with vim %s opens the link",
    async (vim) => {
      const doc = CELLS["link text"];
      const at = await mount(doc, vim, false);
      const { block, link } = await drawn(at, "link text");
      const open = stubOpen();
      const details = clicks(at);
      const { first, second } = beside(at, link);

      await pressAt(first, 0, 1);
      await firstLanded(at, details, block, doc.indexOf("|"));
      await pressAt(second, 2, 2);
      await allLanded(details, [1, 2]);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  // Guard: #560 and #563 made a double tap open once, and the press before
  // the second here is one that followed.
  it.each(
    (["outside a table", "in a cell"] as const).flatMap((where) =>
      VIMS.map((vim) => [where, vim] as const),
    ),
  )(
    "A4 #572 a double tap on a linked picture %s with vim %s opens the link once",
    async (where, vim) => {
      const doc = where === "in a cell" ? CELLS["linked picture"] : PICTURE;
      const at = await mount(doc, vim, true);
      await loaded(at, 1);
      const image = at.dom.querySelector("img.cm-image") as Element;
      const open = stubOpen();
      const details = clicks(at);

      const point = on(image);
      const next = stamps();
      await tapAt(point, next());
      await tapAt(point, next());
      await allLanded(details, [1, 2]);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  it.each(VIMS)(
    "I1 #572 a triple tap on a linked picture with vim %s opens one tab",
    async (vim) => {
      const at = await mount(PICTURE, vim, true);
      await loaded(at, 1);
      const open = stubOpen();
      const details = clicks(at);

      const point = on(at.dom.querySelector("img.cm-image") as Element);
      const next = stamps();
      for (let tap = 0; tap < 3; tap++) await tapAt(point, next());
      await allLanded(details, [1, 2, 3]);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  it.each(VIMS)(
    "I2 #572 a triple tap on link text in a cell with vim %s opens one tab",
    async (vim) => {
      const at = await mount(CELLS["link text"], vim, true);
      const { block, link } = await drawn(at, "link text");
      const open = stubOpen();
      const details = clicks(at);

      const point = on(link);
      const next = stamps();
      for (let tap = 0; tap < 3; tap++) await tapAt(point, next());
      await allLanded(details, [1, 2, 3]);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  // The tap before followed, but another address: a press on another link
  // right after a follow opens it, as Obsidian has it.
  it.each(VIMS)(
    "I5 #572 a tap on a linked picture right after a tap that followed another link beside it with vim %s opens it",
    async (vim) => {
      const other = "https://a.com";
      const doc = ["A line", `[link](${other})`, LINKED].join("\n");
      const at = await mountApp(doc, vim);
      await loaded(at, 1);
      const image = at.dom.querySelector("img.cm-image") as Element;
      const link = at.contentDOM.querySelector(".cm-link") as Element;
      const open = stubOpen();
      const details = clicks(at);
      // The foot of the link's text and the top of the picture under it.
      const box = link.getBoundingClientRect();
      const x = box.left + 4;
      const first: [number, number] = [x, box.bottom - 1];
      expect(
        link.contains(document.elementFromPoint(...first)),
        "the first point on the link",
      ).toBe(true);

      const next = stamps();
      await tapAt(framed(first), next());
      await expect.poll(() => details.length, { message: "the first click handled" }).toBe(1);
      expect(open, "the first link followed").toHaveBeenCalledExactlyOnceWith(
        other,
        "_blank",
        "noopener",
      );
      expect(image.isConnected, "the picture still drawn").toBe(true);
      expect(at.state.selection.main.head, "the cursor before the picture").toBeLessThan(
        doc.indexOf(LINKED),
      );
      const second: [number, number] = [x, image.getBoundingClientRect().top + 1];
      expect(document.elementFromPoint(...second), "the second point on the picture").toBe(image);
      await tapAt(framed(second), next());
      await allLanded(details, [1, 2]);
      expect(open.mock.calls).toEqual([
        [other, "_blank", "noopener"],
        [SITE, "_blank", "noopener"],
      ]);
    },
  );
});
