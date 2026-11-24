import { syntaxTreeAvailable } from "@codemirror/language";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { writePosition } from "@/lib/notes/editor/positions";
import { leadLines, textStart } from "@/lib/notes/text/note-lead";
import { drawnLine, finishParsing, hides, starved } from "./parsing";
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

describe("a jump past the parsed part of a long note (#2323)", () => {
  const LONG = `${DOC}\n\n${"A paragraph the parser walks through.\n\n".repeat(3000)}# Deep\n\nend`;
  const DEEP = LONG.indexOf("# Deep");

  let opened = 0;

  /**
   * The note opened at its top with CodeMirror's first parse starved, so the parse stops near the top.
   * A path of its own each time: a path remembers where its cursor was left.
   */
  function openedAtTop(vim: string) {
    localStorage.setItem("kasten.vim", vim);
    opened += 1;
    const path = `Long ${opened}.md`;
    const view = viewIn(
      starved(<Editor initialDoc={LONG} path={path} commands={stubCommands()} />).container,
    );
    expect(syntaxTreeAvailable(view.state, DEEP)).toBe(false);
    return view;
  }

  afterEach(() => localStorage.clear());

  it("draws the heading at the end without its # after vim G", async () => {
    const view = openedAtTop("on");
    const cm = getCM(view);
    if (cm === null) throw new Error("vim is off");
    act(() => Vim.handleKey(cm, "G", "user"));
    await act(async () => {});

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(view.state.doc.lines);
    expect(hides(view, DEEP, DEEP + 2)).toBe(true);
  });

  it("draws the heading at the end without its # after a jump with vim off", async () => {
    const view = openedAtTop("off");
    // A search hit or ctrl+end: the selection moves far down and scrolls into view.
    act(() => view.dispatch({ selection: { anchor: LONG.length }, scrollIntoView: true }));
    await act(async () => {});

    expect(hides(view, DEEP, DEEP + 2)).toBe(true);
  });

  it("starts no parse for a jump inside the parsed part", async () => {
    const view = openedAtTop("off");
    finishParsing(view.dom.parentElement as HTMLElement);
    const dispatch = vi.spyOn(view, "dispatch");
    act(() => view.dispatch({ selection: { anchor: DEEP }, scrollIntoView: true }));
    await act(async () => {});

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("stops at its cap on a box too slow for it, and draws the rest once the parse lands", async () => {
    const view = openedAtTop("off");
    // 300 ms a read spends the jump's budget at its first step, as a far slower box would.
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 300));
    try {
      act(() => view.dispatch({ selection: { anchor: LONG.length }, scrollIntoView: true }));
      await act(async () => {});
    } finally {
      clock.mockRestore();
    }

    expect(syntaxTreeAvailable(view.state, DEEP)).toBe(false);
    finishParsing(view.dom.parentElement as HTMLElement);
    expect(hides(view, DEEP, DEEP + 2)).toBe(true);
  });

  /** Runs `step` on a clock that jumps 300 ms a read, so no parse in it gets past its first step; `after` too unless false. */
  async function slowed(step: () => void, after = true) {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 300));
    try {
      act(step);
      if (after) await act(async () => {});
    } finally {
      clock.mockRestore();
    }
    await act(async () => {});
  }

  it.each(["on", "off"])(
    "starts no parse for a key typed where the parse has not reached, vim %s (#2327)",
    async (vim) => {
      const view = openedAtTop(vim);
      await slowed(() =>
        view.dispatch({ selection: { anchor: LONG.length }, scrollIntoView: true }),
      );
      expect(syntaxTreeAvailable(view.state, DEEP)).toBe(false);
      const dispatch = vi.spyOn(view, "dispatch");
      const at = view.state.doc.length;
      await slowed(() =>
        view.dispatch({
          changes: { from: at, insert: "x" },
          selection: { anchor: at + 1 },
          userEvent: "input.type",
        }),
      );

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(syntaxTreeAvailable(view.state, DEEP)).toBe(false);
      // The idle pass still lands, and draws what the key left raw.
      finishParsing(view.dom.parentElement as HTMLElement);
      expect(hides(view, DEEP, DEEP + 2)).toBe(true);
    },
  );

  it("parses the screen a typed key scrolls onto", async () => {
    const view = openedAtTop("off");
    // The open's own parse lands first, so only the key's can reach the end.
    await act(async () => {});
    expect(syntaxTreeAvailable(view.state, DEEP)).toBe(false);
    const at = view.state.doc.length;
    await slowed(
      () =>
        view.dispatch({
          changes: { from: at, insert: "x" },
          selection: { anchor: at + 1 },
          scrollIntoView: true,
          userEvent: "input.type",
        }),
      false,
    );

    expect(hides(view, DEEP, DEEP + 2)).toBe(true);
  });
});
