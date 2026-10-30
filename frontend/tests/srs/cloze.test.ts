import { setSuspended, writeSchedule } from "@/lib/review/card-write";
import { type Card, parseCards } from "@/lib/review/srs";
import { only } from "./fixture";

describe("parseCards on a cloze", () => {
  const CLOZE = "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";

  it("asks one card per number, hiding its text and showing the others plain", () => {
    const cards = parseCards(CLOZE);

    expect(cards.map((card) => [card.cloze, card.front, card.back])).toEqual([
      [1, "The capital of \\[...\\] is Paris.", "The capital of ==France== is Paris."],
      [2, "The capital of France is \\[a city\\].", "The capital of France is ==Paris==."],
    ]);
    expect(cards.map((card) => [card.from, card.inline, card.decks, card.parked])).toEqual([
      [2, true, ["geo"], null],
      [2, true, ["geo"], null],
    ]);
  });

  it("reads the cloze before the divider, a `::` outside the marks included", () => {
    const cards = parseCards("#flashcards\n\nA {{c1::b}} with c::d after it\n");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cloze: 1, front: "A \\[...\\] with c::d after it" });
  });

  it("asks two marks of one number as one card, hidden and shown together", () => {
    const cards = parseCards("#flashcards\n\nWater is {{c1::H}}2{{c1::O}}.\n");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: "Water is \\[...\\]2\\[...\\].",
      back: "Water is ==H==2==O==.",
      target: "H, O",
    });
  });

  it("keeps each number's schedule apart, off its own labelled comment", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c2!2026-08-15,1,250--> <!--SR:c1!2026-08-20,4,270-->\n";
    const [one, two] = parseCards(text);

    expect(one?.held).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
    expect(two?.held).toEqual({ due: "2026-08-15", interval: 1, ease: 250 });
    expect(one?.front).toBe("\\[...\\] b");
  });

  it("reads the line above a `?` as a cloze with its back under the answer", () => {
    const text =
      "#flashcards\n\nThe capital of France is {{c1::Paris}}.\n?\nOn the Seine.\n<!--SR:c1!2026-08-20,4,270-->\n";
    const cards = parseCards(text);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cloze: 1,
      inline: false,
      front: "The capital of France is \\[...\\].",
      back: "The capital of France is ==Paris==.\n\nOn the Seine.",
      held: { due: "2026-08-20", interval: 4, ease: 270 },
      from: 2,
      to: 5,
    });
  });

  it("reads a marked front line further up a `?` as a cloze of its own", () => {
    const cards = parseCards("#flashcards\n\n{{c1::A}} first\n{{c1::B}} second\n?\nextra\n");

    expect(cards.map((card) => [card.from, card.inline, card.front])).toEqual([
      [2, true, "\\[...\\] first"],
      [3, false, "\\[...\\] second"],
    ]);
  });

  it("reads no cloze inside a fence, and none in a note nobody tagged", () => {
    expect(parseCards("#flashcards\n\n```\n{{c1::a}}\n```\n")).toEqual([]);
    expect(parseCards("{{c1::a}} {{c2::b}}\n").map((card) => card.decks)).toEqual([[], []]);
  });

  it("parks every number off the token on its line, and never as unanswered", () => {
    const cards = parseCards("#flashcards\n\n{{c1::a}} {{c2::b}} !suspended\n{{c1::c}}::\n");

    expect(cards.map((card) => card.parked)).toEqual(["suspended", "suspended", null]);
  });
});

describe("writeSchedule on a cloze", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };

  it("adds only the number rated, leaving the other with none", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n";
    const two = parseCards(text)[1] as Card;

    expect(writeSchedule(text, two, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c2!2026-09-01,7,250-->\n",
    );
  });

  it("rewrites its own comment and leaves the other number's untouched", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-01,2,240--> <!--SR:c2!2026-08-15,1,250-->\n";
    const one = parseCards(text)[0] as Card;

    expect(writeSchedule(text, one, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-09-01,7,250--> <!--SR:c2!2026-08-15,1,250-->\n",
    );
  });

  it("rewrites the comment in place when one number is rated twice", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n";
    const once = writeSchedule(text, parseCards(text)[0] as Card, next);
    const twice = writeSchedule(once, parseCards(once)[0] as Card, {
      due: "2026-09-02",
      interval: 1,
      ease: 230,
    });

    expect(twice).toBe("#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-09-02,1,230-->\n");
  });

  it("puts a `?` cloze's comments on the line under its back, one line for all", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n";
    const first = writeSchedule(text, parseCards(text)[1] as Card, next);

    expect(first).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-09-01,7,250-->\n",
    );
    expect(writeSchedule(first, parseCards(first)[0] as Card, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-09-01,7,250--> <!--SR:c1!2026-09-01,7,250-->\n",
    );
  });
});

