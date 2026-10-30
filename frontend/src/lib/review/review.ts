/**
 * Turns the scan's notes into the overview's decks. The scan is loose and a deck
 * is a tag, not a folder; `parseCards` is shared with the sitting so they agree.
 */

import type { ReviewLimits, SearchHit } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { type Divided, divide, parks, suspended } from "@/lib/review/card-line";
import { deckPath, withoutTags } from "@/lib/review/deck-tag";
import { type Card, parseCards } from "@/lib/review/srs";
import {
  answeredToday,
  learning,
  readNoteSchedule,
  readNoteSuspended,
} from "@/lib/review/srs-schedule";

/** One deck as the overview draws it. */
export interface Deck {
  /** What it is called: the tag's subpath, or the note's name where the tag is bare. */
  name: string;
  /** The notes holding its cards, which is what the session opens. */
  notes: string[];
  /** Cards due today or overdue. */
  due: number;
  /** Cards nothing has answered yet. */
  fresh: number;
  /**
   * Cards the sitting will not ask: parked by a token, or by having no answer.
   * Counted, not left out, so a deck of parked cards never shows a bare `0 new`.
   */
  parked: number;
  /**
   * The note is itself the card, asked again on its own schedule.
   * Never merges with another deck: two notes of one name are two things to re-read.
   */
  whole: boolean;
  /**
   * The earliest day after today a card of this deck comes back, null for none.
   * Only scheduled cards set it: a due card is in `due`, a parked one has no day.
   */
  next: string | null;
}

/** One note the overview counts: where it is and everything in it. */
export interface DeckNote {
  path: string;
  text: string;
  /** Cards parsed from `text` already, so it is not parsed twice (#1354). */
  cards?: Card[];
}

/**
 * The raw `decks.md` text, as `useReviewLimits` hands it over, read here beside the counts it caps.
 */
export interface Limits {
  /** `decks.md`, or null where it is missing or could not be read. */
  note: string | null;
  /** What a deck falls back on where neither it nor a deck above it sets a limit. */
  defaults: ReviewLimits;
}

/** What one line of `decks.md` sets, each half left out where the line does not name it. */
interface DeckLimit {
  fresh?: number;
  due?: number;
}

/** `trivia/geography: 20 new, 200 reviews`, with an optional `- ` in front. */
const LIMIT_LINE = /^(?:-\s+)?([^:]+):(.+)$/;

/** One half of the line's value, `20 new` or `200 reviews`. */
const LIMIT_HALF = /^(\d+)\s+(new|reviews?)$/;

/**
 * Each deck's limits as `decks.md` writes them, keyed by the name the overview shows.
 * A line that does not parse is skipped alone, so one typo costs that line, not the sitting.
 */
function limitsIn(note: string): Map<string, DeckLimit> {
  const decks = new Map<string, DeckLimit>();
  for (const line of note.split("\n")) {
    const [, name, value] = LIMIT_LINE.exec(line.trim()) ?? [];
    if (name === undefined || value === undefined) continue;
    const limit: DeckLimit = {};
    let read = true;
    for (const half of value.split(",")) {
      const [, count, kind] = LIMIT_HALF.exec(half.trim()) ?? [];
      if (count === undefined) read = false;
      else if (kind === "new") limit.fresh = Number(count);
      else limit.due = Number(count);
    }
    if (read) decks.set(name.trim(), limit);
  }
  return decks;
}

/**
 * The limit binding a sitting of `name`: its own line, else the nearest deck above, else the default.
 * Each half on its own, so a subdeck setting only new cards still takes its parent's reviews.
 */
function limitOf(
  name: string,
  decks: Map<string, DeckLimit>,
  defaults: ReviewLimits,
): { fresh: number | null; due: number | null } {
  const lines = deckPath(name)
    .reverse()
    .flatMap((deck) => decks.get(deck) ?? []);
  return {
    fresh: lines.find((line) => line.fresh !== undefined)?.fresh ?? defaults.new_per_day,
    due: lines.find((line) => line.due !== undefined)?.due ?? defaults.reviews_per_day,
  };
}

/** The tag marking a whole note as the thing to be reviewed. */
const REVIEW_TAG = /#review(?![\w/-])/;

/**
 * A hit that makes its note a deck, `NOTE_LINE` in `cards.py`.
 * Only these notes are read: a `::` alone marks nothing.
 */
const MARKS_DECK = /#flashcards|#review|^sr-due:|^sr-suspended:/;

/** The field parking a note that is itself the card, true for the word alone. */
const NOTE_PARKED = /^sr-suspended:\s*true\s*$/;

/**
 * The two halves of a card written on one line, or null where the line is none.
 * On top of `divide`: a line opening with the divider is prose, as `srs.ts` also reads it.
 */
