/**
 * Scroll places around tables. Going back from Edit to Read keeps the line at the
 * top (#792 A10), and each table keeps its own sideways place through edits (#2334, #2338).
 *
 * Edit shows each table as its source and Read draws it as a grid, so the tables
 * above the reader change height when the preview comes back. Without a snapshot
 * of the scroll taken across the switch, the pixel offset stays put and a
 * different line lands at the top. A real browser, because the heights are layout.
 */

import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { Editor } from "@/components/editor";
import "@/styles/app.css";
import { drawn, mountApp, scrollerOf, tableLinkCleanup, wideNote } from "./table-link-fixture";

/** A paragraph, then six tables of eight rows, each with its own paragraphs around it. */
const NOTE = [
  "# Scroll",
  "",
  "An opening paragraph before the first table.",
  "",
  ...Array.from({ length: 6 }, (_, index) => {
    const table = index + 1;
    return [
      `## Table ${table}`,
      "",
      `Words before table ${table}.`,
      "",
      `| name | value ${table} |`,
      "| - | - |",
      ...Array.from(
        { length: 8 },
        (_, row) => `| row ${table}.${row + 1} | ${(row + 1) * table} |`,
      ),
      "",
      `Words after table ${table}.`,
      "",
    ];
  }).flat(),
].join("\n");

/** The line the paragraph sits on, which is under four tables and above two. */
const TARGET = "Words before table 5.";

let host: HTMLElement | undefined;
let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  localStorage.removeItem("kasten.vim");
});

/** The app's editor on the note, with its preview on or off, the way the route mounts it. */
function editor(preview: boolean) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={NOTE} preview={preview} />
    </QueryClientProvider>
  );
}

function mount(preview: boolean): EditorView {
  host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = "width: 100%; height: 400px;";
  root = createRoot(host);
  act(() => root?.render(editor(preview)));
  return EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

/** Two frames, so the view has measured and drawn what it was given. */
async function settled(): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    await new Promise((done) => requestAnimationFrame(done));
  }
}

/** The number of the line at the top of the scroller, read from the height map. */
function topLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

describe("the scroll place across the switch from Edit to Read", () => {
  it("#792 A10 going back from Edit to Read keeps the line at the top", async () => {
    localStorage.setItem("kasten.vim", "off");
    const view = mount(false);
    await settled();

    const target = NOTE.split("\n").indexOf(TARGET) + 1;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.line(target).from, { y: "start" }),
    });
    await settled();
    // Read where the scroll puts the line, which may be a line off the target.
    const before = topLine(view);

    act(() => root?.render(editor(true)));
    await settled();
    const after = topLine(view);

    expect(
      Math.abs(after - before),
      `the line at the top moved from ${before} in Edit to ${after} in Read`,
    ).toBeLessThanOrEqual(1);
  });
});

