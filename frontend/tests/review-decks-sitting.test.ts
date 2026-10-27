import { noteName } from "@/lib/note-path";
import { inDeck } from "@/lib/review/deck-tag";
import { type Deck, type DeckNote, decksFrom, parkedNotes } from "@/lib/review/review";
import { parseCards } from "@/lib/review/srs";
import { readNoteSchedule, readNoteSuspended } from "@/lib/review/srs-schedule";
import { hits, one, TODAY } from "./review-fixture";

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
