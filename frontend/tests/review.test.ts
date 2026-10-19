import type { SearchHit } from "@/lib/api";
import { inDeck } from "@/lib/deck-tag";
import { noteName } from "@/lib/note-path";
import { type Deck, type DeckNote, deckNotes, decksFrom, parkedNotes } from "@/lib/review";
import { parseCards, readNoteSchedule, readNoteSuspended, setSuspended } from "@/lib/srs";

const TODAY = "2026-08-13";

function hits(path: string, lines: string[]): SearchHit[] {
  return lines.map((text, at) => ({ path, line: at + 1, text }));
}

/** One note of these lines, as the overview reads it once fetched. */
function note(path: string, lines: string[]): DeckNote[] {
  return [{ path, text: lines.join("\n") }];
}

/** One note of this text. */
function one(path: string, text: string): DeckNote[] {
  return [{ path, text }];
}

describe("decksFrom", () => {
  it("names a deck after the tag's subpath", () => {
    const decks = decksFrom(note("decks/aws.md", ["#flashcards/aws", "a::b"]), TODAY);
    expect(decks).toHaveLength(1);
    expect(decks[0]?.name).toBe("aws");
    expect(decks[0]?.notes).toEqual(["decks/aws.md"]);
  });

  it("names a deck after its note where the tag is bare", () => {
    const decks = decksFrom(note("decks/Terraform drills.md", ["#flashcards", "a::b"]), TODAY);
    expect(decks[0]?.name).toBe("Terraform drills");
  });

  it("counts a card nothing has scheduled as new", () => {
    const [deck] = decksFrom(note("d.md", ["#flashcards", "a::b", "c::d"]), TODAY);
    expect(deck).toMatchObject({ fresh: 2, due: 0 });
  });

  it("counts a card scheduled for today or earlier as due", () => {
    const [deck] = decksFrom(
      note("d.md", [
        "#flashcards",
        "a::b <!--SR:!2026-08-13,4,250-->",
        "c::d <!--SR:!2026-08-01,4,250-->",
        "e::f <!--SR:!2026-08-20,4,250-->",
        "g::h",
      ]),
      TODAY,
    );
    expect(deck).toMatchObject({ due: 2, fresh: 1 });
  });

  it("counts a card written over several lines once", () => {
    const [deck] = decksFrom(
      note("d.md", [
        "#flashcards",
        "",
        "Q1",
        "?",
        "A1",
        "<!--SR:!2026-08-01,4,250-->",
        "",
        "Q2",
        "?",
        "A2",
      ]),
      TODAY,
    );
    expect(deck).toMatchObject({ due: 1, fresh: 1 });
  });

  it("leaves a card inside a code fence out", () => {
    // The fenced note in `backend/tests/test_cards.py`.
    const [deck] = decksFrom(
      note("decks/cpp.md", [
        "# C++",
        "",
        "#flashcards/cpp",
        "",
        "live::answer",
        "",
        "```cpp",
        "fenced::answer",
        "```",
      ]),
      TODAY,
    );
    expect(deck).toMatchObject({ fresh: 1 });
  });

  it("leaves a note carrying no tag out, whatever it holds", () => {
    expect(decksFrom(note("code.md", ["std::vector", "a::b", "?"]), TODAY)).toEqual([]);
  });

  it("keeps two decks apart", () => {
    const decks = decksFrom(
      [...note("a.md", ["#flashcards/aws", "a::b"]), ...note("t.md", ["#flashcards/tf", "c::d"])],
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["aws", "tf"]);
  });

  it("makes one deck of one tag written in two notes", () => {
    const decks = decksFrom(
      [...note("a.md", ["#flashcards/db", "a::b"]), ...note("b.md", ["#flashcards/db", "c::d"])],
      TODAY,
    );

    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ name: "db", notes: ["a.md", "b.md"], fresh: 2 });
  });

  it("adds the deck a card names at its own head to the note's", () => {
    const decks = decksFrom(
      note("procs.md", ["#flashcards/db", "a::b", "#flashcards/dbt How does it relate?::so"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db", "dbt"]);
    // The tagged card is asked in both, the other in the note's deck alone.
    expect(decks[0]).toMatchObject({ fresh: 2 });
    expect(decks[1]).toMatchObject({ fresh: 1, notes: ["procs.md"] });
  });

  it("takes a card's own tag on the front of one written over several lines", () => {
    const decks = decksFrom(
      note("procs.md", ["#flashcards/dbt A question", "?", "An answer"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });

  it("makes a card of a tagged line in a note carrying no tag at all", () => {
    const decks = decksFrom(note("prose.md", ["std::vector", "#flashcards/dbt a::b"]), TODAY);

    expect(decks.map((deck) => deck.name)).toEqual(["dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });

  it("reads a tag heading prose as the note's, not a card's", () => {
    // The line `srs.ts` and this file could most easily disagree on. Both read
    // head tags as a card's only where the card is on that line or the next.
    const decks = decksFrom(
      note("procs.md", ["#flashcards/db is the deck here.", "a::b", "c::d"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db"]);
    expect(decks[0]).toMatchObject({ fresh: 2 });
  });

  it("keeps a card's own tag off the card under it", () => {
    const decks = decksFrom(
      note("procs.md", ["#flashcards/db", "#flashcards/dbt a::b", "c::d"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db", "dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 2 });
    expect(decks[1]).toMatchObject({ fresh: 1 });
  });

  it("sorts the decks by name", () => {
    const decks = decksFrom(
      [
        ...note("z.md", ["#flashcards/zeta", "a::b"]),
        ...note("a.md", ["#flashcards/alpha", "c::d"]),
      ],
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("decksFrom on a parked card", () => {
  it("counts a card carrying the token as parked rather than new", () => {
    const [deck] = decksFrom(note("d.md", ["#flashcards", "a::b", "c::d !suspended"]), TODAY);
    expect(deck).toMatchObject({ fresh: 1, parked: 1 });
  });

  it("counts a question with no answer as parked rather than new", () => {
    const [deck] = decksFrom(note("d.md", ["#flashcards", "a::b", "Question::"]), TODAY);
    expect(deck).toMatchObject({ fresh: 1, parked: 1 });
  });
});

describe("decksFrom on a note marked for review", () => {
  it("makes the note a deck of its own", () => {
    const [deck] = decksFrom(note("notes/tls.md", ["#review"]), TODAY);
    expect(deck).toMatchObject({ name: "tls", notes: ["notes/tls.md"], due: 0, fresh: 1 });
  });

  it("counts it due when its date is today or past", () => {
    const [deck] = decksFrom(
      note("notes/tls.md", ["---", "sr-due: 2026-08-01", "---", "#review"]),
      TODAY,
    );
    expect(deck).toMatchObject({ due: 1, fresh: 0 });
  });

  it("counts it neither due nor new when its date is ahead", () => {
    const [deck] = decksFrom(
      note("notes/tls.md", ["---", "sr-due: 2026-09-01", "---", "#review"]),
      TODAY,
    );
    expect(deck).toMatchObject({ due: 0, fresh: 0 });
  });

  it("counts a note its frontmatter parks as parked, not new", () => {
    const [deck] = decksFrom(
      note("notes/tls.md", ["---", "sr-suspended: true", "---", "#review"]),
      TODAY,
    );
    expect(deck).toMatchObject({ parked: 1, fresh: 0, due: 0 });
  });

  it("keeps a note holding cards as a deck of cards", () => {
    const [deck] = decksFrom(note("d.md", ["#flashcards/aws", "a::b"]), TODAY);
    expect(deck).toMatchObject({ name: "aws", fresh: 1 });
  });
});

describe("decksFrom on a nested deck tag", () => {
  it("counts the card in the deck named and in every deck above it", () => {
    const decks = decksFrom(note("d.md", ["#flashcards/databases/postgres", "a::b"]), TODAY);
    expect(decks.map((deck) => deck.name)).toEqual(["databases", "databases/postgres"]);
    expect(decks[0]).toMatchObject({ fresh: 1, notes: ["d.md"] });
    expect(decks[1]).toMatchObject({ fresh: 1, notes: ["d.md"] });
  });

  it("gathers two children under the one parent", () => {
    const decks = decksFrom(
      [
        ...note("p.md", ["#flashcards/databases/postgres", "a::b"]),
        ...note("s.md", ["#flashcards/databases/sqlite", "c::d", "e::f"]),
      ],
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual([
      "databases",
      "databases/postgres",
      "databases/sqlite",
    ]);
    expect(decks[0]).toMatchObject({ fresh: 3, notes: ["p.md", "s.md"] });
  });

  it("counts a card tagged parent and child once in the parent", () => {
    const decks = decksFrom(
      note("d.md", ["#flashcards/databases", "#flashcards/databases/postgres a::b"]),
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["databases", "databases/postgres"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });
});

describe("deckNotes", () => {
  it("names the notes a hit marks as a deck, once each, and no others", () => {
    const found = deckNotes([
      ...hits("a.md", ["#flashcards", "a::b", "c::d"]),
      ...hits("code.md", ["std::vector"]),
      ...hits("t.md", ["#flashcards/dbt a::b"]),
      ...hits("n.md", ["#review"]),
      ...hits("s.md", ["sr-due: 2026-08-01"]),
      ...hits("p.md", ["sr-suspended: true"]),
    ]);

    expect(found).toEqual(["a.md", "t.md", "n.md", "s.md", "p.md"]);
  });
});

/**
 * What a sitting of `deck` would ask out of `notes`, counted the way it asks.
 *
 * `cardsOf` and the queue in `review-session.tsx`, restated: a whole note is
 * one card off its frontmatter, any other note its `parseCards` filtered by
 * `inDeck`, a parked card never asked, a due one before a new one.
 */
function sitting(deck: Deck, notes: DeckNote[]) {
  const cards = notes
    .filter(({ path }) => deck.notes.includes(path))
    .flatMap(({ path, text }) =>
      deck.whole
        ? [
            {
              held: readNoteSchedule(text),
              parked: readNoteSuspended(text) ? "suspended" : null,
            },
          ]
        : parseCards(text, noteName(path)).filter((card) =>
            card.decks.some((filed) => inDeck(filed, deck.name)),
          ),
    );
  return {
    due: cards.filter(
      (card) => card.parked === null && card.held !== null && card.held.due <= TODAY,
    ).length,
    fresh: cards.filter((card) => card.parked === null && card.held === null).length,
    parked: cards.filter((card) => card.parked !== null).length,
  };
}

describe("decksFrom against the sitting", () => {
  it("counts every deck what a sitting of it asks", () => {
    const notes: DeckNote[] = [
      ...one(
        "db/postgres.md",
        "#flashcards/databases/postgres\n\na::b <!--SR:!2026-08-01,1,250-->\nc::d !suspended\n" +
          "#flashcards/dbt e::f\n\nQ\n?\nA\n{{c1::x}} y\n<!--SR:!2026-09-01,1,250-->\n",
      ),
      ...one(
        "db/sqlite.md",
        "#flashcards/databases/sqlite\n\nThe {{c1::WAL}} is a {{c2::log}}. <!--SR:c1!2026-08-10,1,250-->\n" +
          "Question::\n\nR\n?\nS\na::b\n",
      ),
      ...one("db/top.md", "#flashcards/databases\n\ng::h\n```\nfenced::no\n```\n"),
      ...one("notes/tls.md", "---\nsr-due: 2026-08-01\n---\n#review\n\nThe handshake.\n"),
      ...one("notes/off.md", "---\nsr-suspended: true\n---\n#review\n"),
      ...one("notes/both.md", "#review #flashcards\n\nk::l\n"),
      ...one("prose.md", "#flashcards/dbt is mentioned here\n\nstd::move\n"),
    ];
    const decks = decksFrom(notes, TODAY);

    expect(decks.map((deck) => deck.name)).toEqual([
      "both",
      "databases",
      "databases/postgres",
      "databases/sqlite",
      "dbt",
      "off",
      "tls",
    ]);
    for (const deck of decks) {
      expect({ deck: deck.name, ...sitting(deck, notes) }).toEqual({
        deck: deck.name,
        due: deck.due,
        fresh: deck.fresh,
        parked: deck.parked,
      });
    }
  });

  it("counts the decks whose notes read, while another's read is still out or failed", () => {
    // The pane hands over only the notes that came back, so a failed read is a
    // note missing from this list and no more than that.
    const decks = decksFrom(one("a.md", "#flashcards/aws\n\na::b\n"), TODAY);
    expect(decks).toMatchObject([{ name: "aws", fresh: 1 }]);
  });
});

describe("decksFrom on an imported deck carrying anki ids", () => {
  const MARKED =
    "#flashcards/aws\n\nWhat is S3?::Simple Storage <!--anki:1:0:0a1b2c3d--> <!--SR:!2026-08-01,1,250-->\n" +
    "Not answered yet:: <!--anki:2:0:0a1b2c3d-->\n" +
    "The capital is {{c1::Paris}}. <!--anki:3:0:0a1b2c3d-->\n\nFront\n?\nBack <!--anki:4:1:0a1b2c3d-->\n";

  it("counts what the sitting asks, a card whose back is the id alone parked", () => {
    const notes = one("aws.md", MARKED);
    const [deck] = decksFrom(notes, TODAY);

    expect(deck).toMatchObject({ due: 1, fresh: 2, parked: 1 });
    expect(sitting(deck as Deck, notes)).toEqual({ due: 1, fresh: 2, parked: 1 });
    expect(parkedNotes(hits("aws.md", MARKED.split("\n")))).toEqual(["aws.md"]);
  });
});

describe("parkedNotes", () => {
  it("names the notes holding a parked line and leaves the others out", () => {
    const found = parkedNotes([
      ...hits("a.md", ["#flashcards", "a::b !suspended"]),
      ...hits("b.md", ["#flashcards", "c::d"]),
      ...hits("c.md", ["#flashcards", "?", "!suspended"]),
    ]);

    expect(found).toEqual(["a.md", "c.md"]);
  });

  it("names a note holding two parked lines once", () => {
    const found = parkedNotes(hits("a.md", ["#flashcards", "a::b !suspended", "c::d !suspended"]));

    expect(found).toEqual(["a.md"]);
  });

  it("names a note holding a question with no answer", () => {
    expect(parkedNotes(hits("s.md", ["#flashcards", "Question::"]))).toEqual(["s.md"]);
  });

  it("names a note its frontmatter parks", () => {
    expect(parkedNotes(hits("n.md", ["sr-suspended: true", "#review"]))).toEqual(["n.md"]);
  });
});

describe("decksFrom on an imported question holding `::`", () => {
  // The text `as_note` writes in `backend/tests/test_anki.py`. A front holding
  // `::` is a hit of its own, so the overview must not count it beside its `?`.
  it("counts the card once, as the sitting does", () => {
    const text = "#flashcards/French\n\nWhat does std::move do?\n?\ncasts to an rvalue\n";

    expect(decksFrom(one("f.md", text), TODAY)).toMatchObject([{ name: "French", fresh: 1 }]);
    expect(parseCards(text)).toHaveLength(1);
  });

  it("counts it once when the answer holds `::` too, beside one-line cards", () => {
    const text = "#flashcards/x\n\na::b\n\nWhat does std::move do?\n?\ncasts std::move\n\nc::d\n";

    expect(decksFrom(one("x.md", text), TODAY)).toMatchObject([{ name: "x", fresh: 3 }]);
    expect(parseCards(text)).toHaveLength(3);
  });

  it("takes the front's own tag as the card's", () => {
    const text = "#flashcards/x\n\n#flashcards/cpp What does std::move do?\n?\ncasts\n";

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

/** What the sitting would count off the same note, by `parseCards`. */
function sat(text: string) {
  const cards = parseCards(text, "n").filter((card) => card.decks.length > 0);
  return {
    due: cards.filter((card) => !card.parked && card.held !== null && card.held.due <= TODAY)
      .length,
    fresh: cards.filter((card) => !card.parked && card.held === null).length,
    parked: cards.filter((card) => card.parked !== null).length,
  };
}

describe("decksFrom on a cloze", () => {
  it("counts each number of a one-line cloze as a card, new or due off its own comment", () => {
    const text =
      "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris}}. <!--SR:c2!2026-08-01,1,250-->\n";
    const counted = { due: 1, fresh: 1, parked: 0 };

    expect(decksFrom(one("g.md", text), TODAY)).toMatchObject([{ name: "geo", ...counted }]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees with the sitting on a `?` cloze, its comments under the back", () => {
    const text =
      "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris}}.\n?\nOn the Seine.\n" +
      "<!--SR:c1!2026-08-01,1,250--> <!--SR:c2!2026-09-01,1,250-->\n\nc {{c1::d}} c::e\n";
    const counted = { due: 1, fresh: 1, parked: 0 };

    expect(decksFrom(one("g.md", text), TODAY)).toMatchObject([{ name: "geo", ...counted }]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees on a `?` cloze whose front holds a marked line further up", () => {
    const text = "#flashcards\n\n{{c1::a}} first\n{{c1::b}} {{c2::c}}\n?\nextra\n!suspended\n";
    const counted = { due: 0, fresh: 1, parked: 2 };

    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees on a cloze over a `?` with nothing under it", () => {
    // The `?` is the cloze's, its back empty, its dates on the line under it.
    for (const text of [
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-01,1,250-->\n?\n\nprose\n",
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\n<!--SR:c1!2026-08-01,1,250-->\n",
    ]) {
      const counted = text.includes("}}\n?\n<!--") ? { due: 1, fresh: 1 } : { due: 0, fresh: 2 };

      expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
      expect(sat(text)).toMatchObject(counted);
    }
  });

  it("agrees on a `?` cloze parked under a plain comment", () => {
    const text = "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250-->";
    const [card] = parseCards(text);
    if (card === undefined) throw new Error("no card");
    // Parked the way the session parks it, then read by both.
    const parked = setSuspended(text, card, true);
    const counted = { due: 0, fresh: 0, parked: 1 };

    expect(decksFrom(one("n.md", parked), TODAY)).toMatchObject([counted]);
    expect(sat(parked)).toEqual(counted);
  });

  it("counts every number parked off one token, on the line or under the back", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} !suspended\n\n{{c1::c}} {{c2::d}}\n?\nextra\n" +
      "!suspended <!--SR:c1!2026-08-01,1,250-->\n";
    const counted = { due: 0, fresh: 0, parked: 4 };

    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
    expect(sat(text)).toEqual(counted);
  });

  it("counts a cloze line under a `?` back as part of that back", () => {
    const text = "#flashcards\n\nQ\n?\nA\n{{c1::x}} y\n";
    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(text)).toEqual({ due: 0, fresh: 1, parked: 0 });
  });

  it("counts a `::` line under a `?` back as part of that back", () => {
    const text = "#flashcards\n\nQ\n?\nA\na::b\n";
    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(text)).toEqual({ due: 0, fresh: 1, parked: 0 });
  });

  it("counts no cloze inside a fence, and none in a note nobody tagged", () => {
    const fenced = "#flashcards\n\na::b\n\n```\n{{c1::a}} {{c2::b}}\n```\n";
    expect(decksFrom(one("f.md", fenced), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(fenced)).toEqual({ due: 0, fresh: 1, parked: 0 });

    const untagged = "prose\n\n{{c1::a}} {{c2::b}}\n";
    expect(decksFrom(one("u.md", untagged), TODAY)).toEqual([]);
    expect(sat(untagged)).toEqual({ due: 0, fresh: 0, parked: 0 });
    // Still two cards, only in no deck: the sitting drops them as the overview does.
    expect(parseCards(untagged)).toHaveLength(2);
  });
});

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
});
