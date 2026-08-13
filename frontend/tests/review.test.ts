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
    expect(decks[0]?.note).toBe("decks/aws.md");
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
    expect(deck).toMatchObject({ name: "tls", note: "notes/tls.md", due: 0, fresh: 1 });
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
