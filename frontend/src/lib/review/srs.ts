/**
 * A card is text in a note, in obsidian-spaced-repetition's format, so the plugin
 * reads the same vault. A card in no deck is no card, so a stray `::` fills no queue.
 */

import {
  CLOZE_SR,
  clozeAnswer,
  clozeComment,
  clozeNumbers,
  clozeQuestion,
  clozeTarget,
  type Divided,
  divide,
  holdsCloze,
  parks,
  SR,
  suspended,
  withoutAnkiId,
} from "@/lib/review/card-line";
import { side, typedTarget } from "@/lib/review/card-text";
import { commentsAndCode } from "@/lib/review/deck-parse";
import { cardTags, deckName, deckTags, onlyTags, withoutTags } from "@/lib/review/deck-tag";

/** How well a card went, in the four steps Anki asks for. */
export type Rating = "again" | "hard" | "good" | "easy";

/** When a card comes back, and the two numbers that decide the time after that. */
export interface Schedule {
  /** `YYYY-MM-DD`. The card is due when this is today or earlier. */
  due: string;
  /** Days between this answer and the next asking. */
  interval: number;
  /**
   * How fast the interval grows, as a percent: 250 is the starting 2.5.
   * A percent, not a float, because `270` reads back the same on disk and `2.7000000000000002` does not.
   */
  ease: number;
}

/** Why a card is out of the queue, or null. Only `suspended` has a token to remove. */
export type Parked = "suspended" | "unanswered";

/** One card, and where in the note it is written. */
export interface Card {
  /** First line of the card, zero-based. */
  from: number;
  /** Last line of it, inclusive, counting the schedule comment where it has one. */
  to: number;
  front: string;
  back: string;
  /** Whether it is written on one line with `::`, rather than over several with `?`. */
  inline: boolean;
  /**
   * The decks it is asked in: the note's, and any named at its own head. Empty
   * means no deck, and the sitting drops the card as the overview does.
   */
  decks: string[];
  /** Null until the card has been answered once. */
  held: Schedule | null;
  /**
   * Why the sitting will not ask it, or null. A parked card stays in the array,
   * as the queue counts cards by ordinal (`review-queue.ts`).
   */
  parked: Parked | null;
  /**
   * The number a cloze card asks, or null where the card is no cloze.
   * One line holds a card per number, so this tells a rating which of the line's comments is its own.
   */
  cloze: number | null;
  /**
   * What a typed answer is compared against, where that is not the back.
   * A cloze's back is the whole line, and the typed answer is the hidden text alone.
   */
  target: string | null;
}

/** A heading, which is a hash and a space and not any hash at all. */
const HEADING = /^#{1,6}[ \t]/;

/** A line that ends whatever card was being read: blank, a heading, tags or the token. */
function breaks(line: string | undefined): boolean {
  if (line === undefined || line.trim() === "") return true;
  // The token ends the back, as the schedule does. Without this the `?` form
  // asks `!suspended` as the last line of what it shows.
  if (parks(line)) return true;
  // A heading, not any hash: `#flashcards/dbt What is a macro?` opens a card.
  // A line of nothing but tags is the note's and still breaks.
  return HEADING.test(line.trimStart()) || onlyTags(line);
}

/**
 * The three numbers one `<!--SR:!…-->` holds, or null where there is none.
 * `comment` is a cloze number's own, `clozeComment`, where the card is one.
 */
export function readSchedule(text: string, comment = SR): Schedule | null {
  const found = comment.exec(text);
  if (found === null) return null;
  // The defaults are unreachable: a match means all three groups are there.
  const [, due = "", interval = "1", ease = "250"] = found;
  return { due, interval: Number(interval), ease: Number(ease) };
}

/**
 * One card per number the cloze `line` holds, in ascending order. The order
 * keeps the ordinals the same on every read.
 */
