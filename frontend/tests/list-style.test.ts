import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { noteLanguage } from "@/lib/markdown/note-language";
import { cycleListStyle } from "@/lib/notes/editor/format-commands";

/** Cycles the list at line `line` (from 1) `times` times and returns the note. */
function cycled(doc: string[], line: number, times = 1): string[] {
  const state = EditorState.create({ doc: doc.join("\n"), extensions: noteLanguage() });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = new EditorView({ state });
  view.dispatch({ selection: { anchor: state.doc.line(line).from } });
  for (let i = 0; i < times; i++) cycleListStyle(view);
  return view.state.doc.toString().split("\n");
}

describe("cycleListStyle", () => {
  it("steps bullets to numbers to letters and back", () => {
    const list = ["- one", "- two", "- three"];

    expect(cycled(list, 2)).toEqual(["1. one", "2. two", "3. three"]);
    expect(cycled(list, 2, 2)).toEqual(["a) one", "b) two", "c) three"]);
    expect(cycled(list, 2, 3)).toEqual(list);
  });

  it("counts on from where a numbered list starts", () => {
    expect(cycled(["3. one", "3. two"], 1)).toEqual(["c) one", "d) two"]);
  });

  it("changes only the cursor's level, and moves the children in past a wider mark", () => {
    const doc = ["- one", "  - nested", "  more of one", "- two", "", "- three", "after"];

    expect(cycled(doc, 4)).toEqual([
      "1. one",
      "   - nested",
      "   more of one",
      "2. two",
      "",
      "3. three",
      "after",
    ]);
  });

  it("restyles a nested list on its own", () => {
    expect(cycled(["- one", "  - a", "  - b", "- two"], 3)).toEqual([
      "- one",
      "  1. a",
      "  2. b",
      "- two",
    ]);
  });

  it("stops at a heading or a paragraph at the list's level", () => {
    expect(cycled(["- a", "text", "- b"], 1)).toEqual(["1. a", "text", "- b"]);
    expect(cycled(["- a", "", "## h", "- b"], 4)).toEqual(["- a", "", "## h", "1. b"]);
  });

  it("stops where the mark changes, as CommonMark ends a list there", () => {
    expect(cycled(["- a", "- b", "", "1. x", "2. y"], 4)).toEqual([
      "- a",
      "- b",
      "",
      "a) x",
      "b) y",
    ]);
    expect(cycled(["- a", "* b"], 1)).toEqual(["1. a", "* b"]);
  });

  it("leaves a list of todos and a line outside any list alone", () => {
    expect(cycled(["- [ ] a", "- [x] b"], 1)).toEqual(["- [ ] a", "- [x] b"]);
    expect(cycled(["plain"], 1)).toEqual(["plain"]);
  });

  it("skips the letters for a list with lines under its items", () => {
    // `a)` is paragraph text to CommonMark, so the child would parse as a list of its own.
    expect(cycled(["1. one", "   - nested", "2. two"], 1)).toEqual([
      "- one",
      "   - nested",
      "- two",
    ]);
  });

  it("leaves a YAML list in the frontmatter and a list in a fence alone", () => {
    const front = ["---", "tags:", "  - a", "---", "", "- b"];
    const fence = ["```", "- a", "```"];

    expect(cycled(front, 3)).toEqual(front);
    expect(cycled(fence, 2)).toEqual(fence);
    // From the line under the closing fence too, which a walk up for the item would cross.
    expect(cycled([...front.slice(0, 4), "# Title"], 5)).toEqual([...front.slice(0, 4), "# Title"]);
    expect(cycled([...fence, "text"], 4)).toEqual([...fence, "text"]);
  });

  it("does not reach past a heading for the list above it", () => {
    expect(cycled(["- a", "# Title"], 2)).toEqual(["- a", "# Title"]);
    for (const rule of ["***", "* * *", "- - -"]) {
      expect(cycled(["- a", rule, "text"], 3)).toEqual(["- a", rule, "text"]);
      expect(cycled(["- a", rule, "text"], 2)).toEqual(["- a", rule, "text"]);
    }
  });

  it("goes to bullets rather than past z", () => {
    const long = Array.from({ length: 27 }, (_, i) => `${i + 1}. item`);

    expect(cycled(long, 1)[26]).toBe("- item");
  });
});
