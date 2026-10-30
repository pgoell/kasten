import { noteBody } from "@/lib/note-frontmatter";
import { noteName } from "@/lib/note-path";
import { inDeck } from "@/lib/review/deck-tag";
import { type Deck, decksFrom, type Limits } from "@/lib/review/review";
import { type Card, parseCards } from "@/lib/review/srs";
import { learning, readNoteSchedule, readNoteSuspended } from "@/lib/review/srs-schedule";

/** One card in the sitting: which note holds it, and which of that note's cards. */
export interface Seat {
  note: string;
  /** Its ordinal among the cards of that note, counting the ones other decks ask. */
  at: number;
  /**
   * No schedule when the sitting began, so the first answer is still to come.
   * Kept in memory, since the vault stores only the three numbers obsidian-spaced-repetition reads.
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
  // Due first, then unanswered, each in its note's order. Notes sort by path so
  // a split deck's queue holds across reloads. Nothing is shuffled.
  const parsed = cardsOf(deck, texts);
  const seats = [...parsed]
    .sort(([one], [two]) => (one < two ? -1 : one > two ? 1 : 0))
    .flatMap(([note, cards]) => cards.map((card, at) => ({ note, at, card })));
  // Parked cards stay in the array: the queue addresses a card by its ordinal,
  // so removing one would renumber the cards behind it.
  const asked = seats.filter(({ card }) => card.parked === null);
  // Learning cards first, since the row counts them outside the limit and the
  // slice below must not cut them.
  const due = asked
    .filter(({ card }) => isDue(card, today))
    .sort((one, two) => Number(learning(two.card.held)) - Number(learning(one.card.held)));
  const fresh = asked.filter(({ card }) => card.held === null);
  // The overview's row, from the same notes and limits, so the sitting asks what
  // the row promised. A whole note has no row and no limit.
  const row = deck.whole
    ? undefined
    : // The cards filed to this deck, which is how the row counts them.
      decksFrom(
        [...texts].map(([path, text]) => ({ path, text, cards: parsed.get(path) })),
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
 * What this deck asks out of each note: its cards, or the note itself as one card.
 * Cards are filtered to this deck, since one note can hold cards for several decks.
 */
export function cardsOf(deck: Deck, texts: Map<string, string>): Map<string, Card[]> {
  const held = read.get(texts);
  if (held?.deck === deck) return held.cards;
  const cards = cardsRead(deck, texts);
  read.set(texts, { deck, cards });
  return cards;
}

/**
 * Last read per texts map, so the queue and the drawn card share one parse of a
 * 1 MB deck (#1354). Every write makes a new map, so a held read is never stale.
 */
const read = new WeakMap<Map<string, string>, { deck: Deck; cards: Map<string, Card[]> }>();

function cardsRead(deck: Deck, texts: Map<string, string>): Map<string, Card[]> {
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