function clozeCards(
  line: string,
  extra: string,
  schedule: string,
  card: Pick<Card, "from" | "to" | "inline" | "parked">,
): Card[] {
  // The card's own tags are no part of the question, here as on any card.
  const text = withoutTags(line);
  return clozeNumbers(line).map((cloze) => {
    const answer = side(clozeAnswer(text, cloze));
    return {
      ...card,
      front: side(clozeQuestion(text, cloze)),
      back: extra === "" ? answer : `${answer}\n\n${extra}`,
      decks: [],
      held: readSchedule(schedule, clozeComment(cloze)),
      cloze,
      target: typedTarget(clozeTarget(text, cloze)),
    };
  });
}

/**
 * The halves of `line` where it reads as a one-line card, or null. The `::`
 * check runs first: the front walk asks this of every line, and big notes must stay quick.
 */
function oneLine(line: string): Divided | null {
  if (!line.includes("::")) return null;
  const halves = divide(line);
  if (halves === null || withoutTags(halves.front).trim() === "") return null;
  return halves;
}

/** What both walks of `parseCards` read and fill. */
interface Walk {
  lines: string[];
  code: boolean[];
  /** Lines a card above already took. */
  taken: boolean[];
  cards: Card[];
  /** The decks each card names at its own head, in the order they are pushed. */
  owned: string[][];
  /** Lines whose tags a card took, which are therefore not the note's. */
  claimed: Set<number>;
  ends: (at: number) => boolean | undefined;
  schedules: (at: number) => boolean;
  inline: (at: number) => boolean;
}

/**
 * Every card the note holds, in the order written. Two passes: the `?` cards
 * first, so a back reading `a::b` is not read a second time as a card.
 */
export function parseCards(text: string, note = ""): Card[] {
  const lines = text.split("\n");
  const { uncommented, code, unclosed } = commentsAndCode(text);
  const walk: Walk = {
    lines,
    code,
    taken: lines.map(() => false),
    cards: [],
    owned: [],
    claimed: new Set<number>(),
    // The plugin reads a fence whole, so a blank line, heading or tag in code ends no card (#675).
    // Not in an unclosed fence: there the card above would read a hidden schedule (#680).
    ends: (at) => (!code[at] || unclosed[at]) && breaks(lines[at]),
    // A schedule ends a card in code too, so neither walk crosses it.
    schedules: (at) => SR.test(lines[at] ?? "") || CLOZE_SR.test(lines[at] ?? ""),
    inline: (at) => !code[at] && oneLine(lines[at] ?? "") !== null,
  };
  const { cards, owned, claimed } = walk;

  for (const [at, line] of lines.entries()) {
    // A `?` a card above already took is that card's back. The plugin splits at
    // blank lines and the first `?`, so a second card would share its schedule (#678).
    if (!code[at] && !walk.taken[at] && line.trim() === "?") questionCard(walk, at);
  }

  for (const [at, line] of lines.entries()) {
    if (!code[at] && !walk.taken[at]) lineCard(walk, at, line);
  }

  // Tags no card claimed are the note's. The two add, so a card about two things is asked in both decks.
  const noteDecks = uncommented
    .split("\n")
    .flatMap((line, at) => (code[at] || claimed.has(at) ? [] : deckTags(line)));
  for (const [at, card] of cards.entries()) {
    card.decks = [
      ...new Set([...noteDecks, ...(owned[at] ?? [])].map((tag) => deckName(tag, note))),
    ];
  }

  return cards.sort((one, two) => one.from - two.from);
}

/** Push `card` with the tags written at its head, `owned` being read by the cards' index. */
function push(walk: Walk, card: Card, own: string[]): void {
  walk.owned.push(own);
  walk.cards.push(card);
}

/**
 * The first line of the front over the `?` at `at`. The front runs back to a blank line
 * or heading, outside code. A line with a mark or a one-line card ends it too,
 * as each is a card of its own (#683).
 */
function frontOf(walk: Walk, at: number, cloze: boolean): number {
  if (cloze) return at - 1;
  const { lines, ends, schedules, inline } = walk;
  let from = at;
  while (
    !ends(from - 1) &&
    !holdsCloze(lines[from - 1]) &&
    !schedules(from - 1) &&
    !inline(from - 1)
  )
    from--;
  return from;
}

