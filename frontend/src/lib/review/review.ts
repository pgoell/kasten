/**
 * Turning the notes `GET /api/cards` names into the decks the overview shows.
 *
 * The scan is deliberately loose, matching every `::` in the vault, so a note
 * becomes a deck here and not there: a card carrying no `#flashcards` tag of its
 * own and sitting in a note carrying none is no card at all, whatever a C++
 * snippet in it looks like. That rule is the reason the endpoint can afford a
 * pattern that matches anything, and the reason a deck is a tag rather than a
 * folder.
 *
 * A deck is not a note. The same tag in three notes is one deck holding all
 * three, and one card carrying a tag of its own joins a deck the rest of its
 * note is not in. `deck-tag.ts` holds what a tag means; this file counts.
 *
 * The counts come off `parseCards`, the parser the sitting asks from, over the
 * whole text of every note the scan marks as a deck. That costs one note read
 * per deck note where counting off the matched lines cost none, and it buys the
 * one thing the line reader could not keep: two readers of one format drift,
 * and every drift was a deck promising cards its sitting would not ask. With
 * one parser the overview and the sitting cannot disagree on what a card is.
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
   *
   * Counted rather than left out, because a deck of nothing but parked cards
   * draws a row that cannot be sat and a bare `0 new` would leave no way to
   * find out why. It is the number the parked screen lists.
   */
  parked: number;
  /**
   * Whether the note is itself the card, rather than a note holding cards.
   *
   * `#review` on a note says "ask me this note again in a while", which is the
   * same schedule over a different thing: no front, no back, and the three
   * numbers in the frontmatter instead of in a comment. One flag rather than a
   * second Deck type, because everything the overview does with a deck is the
   * same either way and only the session reads this.
   *
   * A deck of these never merges with another. Its name is its note's, and two
   * notes of one name in two folders are two things to be re-read rather than
   * one, where two notes carrying one tag are one deck by construction.
   */
  whole: boolean;
  /**
   * The earliest day after today a card of this deck comes back, null for none.
   *
   * Set by the scheduled cards alone: a card due today is already counted in
   * `due`, and a parked one comes back on no day the overview can name.
   */
  next: string | null;
}

/** One note the overview counts: where it is and everything in it. */
export interface DeckNote {
  path: string;
  text: string;
}

/**
 * What the daily limits are read from, as `useReviewLimits` hands them over.
 *
 * The raw text of the config note rather than what it says, so the one reading
 * of it is here beside the counts it caps.
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
 *
 * A line that does not read as one is skipped, whatever else it holds: the note
 * is a note, with frontmatter and perhaps a sentence about why, and a typo in
 * one line should cost that line and not the sitting.
 */
function limitsIn(note: string): Map<string, DeckLimit> {
  const decks = new Map<string, DeckLimit>();
  for (const line of note.split("\n")) {
    const [, name, value] = LIMIT_LINE.exec(line.trim()) ?? [];
    if (name === undefined || value === undefined) continue;
    const limit = limitIn(value);
    if (limit !== null) decks.set(name.trim(), limit);
  }
  return decks;
}

/** The limit a line's value sets, null where any half of it fails to read. */
function limitIn(value: string): DeckLimit | null {
  const limit: DeckLimit = {};
  for (const half of value.split(",")) {
    const [, count, kind] = LIMIT_HALF.exec(half.trim()) ?? [];
    if (count === undefined) return null;
    if (kind === "new") limit.fresh = Number(count);
    else limit.due = Number(count);
  }
  return limit;
}

/**
 * The limit binding a sitting of `name`, null for none.
 *
 * Its own line's, else the nearest deck above that sets one, else the default.
 * Each half on its own, so a subdeck that sets only new cards still takes its
 * parent's reviews.
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
 *
 * Only these notes are worth a read. A `::` alone marks nothing, a card in no
 * deck being no card, and a card tagged at its own head matches the first
 * branch on its own line.
 */
const MARKS_DECK = /#flashcards|#review|^sr-due:|^sr-suspended:/;

/** The field parking a note that is itself the card, true for the word alone. */
const NOTE_PARKED = /^sr-suspended:\s*true\s*$/;

/**
 * The two halves of a card written on one line, or null where the line is none.
 *
 * `divide` is the shared rule and this adds the one thing it leaves to its
 * callers: a line opening with the divider is prose, not a card missing its
 * question. `srs.ts` makes the same call on the same words, which is what keeps
 * a line of prose off the parked screen.
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

/** Answered today, per deck: reviews done, new cards introduced, and cards in learning. */
type Answered = { due: number; fresh: number; learning: number };

/** Adds `deck` into the row held under `key`, or holds it there. */
function merge(decks: Map<string, Deck>, key: string, deck: Deck): void {
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
}

