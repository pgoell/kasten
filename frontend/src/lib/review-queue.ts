import { inDeck } from "@/lib/deck-tag";
import { noteBody } from "@/lib/note-frontmatter";
import { noteName } from "@/lib/note-path";
import { type Deck, decksFrom, type Limits } from "@/lib/review";
import { type Card, parseCards } from "@/lib/srs";
import { learning, readNoteSchedule, readNoteSuspended } from "@/lib/srs-schedule";

/** One card in the sitting: which note holds it, and which of that note's cards. */
export interface Seat {
  note: string;
  /** Its ordinal among the cards of that note, counting the ones other decks ask. */
  at: number;
  /**
   * Whether the card had no schedule when the sitting began, so its first answer
   * is still to come.
   *
   * The sitting's own memory: `again` and undo carry the same seat objects, so
   * the flag survives both. The vault cannot hold it, because
   * obsidian-spaced-repetition reads only the three numbers.
   */
  fresh?: boolean;
}

/** Whether the card is one today's sitting should ask. */
function isDue(card: Card, today: string): boolean {
  return card.held !== null && card.held.due <= today;
}

/**
 * The queue a sitting starts from, built off the notes it read.
 */
export function seatsFor(
  deck: Deck,
  texts: Map<string, string>,
  today: string,
  limits: Limits,
): Seat[] {
  // Due first, then the ones nobody has answered, each in its note's
  // order and the notes in the order the deck names them. Nothing is
  // shuffled: a deck written in an order was written in that order on
  // purpose, and an import arrives in the order Anki held.
  const seats = [...cardsOf(deck, texts)].flatMap(([note, cards]) =>
    cards.map((card, at) => ({ note, at, card })),
  );
  // A parked card keeps its seat and its ordinal and is never asked. It
  // has to keep them: the queue addresses a card by its ordinal, so a
  // card taken out of the array renumbers the ones behind it.
  const asked = seats.filter(({ card }) => card.parked === null);
  // A card in learning first, because the row counts it outside the limit and
  // the slice below must not cut it for a review the limit let in.
  const due = asked
    .filter(({ card }) => isDue(card, today))
    .sort((one, two) => Number(learning(two.card.held)) - Number(learning(one.card.held)));
  const fresh = asked.filter(({ card }) => card.held === null);
  // The deck's row as the overview counts it, off the same notes and the
  // same limits, so the sitting asks exactly what the row promised. A
  // whole note has no row here and no limit.
  const row = deck.whole
    ? undefined
    : decksFrom(
        [...texts].map(([path, text]) => ({ path, text })),
        today,
        limits,
      ).find((each) => !each.whole && each.name === deck.name);
  return [
    ...due.slice(0, row?.due ?? due.length).map(({ note, at }) => ({ note, at })),
    ...fresh
      .slice(0, row?.fresh ?? fresh.length)
      .map(({ note, at }) => ({ note, at, fresh: true })),
  ];
}

/**
 * What this deck asks out of each note, which is either its cards or itself.
 *
 * The one place the two kinds part company. A `#review` note becomes a single
 * card whose front is the note and whose back is nothing, so the queue, the
 * rating and the writing downstream are the same code for both, and only the
 * lines here know there was ever a difference.
 *
 * A note's cards are filtered to this deck's, because a note holding two decks
 * is the whole point of a card carrying a tag of its own: sitting `dbt` asks
 * the one card in the stored procedures note that says it is about dbt, and
 * none of the others.
 */
export function cardsOf(deck: Deck, texts: Map<string, string>): Map<string, Card[]> {
  return new Map(
    [...texts].map(([note, text]) => {
      if (deck.whole) {
        const held = readNoteSchedule(text);
        const whole = {
          from: 0,
          to: 0,
          front: noteBody(text).trim(),
          back: "",
          inline: false,
          cloze: null,
          target: null,
        };
        return [
          note,
          [
            {
              ...whole,
              decks: [deck.name],
              held,
              parked: readNoteSuspended(text) ? "suspended" : null,
            },
          ],
        ];
      }
      // A deck below this one is part of it, so a sitting of `databases` asks
      // the cards filed under `databases/postgres` as well.
      const cards = parseCards(text, noteName(note)).filter((card) =>
        card.decks.some((filed) => inDeck(filed, deck.name)),
      );
      return [note, cards];
    }),
  );
}
