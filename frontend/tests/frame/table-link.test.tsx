/**
 * A tap or a press on a link in a drawn table's cell follows it (#561).
 *
 * The cell is part of one block widget, whose own click opens the table, so
 * the follow has to happen there rather than in the editor's tap and
 * ctrl+click, which read the link off a position the block cannot give. This
 * runs where linked-picture.test.tsx does: a real browser, a real finger from
 * the DevTools protocol, and the pictures loaded from a canvas once their
 * addresses are checked. `window.open` is stubbed, so no tab opens.
 */

import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
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
import { shot } from "./shots";

const CAT = "https://example.com/cat.png";
const SITE = "https://example.com";
const IMAGE = `![a](${CAT})`;

/** A note whose table has a linked picture and link text, then plain text and a bare picture. */
function noteWith(picture: string, text: string, extra: string[] = []): string {
  return [
    "A table",
    "",
    "| picture | text |",
    "| --- | --- |",
    `| ${picture} | ${text} |`,
    `| plain | ${IMAGE} |`,
    "",
    ...extra,
  ].join("\n");
}

const NOTE = noteWith(`[${IMAGE}](${SITE})`, `[text](${SITE})`);
const ADDRESSES = { script: "javascript:alert(1)", schemeless: "notes/x.md" };

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
        oneDark,
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
function mountApp(doc: string, height: number, { vim, ...props }: AppProps = {}): HTMLElement {
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

/** The drawn table, its two pictures checked and then loaded from a canvas so they have a size. */
async function table(within: Element): Promise<Element> {
  await expect.poll(() => within.querySelectorAll(".cm-table-block img.cm-image").length).toBe(2);
  for (const image of within.querySelectorAll<HTMLImageElement>(".cm-table-block img.cm-image")) {
    expect(image.getAttribute("src")).toBe(CAT);
    image.src = picture("#61afef");
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
  }
  return within.querySelector(".cm-table-block") as Element;
}

/** The parts of the table's first body row and second, by what they are. */
function parts(block: Element) {
  const [first, second] = block.querySelectorAll("tbody tr");
  const [linkedCell, textCell] = (first as Element).querySelectorAll("td");
  const [plainCell, bareCell] = (second as Element).querySelectorAll("td");
  return {
    "linked picture": (linkedCell as Element).querySelector("img") as Element,
    "link text": (textCell as Element).querySelector(".cm-link") as Element,
    "plain text": plainCell as Element,
    "bare picture": (bareCell as Element).querySelector("img") as Element,
  };
}

type Part = keyof ReturnType<typeof parts>;

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
  return framed(point);
}

/** A point in the frame as the DevTools protocol takes it, in the page the frame sits in. */
function framed([x, y]: [number, number]): [number, number] {
  const frame = window.frameElement?.getBoundingClientRect();
  return [x + (frame?.left ?? 0), y + (frame?.top ?? 0)];
}

/** A finger put down at `x`, `y` in the page and lifted again. */
async function tapAt([x, y]: [number, number]): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A finger put down on `element` and lifted again. */
async function tap(element: Element): Promise<void> {
  await tapAt(on(element));
}

/** A left button pressed and let go on `element`, with ctrl as 2 and meta as 4. */
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

/** Where the table sits in `doc`. */
function tableRange(doc: string): [number, number] {
  return [doc.indexOf("| picture"), doc.lastIndexOf("|") + 1];
}

/**
 * The press followed the link to `address` once, and the table is still drawn
 * with the cursor where it was. Waited on until the press has landed either
 * way, a follow or the table opening, so a build that opens the table answers
 * every check below rather than a timeout on the first.
 */
async function followed(
  head: () => number,
  block: Element,
  open: ReturnType<typeof stubOpen>,
  address: string,
) {
  await expect
    .poll(() => open.mock.calls.length > 0 || !block.isConnected, { message: "the press landing" })
    .toBe(true);
  await settled();
  expect.soft(block.isConnected, "the table stays drawn").toBe(true);
  expect.soft(head(), "the cursor stays where it was").toBe(0);
  expect(open).toHaveBeenCalledExactlyOnceWith(address, "_blank", "noopener");
}

