import type { SearchHit } from "@/lib/api";
import { decksFrom } from "@/lib/review";

const TODAY = "2026-08-13";

function hits(path: string, lines: string[]): SearchHit[] {
  return lines.map((text, at) => ({ path, line: at + 1, text }));
}

describe("decksFrom", () => {
  it("names a deck after the tag's subpath", () => {
    const decks = decksFrom(hits("decks/aws.md", ["#flashcards/aws", "a::b"]), TODAY);
    expect(decks).toHaveLength(1);
    expect(decks[0]?.name).toBe("aws");
    expect(decks[0]?.notes).toEqual(["decks/aws.md"]);
  });

  it("names a deck after its note where the tag is bare", () => {
    const decks = decksFrom(hits("decks/Terraform drills.md", ["#flashcards", "a::b"]), TODAY);
    expect(decks[0]?.name).toBe("Terraform drills");
  });

  it("counts a card nothing has scheduled as new", () => {
    const [deck] = decksFrom(hits("d.md", ["#flashcards", "a::b", "c::d"]), TODAY);
    expect(deck).toMatchObject({ fresh: 2, due: 0 });
  });

  it("counts a card scheduled for today or earlier as due", () => {
    const [deck] = decksFrom(
      hits("d.md", [
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
      hits("d.md", ["#flashcards", "?", "<!--SR:!2026-08-01,4,250-->", "?"]),
      TODAY,
    );
    expect(deck).toMatchObject({ due: 1, fresh: 1 });
  });

  it("leaves a note carrying no tag out, whatever it holds", () => {
    expect(decksFrom(hits("code.md", ["std::vector", "a::b", "?"]), TODAY)).toEqual([]);
  });

  it("keeps two decks apart", () => {
    const decks = decksFrom(
      [...hits("a.md", ["#flashcards/aws", "a::b"]), ...hits("t.md", ["#flashcards/tf", "c::d"])],
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["aws", "tf"]);
  });

  it("makes one deck of one tag written in two notes", () => {
    const decks = decksFrom(
      [...hits("a.md", ["#flashcards/db", "a::b"]), ...hits("b.md", ["#flashcards/db", "c::d"])],
      TODAY,
    );

    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ name: "db", notes: ["a.md", "b.md"], fresh: 2 });
  });

  it("adds the deck a card names at its own head to the note's", () => {
    const decks = decksFrom(
      hits("procs.md", ["#flashcards/db", "a::b", "#flashcards/dbt How does it relate?::so"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db", "dbt"]);
    // The tagged card is asked in both, the other in the note's deck alone.
    expect(decks[0]).toMatchObject({ fresh: 2 });
    expect(decks[1]).toMatchObject({ fresh: 1, notes: ["procs.md"] });
  });

  it("takes a card's own tag on the front of one written over several lines", () => {
    const decks = decksFrom(hits("procs.md", ["#flashcards/dbt A question", "?"]), TODAY);

    expect(decks.map((deck) => deck.name)).toEqual(["dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });

  it("makes a card of a tagged line in a note carrying no tag at all", () => {
    const decks = decksFrom(hits("prose.md", ["std::vector", "#flashcards/dbt a::b"]), TODAY);

    expect(decks.map((deck) => deck.name)).toEqual(["dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });

  it("reads a tag heading prose as the note's, not a card's", () => {
    // The line `srs.ts` and this file could most easily disagree on. Both read
    // head tags as a card's only where the card is on that line or the next.
    const decks = decksFrom(
      hits("procs.md", ["#flashcards/db is the deck here.", "a::b", "c::d"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db"]);
    expect(decks[0]).toMatchObject({ fresh: 2 });
  });

  it("keeps a card's own tag off the card under it", () => {
    const decks = decksFrom(
      hits("procs.md", ["#flashcards/db", "#flashcards/dbt a::b", "c::d"]),
      TODAY,
    );

    expect(decks.map((deck) => deck.name)).toEqual(["db", "dbt"]);
    expect(decks[0]).toMatchObject({ fresh: 2 });
    expect(decks[1]).toMatchObject({ fresh: 1 });
  });

  it("sorts the decks by name", () => {
    const decks = decksFrom(
      [
        ...hits("z.md", ["#flashcards/zeta", "a::b"]),
        ...hits("a.md", ["#flashcards/alpha", "c::d"]),
      ],
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("decksFrom on a note marked for review", () => {
  it("makes the note a deck of its own", () => {
    const [deck] = decksFrom(hits("notes/tls.md", ["#review"]), TODAY);
    expect(deck).toMatchObject({ name: "tls", notes: ["notes/tls.md"], due: 0, fresh: 1 });
  });

  it("counts it due when its date is today or past", () => {
    const [deck] = decksFrom(hits("notes/tls.md", ["sr-due: 2026-08-01", "#review"]), TODAY);
    expect(deck).toMatchObject({ due: 1, fresh: 0 });
  });

  it("counts it neither due nor new when its date is ahead", () => {
    const [deck] = decksFrom(hits("notes/tls.md", ["sr-due: 2026-09-01", "#review"]), TODAY);
    expect(deck).toMatchObject({ due: 0, fresh: 0 });
  });

  it("keeps a note holding cards as a deck of cards", () => {
    const [deck] = decksFrom(hits("d.md", ["#flashcards/aws", "a::b"]), TODAY);
    expect(deck).toMatchObject({ name: "aws", fresh: 1 });
  });
});

describe("decksFrom on a nested deck tag", () => {
  it("counts the card in the deck named and in every deck above it", () => {
    const decks = decksFrom(hits("d.md", ["#flashcards/databases/postgres", "a::b"]), TODAY);
    expect(decks.map((deck) => deck.name)).toEqual(["databases", "databases/postgres"]);
    expect(decks[0]).toMatchObject({ fresh: 1, notes: ["d.md"] });
    expect(decks[1]).toMatchObject({ fresh: 1, notes: ["d.md"] });
  });

  it("gathers two children under the one parent", () => {
    const decks = decksFrom(
      [
        ...hits("p.md", ["#flashcards/databases/postgres", "a::b"]),
        ...hits("s.md", ["#flashcards/databases/sqlite", "c::d", "e::f"]),
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
      hits("d.md", ["#flashcards/databases", "#flashcards/databases/postgres a::b"]),
      TODAY,
    );
    expect(decks.map((deck) => deck.name)).toEqual(["databases", "databases/postgres"]);
    expect(decks[0]).toMatchObject({ fresh: 1 });
  });
});
