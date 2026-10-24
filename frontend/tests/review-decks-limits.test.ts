import { type Deck, decksFrom } from "@/lib/review";
import { seatsFor } from "@/lib/review-queue";
import { note, TODAY } from "./review-fixture";

describe("decksFrom with daily limits", () => {
  const NO_DEFAULT = { new_per_day: null, reviews_per_day: null };
  /** Due before today, and never answered today. */
  const DUE = "<!--SR:!2026-08-10,3,250-->";
  /** A review answered today: due today plus its interval, off a grown ease. */
  const REVIEWED = "<!--SR:!2026-08-16,3,250-->";
  /** A first answer given today: the starting ease and a gap of one day. */
  const INTRODUCED = "<!--SR:!2026-08-14,1,250-->";

  /** A deck note under `tag` holding `due` due cards and `fresh` new ones. */
  function deck(path: string, tag: string, due: number, fresh: number, more: string[] = []) {
    return note(path, [
      `#flashcards/${tag}`,
      ...Array.from({ length: due }, (_, at) => `due ${at}::a ${DUE}`),
      ...Array.from({ length: fresh }, (_, at) => `new ${at}::a`),
      ...more,
    ]);
  }

  function named(decks: Deck[], name: string) {
    return decks.find((each) => each.name === name);
  }

  it("A7 caps a deck at the new cards and reviews its line in decks.md sets", () => {
    const decks = decksFrom(deck("g.md", "trivia/geography", 5, 5), TODAY, {
      note: "trivia/geography: 2 new, 3 reviews\n",
      defaults: NO_DEFAULT,
    });
    expect(named(decks, "trivia/geography")).toMatchObject({ due: 3, fresh: 2 });
  });

  it("A7 reads a line opening with a dash that sets one half only", () => {
    const decks = decksFrom(deck("g.md", "trivia", 5, 5), TODAY, {
      note: "- trivia: 2 new\n",
      defaults: NO_DEFAULT,
    });
    expect(named(decks, "trivia")).toMatchObject({ due: 5, fresh: 2 });
  });

  it("A8 gives a subdeck its parent's limits, each half, unless it sets its own", () => {
    const decks = decksFrom(
      [...deck("g.md", "trivia/geography", 5, 5), ...deck("h.md", "trivia/history", 5, 5)],
      TODAY,
      { note: "trivia: 2 new, 3 reviews\ntrivia/history: 1 new\n", defaults: NO_DEFAULT },
    );
    expect(named(decks, "trivia/geography")).toMatchObject({ due: 3, fresh: 2 });
    expect(named(decks, "trivia/history")).toMatchObject({ due: 3, fresh: 1 });
  });

  it("A9 caps a parent at its own limit across every subdeck, theirs not binding", () => {
    const decks = decksFrom(
      [...deck("a.md", "trivia/a", 0, 2), ...deck("b.md", "trivia/b", 0, 2)],
      TODAY,
      { note: "trivia: 3 new\ntrivia/a: 1 new\ntrivia/b: 5 new\n", defaults: NO_DEFAULT },
    );
    expect(named(decks, "trivia")).toMatchObject({ fresh: 3 });
    expect(named(decks, "trivia/a")).toMatchObject({ fresh: 1 });
    expect(named(decks, "trivia/b")).toMatchObject({ fresh: 2 });
  });

  it("A10 falls back on the default where no line sets a limit, and on none without one", () => {
    const notes = deck("g.md", "trivia", 5, 5);
    const capped = decksFrom(notes, TODAY, {
      note: null,
      defaults: { new_per_day: 1, reviews_per_day: 2 },
    });
    expect(named(capped, "trivia")).toMatchObject({ due: 2, fresh: 1 });

    const open = decksFrom(notes, TODAY, { note: null, defaults: NO_DEFAULT });
    expect(named(open, "trivia")).toMatchObject({ due: 5, fresh: 5 });
  });

  it("I1 takes the cards answered earlier today off today's limit", () => {
    const decks = decksFrom(
      deck("g.md", "trivia", 5, 5, [
        `done 1::a ${REVIEWED}`,
        `done 2::a ${REVIEWED}`,
        `met 1::a ${INTRODUCED}`,
        // Parked counts against nothing, answered today or not.
        `parked::a !suspended ${REVIEWED}`,
      ]),
      TODAY,
      { note: "trivia: 3 new, 3 reviews\n", defaults: NO_DEFAULT },
    );
    expect(named(decks, "trivia")).toMatchObject({ due: 1, fresh: 2, parked: 1 });
  });

  it("I3 skips a line of decks.md it cannot read and keeps the others", () => {
    const decks = decksFrom(
      [...deck("g.md", "trivia/geography", 5, 5), ...deck("h.md", "trivia/history", 5, 5)],
      TODAY,
      {
        note: [
          "---",
          "id: abc",
          "---",
          "Limits per deck.",
          "trivia: lots new",
          "trivia/history: 2 new, 3 reviews, 4 cats",
          "trivia/geography: 2 new",
        ].join("\n"),
        defaults: NO_DEFAULT,
      },
    );
    expect(named(decks, "trivia/geography")).toMatchObject({ due: 5, fresh: 2 });
    expect(named(decks, "trivia/history")).toMatchObject({ due: 5, fresh: 5 });
    expect(named(decks, "trivia")).toMatchObject({ due: 10, fresh: 10 });
  });

  it("I7 draws a deck capped at 0 as 0 due and 0 new, its parked count untouched", () => {
    const decks = decksFrom(deck("g.md", "trivia", 2, 2, ["parked::a !suspended"]), TODAY, {
      note: "trivia: 0 new, 0 reviews\n",
      defaults: NO_DEFAULT,
    });
    expect(named(decks, "trivia")).toMatchObject({ due: 0, fresh: 0, parked: 1 });
  });

  it("puts no limit on a note marked for review", () => {
    const decks = decksFrom(
      [...note("notes/tls.md", ["#review"]), ...deck("g.md", "trivia", 1, 1)],
      TODAY,
      { note: "tls: 0 new\n", defaults: { new_per_day: 0, reviews_per_day: 0 } },
    );
    expect(named(decks, "trivia")).toMatchObject({ due: 0, fresh: 0 });
    expect(named(decks, "tls")).toMatchObject({ fresh: 1 });
  });

  /** Answered Again on its first answer today: due today, a gap of 0. */
  const LEARNING = "<!--SR:!2026-08-13,0,250-->";

  it("a card in learning spends its new slot once and is asked past the review limit", () => {
    const notes = deck("t.md", "trivia", 2, 2, [`learn::a ${LEARNING}`]);
    const limits = { note: "trivia: 2 new, 1 reviews\n", defaults: NO_DEFAULT };

    // One review and the card in learning; one new card, the other slot taken.
    expect(named(decksFrom(notes, TODAY, limits), "trivia")).toMatchObject({ due: 2, fresh: 1 });

    const texts = new Map(notes.map(({ path, text }) => [path, text]));
    const trivia = named(decksFrom(notes, TODAY, limits), "trivia");
    if (trivia === undefined) throw new Error("no trivia deck");
    // The card in learning comes first, so the review limit cannot cut it.
    expect(seatsFor(trivia, texts, TODAY, limits).map(({ at }) => at)).toEqual([4, 0, 2]);
  });
});
