/**
 * Going back from Edit to Read keeps the line at the top (#792 A10).
 *
 * Edit shows each table as its source and Read draws it as a grid, so the tables
 * above the reader change height when the preview comes back. Without a snapshot
 * of the scroll taken across the switch, the pixel offset stays put and a
 * different line lands at the top. A real browser, because the heights are layout.
 */

import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@/components/editor";
import "@/styles/app.css";

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
