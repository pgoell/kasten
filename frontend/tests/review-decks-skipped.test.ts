import { decksFrom } from "@/lib/review";
import { one, TODAY } from "./review-fixture";

describe("#660 decksFrom on a deck tag inside a comment", () => {
  it("#660 I4 the overview counts no card in a deck its tag names only inside a comment", () => {
    const decks = decksFrom(
      [
        { path: "closed.md", text: "<!--\n#flashcards/x\n-->\nQ::A" },
        { path: "open.md", text: "<!--\n#flashcards/x\nQ::A" },
      ],
      TODAY,
    );

    expect(decks).toEqual([]);
  });
});

describe("#664 decksFrom on a code block", () => {
  it("#664 A3 the overview counts no card and no deck out of a tilde fence", () => {
    const text = "#flashcards/a\n\nq::a\n\n~~~\n#flashcards/x\nstd::vector\n~~~\n";

    expect(decksFrom(one("n.md", text), TODAY).map(({ name, fresh }) => [name, fresh])).toEqual([
      ["a", 1],
    ]);
  });
});
