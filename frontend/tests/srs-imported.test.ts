import { sameAnswer } from "@/lib/review/card-text";
import { setSuspended, writeSchedule } from "@/lib/review/card-write";
import { parseCards } from "@/lib/review/srs";
import { only } from "./srs-fixture";

describe("parseCards on an imported question holding `::`", () => {
  // The text `as_note` writes in `backend/tests/test_anki.py`: on one line the
  // first `::` would cut the question at `What does std`. The front's `::` is
  // written `:&#58;`, since a front line holding `::` reads as a card of one
  // line (#683), and `colons` shows it as `::`. The back keeps its `::`.
  it("reads back the whole question and the answer", () => {
    const cards = parseCards(
      "#flashcards/French\n\nWhat does std:&#58;move do?\n?\ncasts to an rvalue\n",
      "French",
    );

    expect(cards.map(({ front, back, decks }) => ({ front, back, decks }))).toEqual([
      { front: "What does std::move do?", back: "casts to an rvalue", decks: ["French"] },
    ]);
  });

  it("keeps its one-line neighbours apart from it when the answer holds `::` too", () => {
    const cards = parseCards(
      "#flashcards/x\n\na::b\n\nWhat does std:&#58;move do?\n?\ncasts std::move\n\nc::d\n",
    );

    expect(cards.map(({ front, back }) => [front, back])).toEqual([
      ["a", "b"],
      ["What does std::move do?", "casts std::move"],
      ["c", "d"],
    ]);
  });
});

describe("parseCards on an imported deck keeping its formatting", () => {
  // `COUNTED_NOTE` in `backend/tests/test_anki.py`, which `card_count` counts
  // as five: the import's count has to be what the sitting reads.
  const note = [
    "#flashcards/French",
    "",
    "Name three",
    "colours",
    "?",
    "- red",
    "- green",
    "",
    "漢字::<ruby>漢字<rt>かんじ</rt></ruby>",
    "",
    "{{c1::Paris}} is in {{c2::France}}",
    "?",
    "On the",
    "Seine",
    "",
    "What does std:&#58;size count?",
    "?",
    "\\# of elements",
    "\\!suspended no",
    "",
  ].join("\n");

  it("reads as many cards as the import counts, each side whole", () => {
    const cards = parseCards(note, "French");

    expect(cards).toHaveLength(5);
    expect(cards.map(({ front, back, cloze }) => (cloze === null ? [front, back] : cloze))).toEqual(
      [
        ["Name three\ncolours", "- red\n- green"],
        ["漢字", "<ruby>漢字<rt>かんじ</rt></ruby>"],
        1,
        2,
        ["What does std::size count?", "\\# of elements\n\\!suspended no"],
      ],
    );
    expect(cards[2]?.back.endsWith("\n\nOn the\nSeine")).toBe(true);
    expect(cards.every((card) => card.parked === null)).toBe(true);
  });

  it("asks a cloze over ruby for the word, its reading no part of the answer", () => {
    const [card] = parseCards("#flashcards/x\n\n{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}を読む\n");

    expect(card?.target).toBe("漢字");
    expect(sameAnswer("漢字", card?.target ?? "")).toBe(true);
  });

  it("parks no card whose answer names the escaped token mid-line", () => {
    const [card] = parseCards("#flashcards/x\n\nQ::type x \\!suspended there\n");

    expect(card?.parked).toBeNull();
    expect(card?.back).toBe("type x \\!suspended there");
  });
});