/** The press opened the table: the cursor in it, the block gone, and no tab. */
async function openedTable(
  at: EditorView,
  doc: string,
  block: Element,
  open: ReturnType<typeof stubOpen>,
) {
  const [from, to] = tableRange(doc);
  await expect
    .poll(() => at.state.selection.main.head, { message: "the cursor after the press" })
    .toSatisfy((head: number) => head >= from && head <= to);
  await settled();
  expect(block.isConnected, "the table shows its source").toBe(false);
  expect(open).not.toHaveBeenCalled();
}

describe("a tap or a press on a link in a table cell", () => {
  it.each(["off", "on"])(
    "A1 a tap on a linked picture in a cell with vim %s opens the link",
    async (vim) => {
      await phone();
      const at = mount(NOTE, vim === "on", 896);
      const block = await table(at.dom);
      const open = stubOpen();

      await tap(parts(block)["linked picture"]);
      await followed(() => at.state.selection.main.head, block, open, SITE);
    },
  );

  it.each(["off", "on"])(
    "A2 a tap on link text in a cell with vim %s opens the link",
    async (vim) => {
      await phone();
      const at = mount(NOTE, vim === "on", 896);
      const block = await table(at.dom);
      const open = stubOpen();

      await tap(parts(block)["link text"]);
      await followed(() => at.state.selection.main.head, block, open, SITE);
    },
  );

  it.each([
    ["plain", "off"],
    ["ctrl", "off"],
    ["plain", "on"],
    ["ctrl", "on"],
  ])(
    "A3 a %s press on a linked picture in a cell on a desktop with vim %s opens the link once",
    async (kind, vim) => {
      await page.viewport(1280, 900);
      const at = mount(NOTE, vim === "on", 900);
      const block = await table(at.dom);
      const open = stubOpen();

      await press(parts(block)["linked picture"], kind === "ctrl" ? 2 : 0);
      await followed(() => at.state.selection.main.head, block, open, SITE);
    },
  );

  it.each([
    ["ctrl", "off"],
    ["meta", "off"],
    ["ctrl", "on"],
    ["meta", "on"],
  ])(
    "A4 a %s press on link text in a cell on a desktop with vim %s opens the link once",
    async (kind, vim) => {
      await page.viewport(1280, 900);
      const at = mount(NOTE, vim === "on", 900);
      const block = await table(at.dom);
      const open = stubOpen();

      await press(parts(block)["link text"], kind === "ctrl" ? 2 : 4);
      await followed(() => at.state.selection.main.head, block, open, SITE);
    },
  );

  // Guard: a plain click on a link's text edits it, inside a table or out.
  it.each(["off", "on"])(
    "A4 guard a plain press on link text in a cell on a desktop with vim %s opens the table",
    async (vim) => {
      await page.viewport(1280, 900);
      const at = mount(NOTE, vim === "on", 900);
      const block = await table(at.dom);
      const open = stubOpen();

      await press(parts(block)["link text"], 0);
      await openedTable(at, NOTE, block, open);
    },
  );

  // Guard: what opened the table before still does.
  it.each(
    (["tap", "press"] as const).flatMap((how) =>
      (["plain text", "bare picture"] as const).flatMap((part) =>
        ["off", "on"].map((vim) => [how, part, vim] as const),
      ),
    ),
  )("A5 guard a %s on %s in a cell with vim %s opens the table", async (how, part: Part, vim) => {
    if (how === "tap") await phone();
    else await page.viewport(1280, 900);
    const at = mount(NOTE, vim === "on", how === "tap" ? 896 : 900);
    const block = await table(at.dom);
    const open = stubOpen();

    const element = parts(block)[part];
    if (how === "tap") await tap(element);
    else await press(element, 0);
    await openedTable(at, NOTE, block, open);
  });

  it.each(
    (["tap", "ctrl press"] as const).flatMap((how) =>
      (["linked picture", "link text"] as const).map((part) => [how, part] as const),
    ),
  )(
    "A6 a %s on the %s in a cell in the app's editor opens the link once",
    async (how, part: Part) => {
      if (how === "tap") await phone();
      else await page.viewport(1280, 900);
      const block = await table(mountApp(NOTE, how === "tap" ? 896 : 900));
      const open = stubOpen();

      const element = parts(block)[part];
      if (how === "tap") await tap(element);
      else await press(element, 2);
      await expect
        .poll(() => open.mock.calls.length > 0 || !block.isConnected, {
          message: "the press landing",
        })
        .toBe(true);
      await settled();
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  // A table with no outer pipes starts with its first cell, so the editor's
  // own tap and ctrl+click, reading the link off the block's start, find the
  // header's link there. The block keeps a ctrl press from them at the press
  // and a tap at its click.
  it.each(["tap", "ctrl press"] as const)(
    "B1 a %s on link text in a cell of a table whose first cell is a link opens only that link",
    async (how) => {
      const doc = [
        "A table",
        "",
        "[h](https://h.com) | b",
        "--- | ---",
        `[text](${SITE}) | c`,
      ].join("\n");
      if (how === "tap") await phone();
      else await page.viewport(1280, 900);
      const host = mountApp(doc, how === "tap" ? 896 : 900);
      await expect.poll(() => host.querySelector(".cm-table-block tbody .cm-link")).not.toBeNull();
      const block = host.querySelector(".cm-table-block") as Element;
      const open = stubOpen();

      const text = block.querySelector("tbody .cm-link") as Element;
      if (how === "tap") await tap(text);
      else await press(text, 2);
      await expect
        .poll(() => open.mock.calls.length > 0 || !block.isConnected, {
          message: "the press landing",
        })
        .toBe(true);
      await settled();
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );

  // Guard: `urlLinkAt` already turns both away, and the cell keeps opening the table.
  it.each(
    (["script", "schemeless"] as const).flatMap((kind) =>
      (["linked picture", "link text"] as const).map((part) => [part, kind] as const),
    ),
  )("I1 guard a tap on the %s of a %s link in a cell opens the table", async (part: Part, kind) => {
    const address = ADDRESSES[kind];
    const doc = noteWith(`[${IMAGE}](${address})`, `[text](${address})`);
    await phone();
    const at = mount(doc, false, 896);
    const block = await table(at.dom);
    const open = stubOpen();

    await tap(parts(block)[part]);
    await openedTable(at, doc, block, open);
  });

  it.each(["linked picture", "link text"] as const)(
    "I2 a tap on the %s of a reference link in a cell opens the address its definition gives",
    async (part: Part) => {
      const doc = noteWith(`[${IMAGE}][ref]`, "[text][ref]", [`[ref]: ${SITE}`]);
      await phone();
      const at = mount(doc, false, 896);
      const block = await table(at.dom);
      const open = stubOpen();

      await tap(parts(block)[part]);
      await followed(() => at.state.selection.main.head, block, open, SITE);
    },
  );

  // Guard: a scroll makes no click, inside a table or out.
  it("I3 guard a finger that lands on a linked picture in a cell and drags opens nothing", async () => {
    await phone();
    const at = mount(NOTE, false, 896);
    const block = await table(at.dom);
    const open = stubOpen();

    const [x, y] = on(parts(block)["linked picture"]);
    await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const step of [20, 40, 60, 80]) {
      await cdp().send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step }],
      });
    }
    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // Nothing shows that a scroll was handled, so a tap on the first line goes
    // after it: input is handled in order, and the cursor moving there means
    // any click the scroll made has landed.
    await tap(at.contentDOM.querySelector(".cm-line") as Element);
    await expect
      .poll(() => at.state.selection.main.head, {
        message: "the cursor after a tap on the first line",
      })
      .toSatisfy((head: number) => head >= 1 && head <= "A table".length);
    expect(open).not.toHaveBeenCalled();
  });

  it("I4 a double-click on a linked picture in a cell on a desktop opens the link once", async () => {
    await page.viewport(1280, 900);
    const at = mount(NOTE, false, 900);
    const block = await table(at.dom);
    const open = stubOpen();
    // Releases rather than clicks, and on the editor rather than the picture:
    // a build that shows the source on the first press takes the picture away
    // before its click, and the browser then sends none. A click runs straight
    // after its release, so two frames past the second release it has landed.
    let releases = 0;
    at.dom.addEventListener("mouseup", () => releases++);

    await doublePress(parts(block)["linked picture"]);
    await expect.poll(() => releases, { message: "the releases handled" }).toBe(2);
    await settled();
    expect.soft(block.isConnected, "the table stays drawn").toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
  });

  it("I5 a tap on a bold picture inside a link in a cell opens the link", async () => {
    const doc = noteWith(`[**${IMAGE}**](${SITE})`, `[text](${SITE})`);
    await phone();
    const at = mount(doc, false, 896);
    const block = await table(at.dom);
    const open = stubOpen();

    await tap(parts(block)["linked picture"]);
    await followed(() => at.state.selection.main.head, block, open, SITE);
  });

  // Guard: with the cursor in the table its source shows, and a tap on a link
  // there moves the cursor, the block that follows being gone.
  it("I6 guard a tap on a link in a table showing its source moves the cursor and opens nothing", async () => {
    await phone();
    const at = mount(NOTE, false, 896);
    const block = await table(at.dom);
    at.dispatch({ selection: { anchor: NOTE.indexOf("plain") } });
    await expect
      .poll(() => block.isConnected, { message: "the table showing its source" })
      .toBe(false);
    const open = stubOpen();

    const word = NOTE.indexOf("[text]") + 2;
    const coords = at.coordsAtPos(word) as { left: number; top: number; bottom: number };
    await tapAt(framed([coords.left + 2, (coords.top + coords.bottom) / 2]));
    await expect
      .poll(() => at.state.selection.main.head, { message: "the cursor after the tap" })
      .toSatisfy((head: number) => Math.abs(head - word) <= 1);
    await settled();
    expect(open).not.toHaveBeenCalled();
  });

  // A look rather than a check: the shots are for an eye, and the widths only
  // prove they came out the size asked for.
  it("A7 a table with a linked picture and link text on a phone", async () => {
    await phone();
    const at = mount(NOTE, true, 896);
    await table(at.dom);
    expect(await shot(at.dom, "table-link-phone")).toBe(414);
  });

  it("A7 a table with a linked picture and link text on a desktop", async () => {
    await page.viewport(1280, 900);
    const at = mount(NOTE, true, 900);
    await table(at.dom);
    expect(await shot(at.dom, "table-link-desktop")).toBe(1280);
  });
});

