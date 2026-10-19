/**
 * A tap or a ctrl+click on a wikilink follows it once, and only a tap in the
 * link the cursor is in edits it (#568, #569).
 *
 * The cursor in a link is a position, not a name: another link to the same
 * note is not the one being edited. And a double tap or a double ctrl+click is
 * one follow, the second click carrying `detail` 2. This runs where
 * table-link.test.tsx does: a real browser, a real finger from the DevTools
 * protocol, and the app's own editor, whose `onFollow` is a spy.
 */

import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import "@/styles/app.css";

let app: { root: Root; host: HTMLElement } | undefined;

afterEach(async () => {
  if (app !== undefined) {
    const { root, host } = app;
    root.unmount();
    host.remove();
    app = undefined;
  }
  vi.restoreAllMocks();
  localStorage.removeItem("kasten.vim");
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

type How = "tap" | "ctrl" | "meta";

/** The app's own editor on `doc`, on a phone for a tap and a desktop for a press, once `selector` is drawn. */
async function appWith(doc: string, how: How, vim: string, selector: string) {
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
  app = { root, host };
  await expect.poll(() => host.querySelector(selector)).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  return { at, follow };
}

/** The `index`th rendered wikilink on line `line`, counted from 0. */
function linkOn(at: EditorView, line: number, index = 0): Element {
  const row = at.contentDOM.querySelectorAll(".cm-line")[line] as Element;
  return row.querySelectorAll(".cm-wikilink")[index] as Element;
}

/** The wikilink in the drawn table's first body cell. */
function cellLink(at: EditorView): Element {
  return at.dom.querySelector(".cm-table-block tbody .cm-wikilink") as Element;
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

/** A left button pressed and let go at `x`, `y`, with ctrl as 2 and meta as 4, as click `count`. */
async function pressAt([x, y]: [number, number], modifiers: number, count = 1): Promise<void> {
  const at = { x, y, modifiers, button: "left" as const, clickCount: count };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** A finger, or a press with ctrl or meta, on `element`. */
async function act(element: Element, how: How): Promise<void> {
  if (how === "tap") await tapAt(on(element));
  else await pressAt(on(element), how === "ctrl" ? 2 : 4);
}

/** Two of `act` on `element` in quick succession, the second counted as the second. */
async function twice(element: Element, how: How): Promise<void> {
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

/** Waited on until the tap or press has landed: a note followed or the cursor moved off `head`. */
async function landed(at: EditorView, follow: ReturnType<typeof vi.fn>, head: number) {
  await expect
    .poll(() => follow.mock.calls.length > 0 || at.state.selection.main.head !== head, {
      message: "the tap landing",
    })
    .toBe(true);
  await settled();
}

/** Both clicks of a double tap or press landed, the second counted as the second. */
async function bothLanded(details: number[]) {
  await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(2);
  await settled();
  expect(details[1], "the second click's detail").toBe(2);
}

const VIMS = ["off", "on"];
const PRESSES = (["ctrl", "meta"] as const).flatMap((how) =>
  VIMS.map((vim) => [how, vim] as const),
);
const WHERE = (["line", "cell"] as const).flatMap((where) =>
  PRESSES.map(([how, vim]) => [how, where, vim] as const),
);

/** Two links to one note on two lines. */
const TWO = "[[Some note]] one\n[[Some note]] two";
/** A link to the note on a line, and another in a table's cell. */
const TABLED = ["[[Some note]]", "", "| a | b |", "| --- | --- |", "| [[Some note]] | c |"].join(
  "\n",
);
/** A link to the note in a table's cell. */
const CELL = ["A table", "", "| a | b |", "| --- | --- |", "| [[Some note]] | c |"].join("\n");

describe("a tap or a press on a wikilink follows it once", () => {
  it.each(VIMS)(
    "A1 #568 a tap on a wikilink with vim %s opens it while the cursor rests in another to the same note",
    async (vim) => {
      const { at, follow } = await appWith(TWO, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: 4 } });

      await act(linkOn(at, 1), "tap");
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(WHERE)(
    "A3 #568 a %s press on a wikilink in a %s with vim %s opens it while the cursor rests in another to the same note",
    async (how, where, vim) => {
      const doc = where === "line" ? TWO : TABLED;
      const selector = where === "line" ? ".cm-wikilink" : ".cm-table-block .cm-wikilink";
      const { at, follow } = await appWith(doc, how, vim, selector);
      at.dispatch({ selection: { anchor: 4 } });

      await act(where === "line" ? linkOn(at, 1) : cellLink(at), how);
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(VIMS)("A4 #569 a double tap on a wikilink with vim %s opens it once", async (vim) => {
    const { at, follow } = await appWith("A line\n[[Some note]] two", "tap", vim, ".cm-wikilink");
    const details = clicks(at);

    await twice(linkOn(at, 1), "tap");
    await bothLanded(details);
    expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
  });

  it.each(VIMS)(
    "A5 #569 a double tap on a wikilink in a cell with vim %s opens it once",
    async (vim) => {
      const { at, follow } = await appWith(CELL, "tap", vim, ".cm-table-block .cm-wikilink");
      const details = clicks(at);

      await twice(cellLink(at), "tap");
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(WHERE)(
    "A6 #569 a double %s press on a wikilink in a %s with vim %s opens it once",
    async (how, where, vim) => {
      const doc = where === "line" ? "A line\n[[Some note]] two" : CELL;
      const selector = where === "line" ? ".cm-wikilink" : ".cm-table-block .cm-wikilink";
      const { at, follow } = await appWith(doc, how, vim, selector);
      const details = clicks(at);

      await twice(where === "line" ? linkOn(at, 1) : cellLink(at), how);
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  // Guard: the link the cursor is in is the one being edited.
  it.each(VIMS)(
    "I1 #568 guard a tap in the wikilink the cursor is in with vim %s moves the cursor and opens nothing",
    async (vim) => {
      const { at, follow } = await appWith(TWO, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: 4 } });
      await settled();

      const word = 8;
      const coords = at.coordsAtPos(word) as { left: number; top: number; bottom: number };
      await tapAt(framed([coords.left + 2, (coords.top + coords.bottom) / 2]));
      await expect
        .poll(() => at.state.selection.main.head, { message: "the cursor after the tap" })
        .toSatisfy((head: number) => Math.abs(head - word) <= 1);
      await settled();
      expect(follow).not.toHaveBeenCalled();
    },
  );

  it.each(VIMS)(
    "I2 #568 a tap on the second of two wikilinks to one note on a line with vim %s opens it while the cursor rests in the first",
    async (vim) => {
      const { at, follow } = await appWith(
        "[[Some note]] and [[Some note]]",
        "tap",
        vim,
        ".cm-wikilink",
      );
      at.dispatch({ selection: { anchor: 4 } });

      await act(linkOn(at, 0, 1), "tap");
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  // Where `$` lands on a line ending in a link: past its hidden `]]`, which
  // still counts as in it. vim may step back one, still in it.
  it.each(VIMS)(
    "I3 #568 a tap on a wikilink with vim %s opens it while the cursor rests at the end of another to the same note",
    async (vim) => {
      const doc = "[[Some note]]\n[[Some note]] two";
      const { at, follow } = await appWith(doc, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: "[[Some note]]".length } });
      const head = at.state.selection.main.head;

      await act(linkOn(at, 1), "tap");
      await landed(at, follow, head);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(VIMS)(
    "I4 #569 a double tap on a markdown link with vim %s opens one tab",
    async (vim) => {
      const { at } = await appWith("A line\n[t](https://a.com) two", "tap", vim, ".cm-link");
      const open = stubOpen();
      const details = clicks(at);

      // The text's own span, nested in the link's.
      await twice(at.contentDOM.querySelector(".cm-link span") as Element, "tap");
      await bothLanded(details);
      expect(open).toHaveBeenCalledExactlyOnceWith("https://a.com", "_blank", "noopener");
    },
  );

  // Guard: two taps far apart are two first clicks, each following.
  it.each(VIMS)(
    "I5 #569 guard a tap on one wikilink then on another far from it with vim %s follows each once",
    async (vim) => {
      // A line first: the cursor at the start of the note is in a link there.
      const doc = ["A line", "[[One]]", "", "", "", "", "", "", "", "[[Two]]"].join("\n");
      const { at, follow } = await appWith(doc, "tap", vim, ".cm-wikilink");
      const details = clicks(at);

      await act(linkOn(at, 1), "tap");
      await expect.poll(() => details.length, { message: "the first click handled" }).toBe(1);
      await settled();
      await act(linkOn(at, 9), "tap");
      await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(2);
      await settled();
      expect(details, "two first clicks").toEqual([1, 1]);
      expect(follow.mock.calls).toEqual([["One"], ["Two"]]);
    },
  );
});
