import { type DeckNote, decksFrom } from "@/lib/review/review";

const TODAY = "2026-10-24";

/** The deck of that name in what `decksFrom` made of the notes. */
function deckNamed(notes: DeckNote[], name: string) {
  const deck = decksFrom(notes, TODAY).find((row) => row.name === name);
  if (deck === undefined) throw new Error(`no deck named ${name}`);
  return deck;
}

describe("decksFrom next", () => {
  it("is the earliest day after today among a deck's cards, across its notes", () => {
    const notes = [
      { path: "a.md", text: "#flashcards/alpha\n\na::b <!--SR:!2026-11-05,4,250-->\n" },
      { path: "b.md", text: "#flashcards/alpha\n\nc::d <!--SR:!2026-10-30,4,250-->\n" },
    ];

    expect(deckNamed(notes, "alpha").next).toBe("2026-10-30");
  });

  it("ignores a parked card's date, and a card due today", () => {
    const notes = [
      {
        path: "a.md",
        text:
          "#flashcards/alpha\n\nc::d !suspended <!--SR:!2026-10-27,4,250-->\n" +
          "e::f <!--SR:!2026-10-24,4,250-->\n",
      },
      { path: "b.md", text: "#flashcards/beta\n\ng::h !suspended <!--SR:!2026-10-27,4,250-->\n" },
    ];

    expect(deckNamed(notes, "alpha").next).toBeNull();
    expect(deckNamed(notes, "beta").next).toBeNull();
  });

  it("is a whole note's sr-due when that is after today, and null when it is not", () => {
    const notes = [
      { path: "later.md", text: "---\nsr-due: 2026-11-05\n---\n# Later\n\n#review\n" },
      { path: "due.md", text: "---\nsr-due: 2026-10-20\n---\n# Due\n\n#review\n" },
    ];

    expect(deckNamed(notes, "later").next).toBe("2026-11-05");
    expect(deckNamed(notes, "due").next).toBeNull();
  });
});