type How = "tap" | "ctrl" | "meta" | "plain";

/** A note of `lines` with its table last, and where that table starts, its first line being `head`. */
function tabled(lines: string[], head: string): { doc: string; from: number } {
  const doc = lines.join("\n");
  return { doc, from: doc.indexOf(head) };
}

/** A note whose table, with outer pipes, holds `link` in its first body cell. */
function linkedIn(link: string) {
  return tabled(["A table", "", "| a | b |", "| --- | --- |", `| ${link} | c |`], "| a | b |");
}

/** A table with no outer pipes whose first cell is a link, and a schemeless one in its body (#565). */
const SCHEMELESS = tabled(
  [
    "A table",
    "",
    "[p](https://p.com)",
    "",
    "[h](https://h.com) | b",
    "--- | ---",
    "[x](notes.md) | c",
  ],
  "[h]",
);

/**
 * The app's editor on `doc`, on a phone for a tap and a desktop for a press,
 * once `selector` is drawn in its table.
 */
async function appWith(doc: string, how: How, vim: string, selector: string, props: AppProps = {}) {
  if (how === "tap") await phone();
  else await page.viewport(1280, 900);
  const host = mountApp(doc, how === "tap" ? 896 : 900, { vim, ...props });
  await expect.poll(() => host.querySelector(`.cm-table-block ${selector}`)).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  const block = host.querySelector(".cm-table-block") as Element;
  return { at, block, element: block.querySelector(selector) as Element };
}

