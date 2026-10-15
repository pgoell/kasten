import { forceParsing, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { renderedMarkdown } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { wikiLinkAt } from "@/lib/wikilink";

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

/** The tree `doc` parses to, as lezer prints it. */
function tree(doc: string): string {
  return syntaxTree(EditorState.create({ doc, extensions: [noteLanguage()] })).toString();
}

describe("an embed", () => {
  it("parses ![[note]] as an embed around the wikilink it holds", () => {
    expect(tree("![[note#Heading|alias]]")).toContain(
      "Embed(EmbedMark,WikiLink(WikiLinkMark,WikiLinkMark))",
    );
    expect(tree("![[note]]")).not.toContain("Image");
  });

  it("leaves the link under the embed readable to gf", () => {
    const state = EditorState.create({ doc: "![[note]]", extensions: [noteLanguage()] });

    expect(wikiLinkAt(state, 4)).toBe("note");
  });

  it("refuses what a wikilink refuses", () => {
    expect(tree("![[note")).not.toContain("Embed");
    expect(tree("![[  ]]")).not.toContain("Embed");
    expect(tree("![[a\nb]]")).not.toContain("Embed");
  });

  it("leaves a markdown image an image", () => {
    expect(tree("![alt](shot.png)")).toContain("Image");
    expect(tree("![alt](shot.png)")).not.toContain("Embed");
  });
});

describe("a note longer than the first parse", () => {
  it("draws what the parser reaches after the note has opened", () => {
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
    // The worker parses 3 s per 30 s in idle slices, so a busy box outlasts
    // any wait; this lands the tree as the empty transaction a slice sends.
    forceParsing(view, doc.length, 10_000);
    expect(drawn(view, from, doc.length)).toBe(true);
    view.destroy();
  });
});
