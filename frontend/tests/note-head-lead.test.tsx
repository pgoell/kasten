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

function flat(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".cm-line.cm-flat")].map((line) => line.textContent ?? "");
}

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
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

    expect(flat(container)).toEqual(["", "Reader", ""]);
    expect(viewIn(container).state.selection.main.head).toBe(DOC.indexOf("Some"));
  });

  it("show the line the cursor moves onto", () => {
    const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);

    act(() => viewIn(container).dispatch({ selection: { anchor: DOC.indexOf("# Reader") } }));

    expect(flat(container)).not.toContain("Reader");
  });

  it("keep their height in Edit", () => {
    const { container } = render(
      <Editor initialDoc={DOC} path={PATH} commands={stubCommands()} preview={false} />,
    );

    expect(flat(container)).toEqual([]);
  });
});
