/**
 * Turning the lines `GET /api/cards` found into the decks the overview shows.
 *
 * The scan is deliberately loose, matching every `::` in the vault, so this is
 * where a note becomes a deck: a card carrying no `#flashcards` tag of its own
 * and sitting in a note carrying none is no card at all, whatever a C++ snippet
 * in it looks like. That rule is the reason the endpoint can afford a pattern
 * that matches anything, and the reason a deck is a tag rather than a folder.
 *
 * A deck is not a note. The same tag in three notes is one deck holding all
 * three, and one card carrying a tag of its own joins a deck the rest of its
 * note is not in. `deck-tag.ts` holds what a tag means; this file counts.
 *
 * Counting from lines rather than from parsed cards is the second half of the
 * same bargain. Every card matches exactly once, on its `::` or on its `?`, and
 * every schedule matches exactly once on its comment, so the overview costs one
 * pass over the answer instead of reading every note in the vault. The session
 * fetches the notes it is about to ask and parses them properly.
 */

import type { SearchHit } from "@/lib/api";
import { type Divided, divide, fences, parks, suspended } from "@/lib/card-line";
import { cardTags, deckName, deckPath, deckTags, withoutTags } from "@/lib/deck-tag";
import { noteName } from "@/lib/note-path";

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
}

/** The tag marking a whole note as the thing to be reviewed. */
const REVIEW_TAG = /#review(?![\w/-])/;

/** The note's own due date, off the frontmatter field. */
const NOTE_DUE = /^sr-due:\s*(\d{4}-\d{2}-\d{2})/;

/** The date out of a schedule comment, wherever on the line it sits. */
const SCHEDULED = /<!--SR:!(\d{4}-\d{2}-\d{2}),/;

/**
 * The two halves of a card written on one line, or null where the line is none.
 *
 * `divide` is the shared rule and this adds the one thing it leaves to its
 * callers: a line opening with the divider is prose, not a card missing its
 * question. `srs.ts:188` makes the same call on the same words, which is what
 * stops the overview counting a line the sitting will never ask.
 */
function halvesOf(text: string): Divided | null {
  const halves = divide(text);
  if (halves === null || withoutTags(halves.front).trim() === "") return null;
  return halves;
}

/** The `?` dividing a card written over several lines, whose front is above it. */
function divides(text: string): boolean {
  return text.trim() === "?";
}

/** One card as the lines describe it: the decks it is in, when it is due, and whether it is parked. */
interface Counted {
  tags: string[];
  due: string | null;
  parked: boolean;
}

/**
 * The cards one note's matched lines describe, and the decks the note itself is in.
 *
 * One pass, in the order rg reported them, reading three kinds of line. A card
 * is its `::` or its `?`. A comment on a line of its own is the schedule of the
 * card above it, which is where the plugin writes the one a `?` card carries.
 * Everything else is tags.
 *
 * Head tags count as a card's own on the line the card is written on, and on
 * the line above a `?`, which is that card's front. Anywhere else they are the
 * note's. That is what keeps the two readers of this format saying the same
 * thing: `srs.ts` sees the note whole and knows which line each card begins on,
 * this sees the matched lines alone, and a card begins either on its own line
 * or one line above its `?` in both. It costs a card whose front runs over two
 * lines the tags at its head, read as the note's there, so that card keeps the
 * deck and its neighbours gain one rather than anything going missing.
 */
