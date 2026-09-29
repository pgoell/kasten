import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { waitFor } from "@testing-library/react";
import { renderedMarkdown } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";

/** Whether some decoration replaces the range with a widget. */
function drawn(view: EditorView, from: number, to: number): boolean {
  let found = false;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(view) : source;
    set.between(from, to, (start, end, value) => {
      if (start === from && end === to && value.spec.widget) found = true;
    });
  }
  return found;
}

describe("a note longer than the first parse", () => {
  it("draws what the parser reaches after the note has opened", async () => {
    // The first parse stops a few thousand characters in and the rest lands
    // later in slices, each a transaction that changes nothing else. A long
    // clipped article's later pictures sat as text until the cursor moved.
    const image = "![](https://example.com/late.png)";
    const doc = `${"A paragraph that the parser has to walk through.\n\n".repeat(2000)}${image}`;
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [noteLanguage(), renderedMarkdown()] }),
    });
    const from = doc.length - image.length;

    expect(syntaxTree(view.state).length).toBeLessThan(from);
    await waitFor(() => expect(drawn(view, from, doc.length)).toBe(true), { timeout: 3000 });
    view.destroy();
  });
});
