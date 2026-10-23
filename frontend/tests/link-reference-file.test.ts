import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { fileLinkAt } from "@/lib/link-reference";
import { noteLanguage } from "@/lib/note-language";

/** The file link the note's first character sits in, read the way the editor reads one. */
function fileLinkOf(doc: string) {
  const state = EditorState.create({ doc, extensions: [noteLanguage()] });
  const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
  return fileLinkAt(tree.resolveInner(1, 1), state.doc);
}

describe("fileLinkAt", () => {
  it("reads a file link's path decoded and its heading as written", () => {
    const doc = "[ab.pdf, page 3](a%7Cb.pdf#page=3)";

    expect(fileLinkOf(doc)).toEqual({
      path: "a|b.pdf",
      heading: "page=3",
      from: 0,
      to: doc.length,
    });
  });

  it("reads a malformed percent escape as no file link", () => {
    expect(fileLinkOf("[x](%E0%A4%A)")).toBeNull();
  });
});
