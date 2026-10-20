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

import type { EditorView } from "@codemirror/view";
import { cdp, page } from "vitest/browser";
import { shot } from "./shots";
import {
  framed,
  mount,
  mountApp,
  on,
  phone,
  picture,
  press,
  SITE,
  settled,
  stubOpen,
  tableLinkCleanup,
  tap,
  tapAt,
} from "./table-link-fixture";

tableLinkCleanup();

const CAT = "https://example.com/cat.png";
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

/** Two clicks on `element` in quick succession, the second counted as the second. */
async function doublePress(element: Element): Promise<void> {
  const [x, y] = on(element);
  for (const clickCount of [1, 2]) {
    const at = { x, y, modifiers: 0, button: "left" as const, clickCount };
    await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
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
