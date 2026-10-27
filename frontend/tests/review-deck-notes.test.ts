import { deckNotes, parkedNotes } from "@/lib/review/review";
import { hits } from "./review-fixture";

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