/** The back under the `?` at `at`, to the last line its card spans, or null where there is none. */
function backOf(
  walk: Walk,
  at: number,
  cloze: boolean,
): { to: number; back: string; schedule: Schedule | null; held: boolean } | null {
  const { lines, ends, schedules } = walk;
  // The token ends the back in code too, so an unclosed fence's token still parks the card.
  let to = at;
  while (!ends(to + 1) && !schedules(to + 1) && !parks(lines[to + 1])) to++;
  // A `?` with nothing under it is no card, unless a cloze's: review.ts cannot tell
  // a blank back from plain text, so both readers take the `?` as the cloze's.
  if (to === at && !cloze) return null;

  // The import's id sits on the back's last line, and is no part of the answer.
  const back = withoutAnkiId(lines.slice(at + 1, to + 1).join("\n")).trim();
  // The line under the back holds the schedule or token, so the span takes it for `setSuspended`.
  // Only a cloze's comments do the same for a cloze: a plain card would splice its own under them.
  const under = lines[to + 1] ?? "";
  const schedule = readSchedule(under);
  const held = parks(under);
  if (schedule !== null || held || (cloze && CLOZE_SR.test(under))) to++;
  return { to, back, schedule, held };
}

/** Take the lines `from` to `to` for the card of the `?` at `at`, and hand back the tags it owns. */
function claim(walk: Walk, from: number, to: number, at: number): string[] {
  // Own tags count only on the line directly above the `?`. Over a longer front, review.ts
  // cannot tell tags from prose, so both readers hand them to the note.
  const own = (from === at - 1 ? cardTags(walk.lines[from] ?? "") : null) ?? [];
  if (own.length > 0) walk.claimed.add(from);
  for (let mark = from; mark <= to; mark++) walk.taken[mark] = true;
  return own;
}

/** The card, or cloze cards, of the `?` at `at`, if it is one. */
function questionCard(walk: Walk, at: number): void {
  const { lines, ends } = walk;
  const cloze = !ends(at - 1) && holdsCloze(lines[at - 1]);
  const from = frontOf(walk, at, cloze);
  // A `?` with nothing over it is prose.
  if (from === at) return;

  const found = backOf(walk, at, cloze);
  if (found === null) return;
  const { to, back, schedule, held } = found;

  const own = claim(walk, from, to, at);

  if (cloze) {
    const asked = clozeCards(lines[from] ?? "", back, lines[to] ?? "", {
      from,
      to,
      inline: false,
      parked: held ? "suspended" : null,
    });
    for (const card of asked) push(walk, card, own);
    return;
  }

  push(
    walk,
    {
      from,
      to,
      // Own tags are format, not question, so they come off the front.
      front: side(withoutTags(lines.slice(from, at).join("\n")).trim()),
      back: side(back),
      inline: false,
      decks: [],
      held: schedule,
      parked: held ? "suspended" : null,
      cloze: null,
      target: null,
    },
    own,
  );
}

/** The card, or cloze cards, written on the one line at `at`, if it holds any. */
function lineCard(walk: Walk, at: number, line: string): void {
  // A cloze's `::` divides nothing, so this runs before the divider.
  if (holdsCloze(line)) {
    const own = cardTags(line) ?? [];
    if (own.length > 0) walk.claimed.add(at);
    const parked = suspended(line) ? "suspended" : null;
    for (const card of clozeCards(line, "", line, { from: at, to: at, inline: true, parked })) {
      push(walk, card, own);
    }
    return;
  }

  const halves = oneLine(line);
  if (halves === null) return;

  const own = cardTags(line) ?? [];
  if (own.length > 0) walk.claimed.add(at);
  push(
    walk,
    {
      from: at,
      to: at,
      front: side(withoutTags(halves.front).trim()),
      back: side(halves.back),
      inline: true,
      decks: [],
      held: readSchedule(line),
      // The token first: a parked card with no answer yet has both shapes.
      parked: suspended(line) ? "suspended" : halves.back === "" ? "unanswered" : null,
      cloze: null,
      target: null,
    },
    own,
  );
}
