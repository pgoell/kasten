import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Editor } from "@/components/editor";
import { writePosition } from "@/lib/notes/editor/positions";
import { leadLines, textStart } from "@/lib/notes/text/note-lead";
import { finishParsing } from "./parsing";
import { stubCommands } from "./stub-commands";

const PATH = "02 Projects/Reader.md";
const DOC = ["---", "type: Concept", "---", "", "# Reader", "", "Some words.", "", "# Reader"].join(
  "\n",
);

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

/** The numbers of the lines drawn with no height. Not their text: a heading keeps its `#` until the parse reaches it (#1982). */
function flat(container: HTMLElement): number[] {
  const view = viewIn(container);
  return [...container.querySelectorAll(".cm-line.cm-flat")].map(
    (line) => view.state.doc.lineAt(view.posAtDOM(line)).number,
  );
}

describe("the lines between the frontmatter and the text", () => {
  it("are the blank lines and one heading that repeats the title", () => {
    const doc = Text.of(DOC.split("\n"));

    expect(leadLines(doc, 4, "Reader")).toEqual([4, 5, 6]);
    expect(textStart(doc, 4, "Reader")).toBe(doc.line(7).from);
  });

  it("stop at a heading that says more than the title", () => {
    const doc = Text.of(["", "# Reader notes", "text"]);

    expect(leadLines(doc, 1, "Reader")).toEqual([1]);
  });

  it("take no height in Read, and the note opens on its text", () => {
    const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);

    expect(flat(container)).toEqual([4, 5, 6]);
    expect(viewIn(container).state.selection.main.head).toBe(DOC.indexOf("Some"));
  });

  it("take no height in Read before the parse reaches the heading", () => {
    // A loaded box spends CodeMirror's 20 ms first parse before line 5, and at 300 ms a read the open's parse too (#1984).
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 300));
    const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
    clock.mockRestore();

    expect(syntaxTreeAvailable(viewIn(container).state, DOC.indexOf("Some"))).toBe(false);
    expect(flat(container)).toEqual([4, 5, 6]);
  });

  it("show the line the cursor moves onto", () => {
    const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);

    act(() => viewIn(container).dispatch({ selection: { anchor: DOC.indexOf("# Reader") } }));

    expect(flat(container)).toEqual([4, 6]);
  });

  it("keep their height in Edit", () => {
    const { container } = render(
      <Editor initialDoc={DOC} path={PATH} commands={stubCommands()} preview={false} />,
    );

    expect(flat(container)).toEqual([]);
  });
});

/** The text a line draws, its marks hidden or not. */
function drawnLine(view: EditorView, number: number): string | null | undefined {
  const { node } = view.domAtPos(view.state.doc.line(number).from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest(".cm-line")?.textContent;
}

/** Whether a decoration hides `[from, to)`, on screen or not. */
function hides(view: EditorView, from: number, to: number): boolean {
  let found = false;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(view) : source;
    set.between(from, to, (start, end, value) => {
      if (start === from && end >= to && value.spec.widget === undefined && !value.spec.class)
        found = true;
    });
  }
  return found;
}

/**
 * Rendered on a clock that jumps `by` at every read inside `EditorState.create`, so CodeMirror's 20 ms
 * first parse stops at its first step. With `open` false the editor's own parse on open is starved too.
 */
function starved(ui: ReactElement, by = 30, open = true) {
  const real = Date.now.bind(Date);
  const create = EditorState.create.bind(EditorState);
  let now = real();
  let creating = false;
  const parse = vi.spyOn(EditorState, "create").mockImplementation((config) => {
    creating = true;
    try {
      return create(config);
    } finally {
      creating = false;
    }
  });
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    if (open && !creating) return real();
    now += by;
    return now;
  });
  try {
    return render(ui);
  } finally {
    clock.mockRestore();
    parse.mockRestore();
  }
}

describe("a note past CodeMirror's first parse (#1984)", () => {
  const MORE = `${DOC}\n\n- item [[b|Bee]]`;

  afterEach(() => localStorage.clear());

  for (const vim of ["on", "off"]) {
    it(`draws its headings and marks without their source when it opens, vim ${vim}`, () => {
      localStorage.setItem("kasten.vim", vim);
      const { container } = starved(
        <Editor initialDoc={MORE} path={PATH} paths={["b.md"]} commands={stubCommands()} />,
      );
      const view = viewIn(container);

      expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBeLessThan(9);
      expect([drawnLine(view, 9), drawnLine(view, 11)]).toEqual(["Reader", "item Bee"]);
    });
  }

  for (const vim of ["on", "off"]) {
    it(`draws the heading the cursor opens on as a whole parse draws it, vim ${vim}`, () => {
      localStorage.setItem("kasten.vim", vim);
      const ui = <Editor initialDoc={MORE} path={PATH} startLine={9} commands={stubCommands()} />;
      const { container } = render(ui);
      finishParsing(container);
      const whole = drawnLine(viewIn(container), 9);

      expect(whole).toBe(vim === "on" ? "Reader" : "# Reader");
      expect(drawnLine(viewIn(starved(ui).container), 9)).toBe(whole);
    });
  }

  const LONG = `${MORE}\n\n${"A paragraph the parser walks through.\n\n".repeat(300)}# Deep\n\nend`;
  const DEEP = LONG.indexOf("# Deep");

  it("draws a heading without its # where an open names a line far down", () => {
    const { container } = starved(
      <Editor
        initialDoc={LONG}
        path={PATH}
        startLine={LONG.split("\n").length}
        commands={stubCommands()}
      />,
    );
    const view = viewIn(container);

    expect(view.state.selection.main.head).toBe(LONG.length - 3);
    expect(drawnLine(view, view.state.doc.lineAt(DEEP).number)).toBe("Deep");
  });

  it("draws a heading without its # by the place it was left at, far down", () => {
    writePosition(PATH, { anchor: LONG.length, head: LONG.length, top: 0 });
    const { container } = starved(
      <Editor initialDoc={LONG} path={PATH} commands={stubCommands()} />,
    );
    const view = viewIn(container);

    expect(view.state.selection.main.head).toBe(LONG.length);
    expect(hides(view, DEEP, DEEP + 2)).toBe(true);
  });

  it("draws a heading without its # by the scroll it was left at, the cursor at the top", async () => {
    writePosition(PATH, { anchor: 0, head: 0, top: 1_000_000 });
    // jsdom lays nothing out, and a pane of no height keeps its saved scroll for later.
    const height = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
    try {
      const { container } = starved(
        <Editor initialDoc={LONG} path={PATH} commands={stubCommands()} />,
      );
      await act(async () => {});
      const view = viewIn(container);

      expect(view.state.selection.main.head).toBe(0);
      expect(hides(view, DEEP, DEEP + 2)).toBe(true);
    } finally {
      height.mockRestore();
    }
  });

  it("opens a note the budget cannot parse, and draws the rest once the parse lands", () => {
    // 300 ms a read, the open's parse too, spends its budget at its first step, as a far slower box would.
    const { container } = starved(
      <Editor initialDoc={MORE} path={PATH} commands={stubCommands()} />,
      300,
      false,
    );
    const view = viewIn(container);

    expect(syntaxTreeAvailable(view.state, MORE.length)).toBe(false);
    finishParsing(container);
    expect([drawnLine(view, 9), drawnLine(view, 11)]).toEqual(["Reader", "item Bee"]);
  });
});