/** A finger on `element`, or a left press with ctrl, meta or neither. */
async function act(element: Element, how: How): Promise<void> {
  if (how === "tap") await tap(element);
  else await press(element, { ctrl: 2, meta: 4, plain: 0 }[how]);
}

/**
 * Waited on until the press has landed whichever way it goes: a note
 * followed, a tab opened, the table opened, or the cursor moved off `head`.
 */
async function landed(
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
async function followedNote(
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
async function openedOnly(
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

const VIMS = ["off", "on"];
const BOTH = (["tap", "ctrl"] as const).flatMap((how) => VIMS.map((vim) => [how, vim] as const));
const PRESSES = (["ctrl", "meta"] as const).flatMap((how) =>
  VIMS.map((vim) => [how, vim] as const),
);

describe("a tap or a press on a link in a table cell opens its own target", () => {
  // Holds on main as well: the block's click opens the table, which takes the
  // tapped span off the page, and CodeMirror then drops the click before the
  // editor's tap can open what it read off the block's start.
  it.each(VIMS)(
    "A1 #565 a tap on a schemeless link in a table whose first cell is a link with vim %s opens nothing and shows the source",
    async (vim) => {
      const { at, block, element } = await appWith(SCHEMELESS.doc, "tap", vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(element, "tap");
      await openedOnly(at, SCHEMELESS.from, block, follow, open);
    },
  );

  it.each(PRESSES)(
    "A2 #565 a %s press on a schemeless link in a table whose first cell is a link with vim %s opens nothing",
    async (how, vim) => {
      const { at, block, element } = await appWith(SCHEMELESS.doc, how, vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(element, how);
      await openedOnly(at, SCHEMELESS.from, block, follow, open);
    },
  );

  // Guard: #563 made each of these follow, the block keeping the editor's
  // reading of the block's start from it.
  it.each(
    BOTH.flatMap(([how, vim]) =>
      (["header", "body"] as const).map((cell) => [how, cell, vim] as const),
    ),
  )(
    "A3 guard a %s on the %s link of a table with no outer pipes with vim %s opens its own address once",
    async (how, cell, vim) => {
      const doc = [
        "A table",
        "",
        "[p](https://p.com)",
        "",
        "[one](https://one.com) | b",
        "--- | ---",
        "c | [two](https://two.com)",
      ].join("\n");
      const { at, block } = await appWith(doc, how, vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(
        block.querySelector(`${cell === "header" ? "thead" : "tbody"} .cm-link`) as Element,
        how,
      );
      await landed(at, block, follow, open);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      const address = cell === "header" ? "https://one.com" : "https://two.com";
      expect(open).toHaveBeenCalledExactlyOnceWith(address, "_blank", "noopener");
    },
  );

  it.each(BOTH)(
    "A4 #565 a %s on the body wikilink of a table whose first cell is a wikilink with vim %s opens that note once",
    async (how, vim) => {
      const doc = ["A table", "", "[[First]] | b", "--- | ---", "[[Second]] | c"].join("\n");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Second");
    },
  );

  it.each(VIMS)(
    "A5 #564 a tap on a wikilink in a cell with vim %s opens its note once",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  it.each(PRESSES)(
    "A6 #564 a %s press on a wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  // A cell writes the alias bar `\|`, the backslash being the table's, so the
  // target handed on is what `[[note|Shown]]` on a plain line hands on.
  const ALIASED = {
    alias: ["[[note\\|Shown]]", "note|Shown"],
    heading: ["[[note#Head]]", "note#Head"],
    "heading and alias": ["[[note#Head\\|Shown]]", "note#Head|Shown"],
  } as const;

  it.each(
    BOTH.flatMap(([how, vim]) =>
      (Object.keys(ALIASED) as (keyof typeof ALIASED)[]).map((kind) => [how, kind, vim] as const),
    ),
  )(
    "A7 #564 a %s on a wikilink with %s in a cell with vim %s hands on the target a plain line does",
    async (how, kind, vim) => {
      const [link, target] = ALIASED[kind];
      const follow = vi.fn();
      const { at, block, element } = await appWith(
        linkedIn(link).doc,
        how,
        vim,
        "tbody .cm-wikilink",
        {
          onFollow: follow,
        },
      );
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, target);
    },
  );

  it.each(BOTH)(
    "A7 #564 a %s on a wikilink to a heading of this note in a cell with vim %s moves the cursor there",
    async (how, vim) => {
      const doc = [
        "A table",
        "",
        "# Head",
        "",
        "| a | b |",
        "| --- | --- |",
        "| [[#Head]] | c |",
      ].join("\n");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await landed(at, block, follow, open);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect.soft(open, "no tab opened").not.toHaveBeenCalled();
      // On its line rather than at its start: the hidden `# ` is stepped over.
      const line = at.state.doc.lineAt(at.state.selection.main.head);
      expect(line.text, "the cursor on the heading").toBe("# Head");
    },
  );

  // A look rather than a check, as A7 above is.
  const LOOK = [
    "A table",
    "",
    "| note | alias | link | dead |",
    "| --- | --- | --- | --- |",
    `| [[Some note]] | [[Some note\\|Shown]] | [text](${SITE}) | [[Nowhere]] |`,
    "| **[[Some note]]** | [[#Head]] | [x](notes.md) | plain |",
  ].join("\n");

  it("A8 a table with wikilinks and links on a phone", async () => {
    await phone();
    const host = mountApp(LOOK, 896, { vim: "on", paths: ["Some note.md"] });
    await expect.poll(() => host.querySelector(".cm-table-block .cm-wikilink-dead")).not.toBeNull();
    expect(await shot(host.querySelector(".cm-editor") as Element, "table-wikilink-phone")).toBe(
      414,
    );
  });

  it("A8 a table with wikilinks and links on a desktop", async () => {
    await page.viewport(1280, 900);
    const host = mountApp(LOOK, 900, { vim: "on", paths: ["Some note.md"] });
    await expect.poll(() => host.querySelector(".cm-table-block .cm-wikilink-dead")).not.toBeNull();
    expect(await shot(host.querySelector(".cm-editor") as Element, "table-wikilink-desktop")).toBe(
      1280,
    );
  });

  // Guard: a plain click in a link edits it off a table, and in one opens it.
  it.each(VIMS)(
    "I1 guard a plain press on a wikilink in a cell with vim %s opens the table",
    async (vim) => {
      const { doc, from } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "plain", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, "plain");
      await openedOnly(at, from, block, follow, open);
    },
  );

  it.each(BOTH)(
    "I2 a %s on a dead wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("[[Nowhere]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink-dead", {
        onFollow: follow,
        paths: ["Some note.md"],
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Nowhere");
    },
  );

  it.each(BOTH)(
    "I3 a %s on a bold wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("**[[Some note]]**");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  // The cursor in a link is what keeps a tap from following it, and the one
  // the cursor is in here is another link that only shares the name.
  it.each(VIMS)(
    "I4 a tap on a wikilink in a cell with vim %s follows while the cursor rests in one of the same name",
    async (vim) => {
      const doc = ["[[Some note]]", "", "| a | b |", "| --- | --- |", "| [[Some note]] | c |"].join(
        "\n",
      );
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      at.dispatch({ selection: { anchor: 4 } });
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note", 4);
    },
  );

  // Guard: a scroll makes no click, inside a table or out.
  it.each(VIMS)(
    "I5 guard a finger that lands on a wikilink in a cell and drags with vim %s opens nothing",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      const [x, y] = on(element);
      await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (const step of [20, 40, 60, 80]) {
        await cdp().send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step }],
        });
      }
      await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      // A tap on the first line after it, as #563's I3 has it: input is handled
      // in order, so the cursor moving there means the drag has landed.
      await tap(at.contentDOM.querySelector(".cm-line") as Element);
      await expect
        .poll(() => at.state.selection.main.head, {
          message: "the cursor after a tap on the first line",
        })
        .toSatisfy((head: number) => head >= 1 && head <= "A table".length);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect(open, "no tab opened").not.toHaveBeenCalled();
    },
  );

  // Guard: with the cursor in the table its source shows, and a tap on the
  // wikilink the cursor is in moves the cursor, as on a plain line.
  it.each(VIMS)(
    "I6 guard a tap on a wikilink in a table showing its source with vim %s moves the cursor and opens nothing",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      at.dispatch({ selection: { anchor: doc.indexOf("Some note") + 6 } });
      await expect
        .poll(() => block.isConnected, { message: "the table showing its source" })
        .toBe(false);
      const open = stubOpen();

      const word = doc.indexOf("Some note") + 2;
      const coords = at.coordsAtPos(word) as { left: number; top: number; bottom: number };
      await tapAt(framed([coords.left + 2, (coords.top + coords.bottom) / 2]));
      await expect
        .poll(() => at.state.selection.main.head, { message: "the cursor after the tap" })
        .toSatisfy((head: number) => Math.abs(head - word) <= 1);
      await settled();
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect(open, "no tab opened").not.toHaveBeenCalled();
    },
  );

  // Guard: an embedded picture is no link, so a cell holding one opens the table.
  it.each(BOTH)(
    "I7 guard a %s on an embedded picture in a cell with vim %s opens the table",
    async (how, vim) => {
      const { doc, from } = linkedIn("![[pic.png]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody img.cm-image", {
        onFollow: follow,
        images: ["pic.png"],
      });
      const image = element as HTMLImageElement;
      image.src = picture("#98c379");
      await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
      const open = stubOpen();

      await act(image, how);
      await openedOnly(at, from, block, follow, open);
    },
  );

  // Off a table the wikilink wins over the link around it, `followOnClick`
  // and the tap both reading it first, so a cell does the same.
  it.each(BOTH)(
    "R1 #567 a %s on a wikilink inside a link in a cell with vim %s opens the note",
    async (how, vim) => {
      const { doc } = linkedIn("[see [[x]]](https://a.com)");
      const follow = vi.fn();
      const { block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();
      // Seen in the capture phase, before anything can stop it: a build that
      // follows nothing changes nothing else to wait on.
      let clicks = 0;
      const count = () => clicks++;
      document.addEventListener("click", count, true);
      onTestFinished(() => document.removeEventListener("click", count, true));

      await act(element, how);
      await expect.poll(() => clicks, { message: "the click handled" }).toBe(1);
      await settled();
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(open, "no tab opened").not.toHaveBeenCalled();
      expect(follow).toHaveBeenCalledExactlyOnceWith("x");
    },
  );

  // The pane a link opens off is the focused one (#361), so a tap in an
  // editor without the focus gives it the focus before following.
  it.each(VIMS)(
    "R2 #567 a tap on a wikilink in a cell of an editor without focus with vim %s focuses it before following",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      let focused: boolean | null = null;
      const follow = vi.fn(() => {
        focused = at.hasFocus;
      });
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const other = document.body.appendChild(document.createElement("input"));
      onTestFinished(() => other.remove());
      other.focus();
      expect(at.hasFocus).toBe(false);
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note");
      expect(focused, "the editor focused when it follows").toBe(true);
    },
  );
});
