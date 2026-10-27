import { decksFrom } from "@/lib/review/review";
import { note, TODAY } from "./review-fixture";

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