describe("a table's sideways place", () => {
  tableLinkCleanup();

  it("#2334 each table keeps its place through edits above it, drawn or not, and an edit in it", async () => {
    const doc = `${wideNote(3)}\n\nmiddle\n\n${wideNote(3).replace("before\n\n", "")}`;
    const { at } = await drawn(doc);
    const blocks = () => [...at.dom.querySelectorAll(".cm-table-block")].map(scrollerOf);
    await expect.poll(() => blocks().length).toBe(2);
    const [first, second] = blocks() as [HTMLElement, HTMLElement];
    first.scrollLeft = 150;
    second.scrollLeft = 60;
    await expect.poll(() => [first.scrollLeft, second.scrollLeft]).toEqual([150, 60]);
    const head = () => at.state.doc.toString().indexOf("| column 0");
    /** The cursor into the first table, which takes its widget off the page, then `edit`, then out. */
    const inAndOut = async (edit: () => void) => {
      at.dispatch({ selection: { anchor: head() } });
      await expect.poll(() => blocks().length).toBe(1);
      edit();
      at.dispatch({ selection: { anchor: 0 } });
      await expect.poll(() => blocks().map((scroller) => scroller.scrollLeft)).toEqual([150, 60]);
    };

    // Typed above while the table is drawn, the widget kept on the page.
    at.dispatch({ changes: { from: 0, insert: "x" } });
    await inAndOut(() => {});
    // Typed above while it is not drawn, and taken back.
    await inAndOut(() => at.dispatch({ changes: { from: 0, insert: "yy\n" } }));
    await inAndOut(() => at.dispatch({ changes: { from: 0, to: 3 } }));
    // Typed in a cell.
    await inAndOut(() => at.dispatch({ changes: { from: head() + 4, insert: "z" } }));
  });

  it.each([
    ["at 1440 with vim off", "off", 1440],
    ["at 390 with vim on", "on", 390],
  ] as const)(
    "#2338 a table after a deleted one opens at its own place, %s",
    async (_, vim, width) => {
      await page.viewport(width, 900);
      const doc = `${wideNote(3)}\n\n${wideNote(4).replace("before\n\n", "")}`;
      const host = mountApp(doc, 600, { vim });
      const blocks = () => [...host.querySelectorAll(".cm-table-block")].map(scrollerOf);
      await expect.poll(() => blocks().length).toBe(2);
      const at = EditorView.findFromDOM(
        host.querySelector(".cm-editor") as HTMLElement,
      ) as EditorView;
      const [first, second] = blocks() as [HTMLElement, HTMLElement];
      first.scrollLeft = 150;
      second.scrollLeft = 60;
      await expect.poll(() => [first.scrollLeft, second.scrollLeft]).toEqual([150, 60]);
      const from = doc.indexOf("| column 0");
      const to = doc.lastIndexOf("| column 0");
      at.dispatch({ selection: { anchor: to } });
      await expect.poll(() => blocks().length).toBe(1);
      // The first table and the blank line under it, the cursor staying in the second.
      at.dispatch({ changes: { from, to } });
      at.dispatch({ selection: { anchor: 0 } });
      await expect.poll(() => blocks().map((scroller) => scroller.scrollLeft)).toEqual([60]);
      // Taken back, the second keeps its place and the first comes back at the start.
      undo(at);
      at.dispatch({ selection: { anchor: 0 } });
      await expect.poll(() => blocks().map((scroller) => scroller.scrollLeft)).toEqual([0, 60]);
    },
  );

  it.each(["drawn", "saved"])("#2338 a deleted %s table's place goes with it", async (kind) => {
    // A paragraph of rows under the table, which a line of dashes makes a table later.
    const [head, , ...body] = wideNote(2).replace("before\n\n", "").split("\n");
    const doc = `${wideNote(3)}\n\n${[head, ...body].join("\n")}`;
    const { at, scroller, host } = await drawn(doc);
    scroller.scrollLeft = 150;
    await expect.poll(() => scroller.scrollLeft).toBe(150);
    const from = doc.indexOf("| column 0");
    if (kind === "saved") {
      at.dispatch({ selection: { anchor: from } });
      await expect.poll(() => host.querySelector(".cm-table-block")).toBeNull();
    }
    at.dispatch({ changes: { from, to: doc.lastIndexOf("| column 0") }, selection: { anchor: 0 } });
    at.dispatch({
      changes: { from: from + (head ?? "").length, insert: `\n|${" --- |".repeat(30)}` },
    });
    await expect
      .poll(() => host.querySelector(".cm-table-block[data-shadow-right]"))
      .not.toBeNull();
    expect(scrollerOf(host.querySelector(".cm-table-block") as HTMLElement).scrollLeft).toBe(0);
  });

  it("#2338 a table written without a leading pipe keeps its place when the line-up adds one", async () => {
    const row = (cells: (c: number) => string) =>
      Array.from({ length: 30 }, (_, c) => cells(c)).join(" | ");
    const lines = [
      row((c) => `column ${c}`),
      row(() => "---"),
      row((c) => `cell ${c}`),
      row((c) => `cell ${c}`),
    ];
    const doc = `before\n\n${lines.join("\n")}`;
    const { at, scroller, host } = await drawn(doc);
    scroller.scrollLeft = 150;
    await expect.poll(() => scroller.scrollLeft).toBe(150);
    at.dispatch({ selection: { anchor: doc.indexOf("cell 0") } });
    await expect.poll(() => host.querySelector(".cm-table-block")).toBeNull();
    at.dispatch({ changes: { from: doc.indexOf("cell 0"), insert: "wider " } });
    at.dispatch({ selection: { anchor: 0 } });
    await expect.poll(() => at.state.doc.line(3).text.startsWith("| column 0")).toBe(true);
    await expect
      .poll(() => scrollerOf(host.querySelector(".cm-table-block") as HTMLElement)?.scrollLeft)
      .toBe(150);
  });

  it("#2338 a note replaced whole keeps only the place of the table at its start", async () => {
    const tables = [wideNote(3), wideNote(4)].map((note) => note.replace("before\n\n", ""));
    const doc = `${tables.join("\n\n")}\n\nafter`;
    const { at, host } = await drawn(doc);
    const blocks = () => [...host.querySelectorAll(".cm-table-block")].map(scrollerOf);
    at.dispatch({ selection: { anchor: doc.length } });
    await expect.poll(() => blocks().length).toBe(2);
    const [first, second] = blocks() as [HTMLElement, HTMLElement];
    first.scrollLeft = 150;
    second.scrollLeft = 60;
    await expect.poll(() => [first.scrollLeft, second.scrollLeft]).toEqual([150, 60]);
    const second0 = doc.lastIndexOf("| column 0");
    // The first table's place saved, then the second's, then the first off the page again.
    for (const anchor of [1, second0, 1]) {
      at.dispatch({ selection: { anchor } });
      await expect.poll(() => blocks().length).toBe(1);
    }
    at.dispatch({ changes: { from: 0, to: doc.length, insert: doc }, selection: { anchor: 1 } });
    at.dispatch({ selection: { anchor: doc.length } });
    await expect.poll(() => blocks().length).toBe(2);
    await expect.poll(() => blocks().map((scroller) => scroller.scrollLeft)).toEqual([150, 60]);
  });
});