function halvesOf(text: string): Divided | null {
  const halves = divide(text);
  if (halves === null || withoutTags(halves.front).trim() === "") return null;
  return halves;
}

/** The notes the scan marks as decks, in the order it found them. */
export function deckNotes(hits: SearchHit[]): string[] {
  const notes = new Set<string>();
  for (const { path, text } of hits) if (MARKS_DECK.test(text)) notes.add(path);
  return [...notes];
}

/** The earlier of two `YYYY-MM-DD` days, either may be null. ISO dates sort as text. */
function earlier(one: string | null, two: string | null): string | null {
  if (one === null) return two;
  if (two === null) return one;
  return one < two ? one : two;
}

/**
 * Every deck the notes hold, sorted by name. With `limits`, `due` and `fresh` are
 * what today's sitting offers. Only the limit of the deck sat binds, not its subdecks'.
 */
export function decksFrom(notes: DeckNote[], today: string, limits?: Limits): Deck[] {
  // Keyed by name, so one tag in three notes is one deck. Whole notes key by path and never merge.
  const decks = new Map<string, Deck>();
  /** Per deck, today's answers: reviews and new cards count against limits, learning cards do not. */
  const answered = new Map<string, { due: number; fresh: number; learning: number }>();
  const bump = (key: string, deck: Deck) => {
    const held = decks.get(key);
    if (held === undefined) {
      decks.set(key, deck);
      return;
    }
    held.due += deck.due;
    held.fresh += deck.fresh;
    held.parked += deck.parked;
    held.next = earlier(held.next, deck.next);
    for (const note of deck.notes) if (!held.notes.includes(note)) held.notes.push(note);
  };

  for (const { path: note, text, cards } of notes) {
    const name = noteName(note);
    // A card in no deck is no card, which the sitting drops the same way.
    const asked = (cards ?? parseCards(text, name)).filter((card) => card.decks.length > 0);

    // A note with both is read as cards: they are the more specific claim than `#review`.
    if (asked.length === 0) {
      if (!REVIEW_TAG.test(text)) continue;
      const due = readNoteSchedule(text)?.due;
      // Parked wins over any date, as a parked card's token does.
      const held = readNoteSuspended(text);
      bump(`note:${note}`, {
        name,
        notes: [note],
        due: !held && due !== undefined && due <= today ? 1 : 0,
        fresh: !held && due === undefined ? 1 : 0,
        parked: held ? 1 : 0,
        whole: true,
        next: !held && due !== undefined && due > today ? due : null,
      });
      continue;
    }

    for (const card of asked) {
      // A parked card is never asked, so it spends no limit.
      const done = card.parked === null ? answeredToday(card.held, today) : null;
      // Parent decks count the card too, as `inDeck` asks it; the Set counts it once each.
      for (const deck of new Set(card.decks.flatMap(deckPath))) {
        const tally = answered.get(deck) ?? { due: 0, fresh: 0, learning: 0 };
        if (done === "review") tally.due += 1;
        if (done === "new") tally.fresh += 1;
        // A learning card's new slot was spent on its first answer, so it spends no limit now.
        if (card.parked === null && learning(card.held)) tally.learning += 1;
        answered.set(deck, tally);
        bump(deck, {
          name: deck,
          notes: [note],
          // Parked is exclusive of the other counts.
          due: card.parked === null && card.held !== null && card.held.due <= today ? 1 : 0,
          fresh: card.parked === null && card.held === null ? 1 : 0,
          parked: card.parked !== null ? 1 : 0,
          whole: false,
          next:
            card.parked === null && card.held !== null && card.held.due > today
              ? card.held.due
              : null,
        });
      }
    }
  }

  if (limits !== undefined) {
    const set = limitsIn(limits.note ?? "");
    for (const [key, deck] of answered) {
      const held = decks.get(key);
      // Whole notes are keyed apart, and carry no limit.
      if (held === undefined) continue;
      const limit = limitOf(key, set, limits.defaults);
      if (limit.due !== null) {
        const reviews = held.due - deck.learning;
        held.due = deck.learning + Math.max(0, Math.min(reviews, limit.due - deck.due));
      }
      if (limit.fresh !== null) {
        held.fresh = Math.max(0, Math.min(held.fresh, limit.fresh - deck.fresh));
      }
    }
  }

  return [...decks.values()].sort((one, two) => one.name.localeCompare(two.name));
}

/**
 * The notes holding a parked line, in scan order, for the parked screen to read whole.
 * Loose on purpose: a `foo::` in a code fence costs one read and draws no row.
 */
export function parkedNotes(hits: SearchHit[]): string[] {
  const notes = new Set<string>();
  for (const { path, text } of hits) {
    const halves = halvesOf(text);
    if (suspended(text) || parks(text) || NOTE_PARKED.test(text) || halves?.back === "") {
      notes.add(path);
    }
  }
  return [...notes];
}
