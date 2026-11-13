import { syntaxTreeAvailable } from "@codemirror/language";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { leadLines, textStart } from "@/lib/notes/text/note-lead";
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
    // A loaded box spends CodeMirror's 20 ms first parse before line 5; a clock that jumps does it every time.
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 30));
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