function readNote(lines: SearchHit[]): { cards: Counted[]; tags: string[] } {
  const cards: Counted[] = [];
  const tags: string[] = [];
  // The scan hands the fence markers over for this, and only for this: they
  // hold no `::`, no `?` and no tag, so the walk below would read every one of
  // them as a line of prose and count the `std::vector` between them as a card.
  const fenced = fences(lines.map((hit) => hit.text));

  for (const [at, { line, text }] of lines.entries()) {
    if (fenced[at]) continue;
    const own = cardTags(text);
    const halves = halvesOf(text);

    if (halves !== null || divides(text)) {
      const above = lines[at - 1];
      const opened =
        divides(text) && above !== undefined && above.line === line - 1
          ? cardTags(above.text)
          : null;
      cards.push({
        tags: own ?? opened ?? [],
        due: SCHEDULED.exec(text)?.[1] ?? null,
        // The token, or a question with no answer under it, which is parked by
        // its shape alone. A `?` card carries neither here: its token sits on
        // the line under its back and is read below.
        parked: suspended(text) || halves?.back === "",
      });
      continue;
    }

    // The line under a `?` card's back, carrying its schedule, its token, or
    // both. Either belongs to the card above, which is where the format puts
    // them and the one place this reader has to look back a line.
    const scheduled = SCHEDULED.exec(text)?.[1];
    const parked = parks(text);
    if (scheduled !== undefined || parked) {
      const last = cards.at(-1);
      if (last !== undefined) {
        if (scheduled !== undefined && last.due === null) last.due = scheduled;
        if (parked) last.parked = true;
      }
      continue;
    }

    // The `?` directly under has taken these: this line is that card's front.
    // Nothing else can claim them, a card written on one line carrying its own
    // front, so anywhere else they are the note's.
    const under = lines[at + 1];
    if (own !== null && under !== undefined && under.line === line + 1 && divides(under.text)) {
      continue;
    }

    tags.push(...deckTags(text));
  }

  return { cards, tags };
}

/** Every deck the scan's hits describe, sorted by name. */
export function decksFrom(hits: SearchHit[], today: string): Deck[] {
  const byNote = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const held = byNote.get(hit.path);
    if (held === undefined) byNote.set(hit.path, [hit]);
    else held.push(hit);
  }

  // Keyed by name, so one tag in three notes is one deck. A whole note is keyed
  // by its path instead: it is not a tag, and nothing should merge with it.
  const decks = new Map<string, Deck>();
  const bump = (key: string, deck: Deck) => {
    const held = decks.get(key);
    if (held === undefined) {
      decks.set(key, deck);
      return;
    }
    held.due += deck.due;
    held.fresh += deck.fresh;
    held.parked += deck.parked;
    for (const note of deck.notes) if (!held.notes.includes(note)) held.notes.push(note);
  };

  for (const [note, lines] of byNote) {
    const { cards, tags } = readNote(lines);
    const name = noteName(note);
    const asked = cards
      .map((card) => ({
        ...card,
        // The note's tags and the card's own, which add rather than replace: a
        // card about two things is asked in both decks.
        decks: [...new Set([...tags, ...card.tags])].map((tag) => deckName(tag, name)),
      }))
      .filter((card) => card.decks.length > 0);

    // A note carrying both is read as a deck of cards. The cards are the more
    // specific claim: `#review` says ask me this note, and a note that says
    // which parts of itself to ask has already answered that.
    if (asked.length === 0) {
      if (!lines.some((line) => REVIEW_TAG.test(line.text))) continue;
      const due = lines.map((line) => NOTE_DUE.exec(line.text)?.[1]).find((at) => at !== undefined);
      bump(`note:${note}`, {
        name,
        notes: [note],
        due: due !== undefined && due <= today ? 1 : 0,
        fresh: due === undefined ? 1 : 0,
        parked: 0,
        whole: true,
      });
      continue;
    }

    for (const card of asked) {
      // Every deck above the one named counts the card too, and the Set is what
      // keeps a card tagged `databases` and `databases/postgres` counted once
      // in the parent rather than twice.
      for (const deck of new Set(card.decks.flatMap(deckPath))) {
        bump(deck, {
          name: deck,
          notes: [note],
          // Parked first, and exclusive: a parked card is one the sitting will
          // not ask, whatever date it is carrying, so counting it due as well
          // would put the disagreement this file exists to close back in.
          due: !card.parked && card.due !== null && card.due <= today ? 1 : 0,
          fresh: !card.parked && card.due === null ? 1 : 0,
          parked: card.parked ? 1 : 0,
          whole: false,
        });
      }
    }
  }

  return [...decks.values()].sort((one, two) => one.name.localeCompare(two.name));
}
