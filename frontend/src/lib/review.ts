/**
 * Turning the lines `GET /api/cards` found into the decks the overview shows.
 *
 * The scan is deliberately loose, matching every `::` in the vault, so this is
 * where a note becomes a deck: a note carrying a `#flashcards` tag holds cards
 * and a note carrying none holds none, whatever a C++ snippet in it looks like.
 * That rule is the reason the endpoint can afford a pattern that matches
 * anything, and the reason a deck is a tag rather than a folder.
 *
 * Counting from lines rather than from parsed cards is the second half of the
 * same bargain. Every card matches exactly once, on its `::` or on its `?`, and
 * every schedule matches exactly once on its comment, so the overview costs one
 * pass over the answer instead of reading every note in the vault. The session
 * fetches the note it is about to ask and parses it properly.
 */

import type { SearchHit } from "@/lib/api";
import { noteName } from "@/lib/note-path";

/** One deck as the overview draws it. */
export interface Deck {
  /** What it is called: the tag's subpath, or the note's name where the tag is bare. */
  name: string;
  /** The note holding it, which is what the session opens. */
  note: string;
  /** Cards due today or overdue. */
  due: number;
  /** Cards nothing has answered yet. */
  fresh: number;
  /**
   * Whether the note is itself the card, rather than a note holding cards.
   *
   * `#review` on a note says "ask me this note again in a while", which is the
   * same schedule over a different thing: no front, no back, and the three
   * numbers in the frontmatter instead of in a comment. One flag rather than a
   * second Deck type, because everything the overview does with a deck is the
   * same either way and only the session reads this.
   */
  whole: boolean;
}

/** The tag marking a whole note as the thing to be reviewed. */
const REVIEW_TAG = /#review(?![\w/-])/;

/** The note's own due date, off the frontmatter field. */
const NOTE_DUE = /^sr-due:\s*(\d{4}-\d{2}-\d{2})/;

/** `#flashcards`, and the deck name where the tag carries one. */
const DECK_TAG = /#flashcards(?:\/([^\s#]+))?/;

/** The date out of a schedule comment, wherever on the line it sits. */
const SCHEDULED = /<!--SR:!(\d{4}-\d{2}-\d{2}),/;

/** Whether this line is a card, which is the `::` or the `?` and never the comment. */
function isCard(text: string): boolean {
  return text.includes("::") || text.trim() === "?";
}

/** Every deck the scan's hits describe, sorted by name. */
export function decksFrom(hits: SearchHit[], today: string): Deck[] {
  const byNote = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const held = byNote.get(hit.path);
    if (held === undefined) byNote.set(hit.path, [hit]);
    else held.push(hit);
  }

  const decks: Deck[] = [];
  for (const [note, lines] of byNote) {
    const tag = lines.map((line) => DECK_TAG.exec(line.text)).find((found) => found !== null);

    // A note carrying both tags is read as a deck of cards. The cards are the
    // more specific claim: `#review` says ask me this note, and a note that
    // says which parts of itself to ask has already answered that.
    if (tag === undefined || tag === null) {
      if (!lines.some((line) => REVIEW_TAG.test(line.text))) continue;
      const due = lines.map((line) => NOTE_DUE.exec(line.text)?.[1]).find((at) => at !== undefined);
      decks.push({
        name: noteName(note),
        note,
        due: due !== undefined && due <= today ? 1 : 0,
        fresh: due === undefined ? 1 : 0,
        whole: true,
      });
      continue;
    }

    const scheduled = lines
      .map((line) => SCHEDULED.exec(line.text)?.[1])
      .filter((due) => due !== undefined);

    decks.push({
      name: tag[1] ?? noteName(note),
      note,
      due: scheduled.filter((due) => due <= today).length,
      // A card is new when nothing scheduled it, and the two counts come off
      // different lines for a card written over several, so this is a
      // subtraction rather than a second filter.
      fresh: lines.filter((line) => isCard(line.text)).length - scheduled.length,
      whole: false,
    });
  }

  return decks.sort((one, two) => one.name.localeCompare(two.name));
}