describe("a nested cloze", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };

  it("A1 asks a nested line as two cards, each writing its own comment", () => {
    const text = "#flashcards\n\n{{c1::Canberra was {{c2::founded}} in 1913}}\n";
    const cards = parseCards(text);

    expect(cards.map((card) => [card.cloze, card.front, card.target])).toEqual([
      [1, "\\[...\\]", "Canberra was founded in 1913"],
      [2, "Canberra was \\[...\\] in 1913", "founded"],
    ]);

    const once = writeSchedule(text, cards[1] as Card, next);
    expect(once).toBe(
      "#flashcards\n\n{{c1::Canberra was {{c2::founded}} in 1913}} <!--SR:c2!2026-09-01,7,250-->\n",
    );
    const twice = writeSchedule(once, parseCards(once)[0] as Card, {
      due: "2026-09-02",
      interval: 1,
      ease: 230,
    });
    expect(twice).toBe(
      "#flashcards\n\n{{c1::Canberra was {{c2::founded}} in 1913}} <!--SR:c2!2026-09-01,7,250--> <!--SR:c1!2026-09-02,1,230-->\n",
    );
    expect(parseCards(twice).map((card) => card.held)).toEqual([
      { due: "2026-09-02", interval: 1, ease: 230 },
      next,
    ]);
  });

  it("A6 keeps a single-level line's two schedules as they were", () => {
    const text =
      "#flashcards\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}. <!--SR:c1!2026-08-20,4,270--> <!--SR:c2!2026-08-15,1,250-->\n";
    const cards = parseCards(text);

    expect(cards.map((card) => [card.cloze, card.front, card.back, card.held])).toEqual([
      [
        1,
        "The capital of \\[...\\] is Paris.",
        "The capital of ==France== is Paris.",
        { due: "2026-08-20", interval: 4, ease: 270 },
      ],
      [
        2,
        "The capital of France is \\[a city\\].",
        "The capital of France is ==Paris==.",
        { due: "2026-08-15", interval: 1, ease: 250 },
      ],
    ]);
  });
});

describe("a cloze beside the other card forms", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };
  const MIXED = `#flashcards

a::b <!--SR:!2026-08-01,2,240-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`;

  it("rates every plain card to exactly the bytes it gave before", () => {
    const [inline, cloze, multi] = parseCards(MIXED);
    expect(inline?.cloze).toBeNull();
    expect(cloze?.cloze).toBe(1);
    expect(multi?.cloze).toBeNull();

    expect(writeSchedule(MIXED, inline as Card, next)).toBe(`#flashcards

a::b <!--SR:!2026-09-01,7,250-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`);
    expect(writeSchedule(MIXED, multi as Card, next)).toBe(`#flashcards

a::b <!--SR:!2026-08-01,2,240-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-09-01,7,250-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`);
    // And the other way: rating the cloze leaves both plain cards' lines alone.
    expect(writeSchedule(MIXED, cloze as Card, next)).toBe(
      MIXED.replace(
        "{{c1::x}} <!--SR:c1!2026-08-20,4,270-->",
        "{{c1::x}} <!--SR:c1!2026-09-01,7,250-->",
      ),
    );
  });

  it("never reads a neighbour's comment of the other kind as its own", () => {
    const cards = parseCards(MIXED);

    expect(cards.map((card) => [card.cloze, card.held?.due ?? null])).toEqual([
      [null, "2026-08-01"],
      [1, "2026-08-20"],
      [null, "2026-08-14"],
      [1, "2026-08-21"],
      [2, null],
    ]);
  });
});

describe("a `?` cloze whose schedule line holds a plain comment", () => {
  // A `?` card from main whose front happens to hold a mark.
  const PLAIN = "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250-->";

  it("parks on that line, and puts back to the same bytes", () => {
    const on = setSuspended(PLAIN, only(PLAIN), true);

    expect(on).toBe(
      "#flashcards\nThe {{c1::A}} b\n?\nback\n!suspended <!--SR:!2026-10-01,1,250-->",
    );
    expect(only(on).parked).toBe("suspended");
    expect(setSuspended(on, only(on), false)).toBe(PLAIN);
  });

  it("adds its labelled comment on that line, the plain one left as it was", () => {
    expect(writeSchedule(PLAIN, only(PLAIN), { due: "2026-09-01", interval: 7, ease: 250 })).toBe(
      "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250--> <!--SR:c1!2026-09-01,7,250-->",
    );
  });
});

describe("setSuspended on a cloze", () => {
  const ONE_LINE = "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-20,4,270-->\n";
  const UNDER = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-08-20,4,270-->\n";
  const BARE = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n";

  it("parks every number off one token, and one put back restores them all", () => {
    for (const [text, parked] of [
      [ONE_LINE, "#flashcards\n\n{{c1::a}} {{c2::b}} !suspended <!--SR:c1!2026-08-20,4,270-->\n"],
      [
        UNDER,
        "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n!suspended <!--SR:c2!2026-08-20,4,270-->\n",
      ],
      [BARE, "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n!suspended\n"],
    ] as const) {
      const on = setSuspended(text, parseCards(text)[0] as Card, true);
      expect(on).toBe(parked);
      expect(parseCards(on).map((card) => card.parked)).toEqual(["suspended", "suspended"]);
      // Put back through the other number: one token, so either one lifts it.
      expect(setSuspended(on, parseCards(on)[1] as Card, false)).toBe(text);
    }
  });
});