/** The row of a note tagged `#review`, which is itself the card. */
function wholeNoteDeck(note: string, name: string, text: string, today: string): Deck {
  const due = readNoteSchedule(text)?.due;
  // The whole-note twin of the token on a card's line, and exclusive the same
  // way: a parked note is one the sitting will not ask, whatever date it carries.
  const held = readNoteSuspended(text);
  const waiting = !held && due !== undefined;
  return {
    name,
    notes: [note],
    due: waiting && due <= today ? 1 : 0,
    fresh: !held && due === undefined ? 1 : 0,
    parked: held ? 1 : 0,
    whole: true,
    next: waiting && due > today ? due : null,
  };
}

/** The row one card adds to `deck`. */
function cardDeck(deck: string, note: string, card: Card, today: string): Deck {
  // Parked first, and exclusive: a parked card is one the sitting will not ask,
  // whatever date it is carrying.
  const live = card.parked === null;
  const due = live && card.held !== null ? card.held.due : null;
  return {
    name: deck,
    notes: [note],
    due: due !== null && due <= today ? 1 : 0,
    fresh: live && card.held === null ? 1 : 0,
    parked: live ? 0 : 1,
    whole: false,
    next: due !== null && due > today ? due : null,
  };
}

/** Counts `card` into `deck`'s answers today. */
function tally(answered: Map<string, Answered>, deck: string, card: Card, today: string): void {
  const count = answered.get(deck) ?? { due: 0, fresh: 0, learning: 0 };
  answered.set(deck, count);
  // A parked card counts against no limit, the way it is asked in no sitting.
  if (card.parked !== null) return;
  const done = answeredToday(card.held, today);
  if (done === "review") count.due += 1;
  if (done === "new") count.fresh += 1;
  // Its new slot was spent on its first answer, so a second asking spends none,
  // of either limit.
  if (learning(card.held)) count.learning += 1;
}

/** Cuts each deck's `due` and `fresh` to what today's limits leave. */
function applyLimits(decks: Map<string, Deck>, answered: Map<string, Answered>, limits: Limits) {
  const set = limitsIn(limits.note ?? "");
  for (const [key, deck] of answered) {
    const held = decks.get(key);
    // A whole note is keyed apart and never here: it is one thing to re-read,
    // and a limit on it would be a limit of one.
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

/**
 * Every deck the notes hold, sorted by name.
 *
 * With `limits`, a deck's `due` and `fresh` are what today's sitting of it
 * offers, its daily limits less what was answered today. The sitting builds its
 * queue off this same row, which is what keeps the two from disagreeing. Only
 * the limit of the deck sat binds, over every card under it: a parent's sitting
 * ignores the limits its subdecks set, the way it asks their cards as its own.
 */
export function decksFrom(notes: DeckNote[], today: string, limits?: Limits): Deck[] {
  // Keyed by name, so one tag in three notes is one deck. A whole note is keyed
  // by its path instead: it is not a tag, and nothing should merge with it.
  const decks = new Map<string, Deck>();
  const answered = new Map<string, Answered>();

  for (const { path: note, text } of notes) {
    const name = noteName(note);
    // A card in no deck is a `::` in a note nobody tagged, which the sitting
    // drops the same way.
    const asked = parseCards(text, name).filter((card) => card.decks.length > 0);

    // A note carrying both is read as a deck of cards. The cards are the more
    // specific claim: `#review` says ask me this note, and a note that says
    // which parts of itself to ask has already answered that.
    if (asked.length === 0) {
      if (REVIEW_TAG.test(text))
        merge(decks, `note:${note}`, wholeNoteDeck(note, name, text, today));
      continue;
    }

    for (const card of asked) {
      // Every deck above the one named counts the card too, the way `inDeck`
      // asks it in a sitting of any of them, and the Set is what keeps a card
      // tagged `databases` and `databases/postgres` counted once in the parent.
      for (const deck of new Set(card.decks.flatMap(deckPath))) {
        tally(answered, deck, card, today);
        merge(decks, deck, cardDeck(deck, note, card, today));
      }
    }
  }

  if (limits !== undefined) applyLimits(decks, answered, limits);
  return [...decks.values()].sort((one, two) => one.name.localeCompare(two.name));
}

/**
 * The notes holding at least one parked line, in the order the scan found them.
 *
 * What the parked screen fetches. It reads the notes rather than the matched
 * lines because putting a card back means editing and writing the note, and
 * because the front of a card written over several lines is not among the lines
 * the scan matched.
 *
 * Deliberately loose, the way the scan's own pattern is. A `foo::` inside a
 * fenced code block names its note here, and `parseCards` then finds no parked
 * card in it and draws no row. The cost is one note read; teaching this the
 * fence rule would mean grouping the hits by note first, which is the work the
 * screen is about to do anyway.
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