describe("an imported card carrying its anki id", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };
  const INLINE =
    "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d-->\nx::y\n";
  const CLOZE = "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d-->\nx::y\n";
  const MULTI =
    "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n\nx::y\n";

  /** Rate it, park it, put it back: the three notes written along the way. */
  function sit(text: string) {
    const rated = writeSchedule(text, only(text), next);
    const parked = setSuspended(rated, only(rated), true);
    return { rated, parked, back: setSuspended(parked, only(parked), false) };
  }

  it("never shows the id on either side, and a typed answer matches without it", () => {
    expect(only(INLINE)).toMatchObject({ front: "What is S3?", back: "Simple Storage" });
    expect(sameAnswer("simple storage", only(INLINE).back)).toBe(true);

    expect(only(CLOZE)).toMatchObject({
      front: "The capital is \\[...\\].",
      back: "The capital is ==Paris==.",
      target: "Paris",
    });
    expect(sameAnswer("paris", only(CLOZE).target ?? "")).toBe(true);

    expect(only(MULTI)).toMatchObject({ front: "Front", back: "Back line one\nBack line two" });
    expect(sameAnswer("Back line one Back line two", only(MULTI).back)).toBe(true);

    const extra = "#flashcards\n\n{{c1::a}}\n?\nextra <!--anki:9:0:0a1b2c3d-->\n";
    expect(only(extra).back).toBe("==a==\n\nextra");
  });

  it("keeps the id byte for byte through a rating and a park on a one-line card", () => {
    const { rated, parked, back } = sit(INLINE);

    expect(rated).toBe(
      "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d--> <!--SR:!2026-09-01,7,250-->\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d--> !suspended <!--SR:!2026-09-01,7,250-->\nx::y\n",
    );
    expect(back).toBe(rated);
    expect(only(parked)).toMatchObject({ back: "Simple Storage", held: next, parked: "suspended" });
    expect(only(back)).toMatchObject({ back: "Simple Storage", held: next, parked: null });
  });

  it("keeps the id byte for byte through a rating and a park on a cloze line", () => {
    const { rated, parked, back } = sit(CLOZE);

    expect(rated).toBe(
      "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d--> <!--SR:c1!2026-09-01,7,250-->\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d--> !suspended <!--SR:c1!2026-09-01,7,250-->\nx::y\n",
    );
    expect(back).toBe(rated);
    expect(only(parked)).toMatchObject({
      back: "The capital is ==Paris==.",
      held: next,
      parked: "suspended",
    });
    expect(only(back)).toMatchObject({
      back: "The capital is ==Paris==.",
      held: next,
      parked: null,
    });
  });

  it("keeps the id byte for byte through a rating and a park on a `?` card", () => {
    const { rated, parked, back } = sit(MULTI);

    expect(rated).toBe(
      "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n<!--SR:!2026-09-01,7,250-->\n\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n!suspended <!--SR:!2026-09-01,7,250-->\n\nx::y\n",
    );
    expect(back).toBe(rated);
    const shown = { front: "Front", back: "Back line one\nBack line two", held: next };
    expect(only(parked)).toMatchObject({ ...shown, parked: "suspended" });
    expect(only(back)).toMatchObject({ ...shown, parked: null });
  });
});

describe("an imported cloze with an entity brace or an empty inner mark", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) =>
    parseCards(`#flashcards/x\n\n${line}${ID}\n`).map((card) => [card.cloze, card.parked]);

  it("reads a brace highlight with no Back Extra as one unanswered card", () => {
    expect(read("=={==::")).toEqual([[null, "unanswered"]]);
  });

  it("reads a brace highlight with a Back Extra as one card", () => {
    expect(read("=={==::extra")).toEqual([[null, null]]);
  });

  it("reads a brace beside a cloze as the cloze's one card", () => {
    expect(read("==a { {{c2::b}}==")).toEqual([[2, null]]);
  });

  it("reads a cloze whose empty inner mark was dropped as one card", () => {
    expect(read("{{c1::a }}")).toEqual([[1, null]]);
  });

  it("reads a brace highlight beside a later cloze as that cloze's one card", () => {
    expect(read("==a {== {{c3::c}}")).toEqual([[3, null]]);
  });
});

describe("an imported cloze whose answer holds an entity colon", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("asks an entity :: as the answer, with no hint", () => {
    const cards = read("{{c1::a&#58;&#58;b}}");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe("\\[...\\]");
    expect(sameAnswer("a::b", cards[0]?.target ?? "")).toBe(true);
  });

  it("asks an entity :: before a hint by that hint", () => {
    const [card] = read("{{c1::a&#58;&#58;b::h}}");

    expect(card?.front).toBe("\\[h\\]");
    expect(sameAnswer("a::b", card?.target ?? "")).toBe(true);
  });

  it("asks an entity colon closing the answer before a hint", () => {
    const [card] = read("{{c1::a&#58;::h}}");

    expect(card?.front).toBe("\\[h\\]");
    expect(sameAnswer("a:", card?.target ?? "")).toBe(true);
  });

  it("asks an entity :: inside an outer mark on its own card", () => {
    const cards = read("{{c1::x {{c2::a&#58;&#58;b}}}}");

    expect(cards.map((card) => card.cloze)).toEqual([1, 2]);
    expect(cards[0]?.back).toBe("==x a::b==");
    expect(sameAnswer("a::b", cards[1]?.target ?? "")).toBe(true);
  });

  it("shows an entity :: in a highlight the import wrote as colons", () => {
    const [card] = read("=={&#58;&#58;b==::extra");

    expect(card?.front).toBe("=={::b==");
    expect(card?.back).toBe("extra");
  });

  it("shows an entity :: in a ? card's highlight as colons", () => {
    const [card] = read("=={&#58;&#58;b==\n?\ne1\ne2");

    expect(card?.front).toBe("=={::b==");
    expect(card?.back).toBe("e1\ne2");
  });

  it("shows &#58; as a colon on both sides of a hand-written card, as markdown does", () => {
    const [card] = parseCards("Is &#58; a colon?::a&#58;b\n");

    expect(card?.front).toBe("Is : a colon?");
    expect(card?.back).toBe("a:b");
  });
});
