import { decksFrom } from "@/lib/review";
import { parseCards } from "@/lib/srs";
import { one, TODAY } from "./review-fixture";

describe("decksFrom on an imported question holding `::`", () => {
  // The text `as_note` writes in `backend/tests/test_anki.py`. It writes a
  // front's `::` as `:&#58;`, a front line holding `::` reading as a card of
  // one line (#683), so the overview must count the card once, by its `?`.
  it("counts the card once, as the sitting does", () => {
    const text = "#flashcards/French\n\nWhat does std:&#58;move do?\n?\ncasts to an rvalue\n";

    expect(decksFrom(one("f.md", text), TODAY)).toMatchObject([{ name: "French", fresh: 1 }]);
    expect(parseCards(text)).toHaveLength(1);
  });

  it("counts it once when the answer holds `::` too, beside one-line cards", () => {
    const text =
      "#flashcards/x\n\na::b\n\nWhat does std:&#58;move do?\n?\ncasts std::move\n\nc::d\n";

    expect(decksFrom(one("x.md", text), TODAY)).toMatchObject([{ name: "x", fresh: 3 }]);
    expect(parseCards(text)).toHaveLength(3);
  });

  it("takes the front's own tag as the card's", () => {
    const text = "#flashcards/x\n\n#flashcards/cpp What does std:&#58;move do?\n?\ncasts\n";

    expect(decksFrom(one("x.md", text), TODAY).map((deck) => [deck.name, deck.fresh])).toEqual([
      ["cpp", 1],
      ["x", 1],
    ]);
  });

  it("counts nothing for a question `as_note` left out for an answer of `?`", () => {
    // `as_note` once wrote `Is a::b valid?`, `?`, `?` here, which this file
    // counted as two cards and `srs.ts` as one; it now leaves the card out.
    const text = "#flashcards/x\n\na::b\n";

    expect(decksFrom(one("x.md", text), TODAY)).toMatchObject([{ fresh: 1, parked: 0 }]);
    expect(parseCards(text)).toHaveLength(1);
  });

  it("counts nothing for a question `as_note` left out for want of an answer", () => {
    const text = "#flashcards/x\n\na::b\n";

    expect(decksFrom(one("x.md", text), TODAY)).toMatchObject([{ fresh: 1, parked: 0 }]);
    expect(parseCards(text)).toHaveLength(1);
  });
});
