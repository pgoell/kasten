import { decksFrom } from "@/lib/review";
import { note, TODAY } from "./review-fixture";

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
