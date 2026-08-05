import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { backticks, fenceAt } from "@/lib/backticks";

const FENCE = "```\n\n```";

function doc(text: string) {
  return EditorState.create({ doc: text });
}

describe("fenceAt", () => {
  it("opens a whole fence on the third backtick", () => {
    // `closeBrackets` has already answered the first backtick with a pair and
    // skipped over the second, so the line holds `` and the cursor is past it.
    expect(fenceAt(doc("``"), 2)).toEqual({ from: 0, to: 2, insert: FENCE, cursor: 4 });
  });

  it("leaves the second backtick to closeBrackets", () => {
    // Between the pair is where the second keystroke lands, and skipping over
    // the closing one is the right answer to it.
    expect(fenceAt(doc("``"), 1)).toBeNull();
  });

  it("is no fence when the backticks close a word", () => {
    expect(fenceAt(doc("use ``"), 6)).toBeNull();
  });

  it("is no fence when the line carries anything else", () => {
    expect(fenceAt(doc("``x"), 2)).toBeNull();
  });

  it("works on the line the cursor is on, not the first one", () => {
    expect(fenceAt(doc("text\n``"), 7)).toEqual({ from: 5, to: 7, insert: FENCE, cursor: 9 });
  });
});

describe("the backtick pair", () => {
  function brackets() {
    const state = EditorState.create({
      doc: "",
      extensions: [markdown({ base: markdownLanguage }), backticks()],
    });
    return state.languageDataAt<{ brackets: string[] }>("closeBrackets", 0)[0]?.brackets ?? [];
  }

  it("closes a backtick, which markdown otherwise leaves open", () => {
    expect(brackets()).toContain("`");
  });

  it("keeps closing everything that already closed", () => {
    expect(brackets()).toEqual(expect.arrayContaining(["(", "[", "{"]));
  });
});
