/**
 * Reading a flashcard out of a note. The date it comes back on lives in `srs-schedule.ts`.
 *
 * A card is text in a note and the note is the whole record, the way a todo is
 * a line and an exam is a note. Nothing about a card is held anywhere else, so
 * the schedule survives the database being dropped, and a vault opened in
 * Obsidian is a vault the spaced-repetition plugin already reads.
 *
 * ```markdown
 * #flashcards/aws
 *
 * What does S3 stand for?::Simple Storage Service <!--SR:!2026-08-20,4,270-->
 *
 * The three storage classes worth knowing
 * ?
 * Standard, Infrequent Access, Glacier
 * <!--SR:!2026-08-14,1,230-->
 * ```
 *
 * The format is obsidian-spaced-repetition's, borrowed whole for the reason the
 * todo line borrows obsidian-tasks: a format somebody else already reads costs
 * nothing to adopt and buys a second reader of the vault. The `!` in the
 * comment is theirs too, and is kept even though nothing here varies on it.
 *
 * A cloze is Anki's, `{{c1::text}}` and `{{c1::text::hint}}`, and is one card
 * per number. Its comments are kasten's own, `<!--SR:c1!…-->`, one per number
 * and named by it, so a line holds independent cards in any order; the plugin's
 * `<!--SR:!` matches none of them. A line holding a mark is a cloze before it is
 * anything else, the `::` inside the braces dividing nothing.
 *
 * ```markdown
 * The capital of {{c1::France}} is {{c2::Paris}}. <!--SR:c2!2026-08-15,1,250-->
 *
 * The capital of France is {{c1::Paris}}.
 * ?
 * On the Seine.
 * <!--SR:c1!2026-08-20,4,270-->
 * ```
 *
 * Which decks a card is in is read here, off `deck-tag.ts`'s rule, because this
 * is the reader that sees the note whole. A deck tag inside an HTML comment,
 * on one line or several, or inside a code block names no deck, and a code
 * block holds no card, the comments and code being found by the editor's
 * parser, as the editor shows no tag there. A `::` is a common enough thing to
 * type that reading every one of them as a card would fill the queue with C++
 * and YAML, so a card in no deck at all is not a card, to the overview and the
 * sitting alike.
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
   * How fast the interval grows, as a percent. 250 is the starting 2.5.
   *
   * A percent rather than a float because it goes to disk in a comment, and
   * `270` reads back the same everywhere while `2.7000000000000002` does not.
   */
  ease: number;
}

/**
 * Why a card is out of the queue, or null where it is not.
 *
 * Two shapes of the same state and worth telling apart, because only one of
 * them has a token to remove: `suspended` is a marker somebody wrote beside the
 * card, `unanswered` is a question with no answer under it yet and is parked by
 * its shape alone.
 */
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
   * The decks it is asked in: the note's, and any it names at its own head.
   *
   * Empty means the card is in no deck, which is a `::` in a note nobody tagged
   * and therefore not a card at all. The session drops those the way the
   * overview never counted them.
   */
  decks: string[];
  /** Null until the card has been answered once. */
  held: Schedule | null;
  /**
   * Why the sitting will not ask it, or null where it will.
   *
   * A parked card stays in this array rather than leaving it. The queue
   * addresses a card by its ordinal among its note's cards
   * (`review-queue.ts`), so dropping one here would renumber every card
   * behind it in a sitting already running.
   */
  parked: Parked | null;
  /**
   * The number a cloze card asks, or null where the card is no cloze.
   *
   * One line holds a card per number, all spanning the same lines, so this is
   * what tells a rating which of the line's comments is its own.
   */
  cloze: number | null;
  /**
   * What a typed answer is compared against, where that is not the back.
   *
   * A cloze's back is the whole line with its text highlighted, and the answer
   * somebody types is the hidden text alone.
   */
  target: string | null;
}

/** A heading, which is a hash and a space and not any hash at all. */
const HEADING = /^#{1,6}[ \t]/;

/** A line that ends whatever card was being read: blank, a heading, tags or the token. */
function breaks(line: string | undefined): boolean {
  if (line === undefined || line.trim() === "") return true;
  // The token ends the back for the same reason the schedule does: it is the
  // format around the card and not a line of the answer. Without this the `?`
  // form asks `!suspended` as the last line of what it is showing you.
  if (parks(line)) return true;
  // A heading and not every hash. `#flashcards/dbt What is a macro?` opens a
  // card, and reading its tag as a heading would leave that card no front to
  // be asked by; a line of nothing but tags is the note's and breaks as before.
  return HEADING.test(line.trimStart()) || onlyTags(line);
}

/**
 * The three numbers one `<!--SR:!…-->` holds, or null where there is none.
 *
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
 * One card per number the cloze `line` holds, in ascending order.
 *
 * Pushed in that order and sorted by line alone, so the ordinals the session
 * holds come out the same on every read. `extra` is a `?` cloze's back, shown
 * under the answer, and `schedule` the line its comments sit on.
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
 * The halves of `line` where it reads as a one-line card, or null.
 *
 * A line opening with the divider is prose, not a card missing its question.
 * A card missing its answer is the other way round and is kept. The `::` check
 * first, as the front walk asks this of every line above a `?` and the big
 * notes have to stay quick.
 */
function oneLine(line: string): Divided | null {
  if (!line.includes("::")) return null;
  const halves = divide(line);
  if (halves === null || withoutTags(halves.front).trim() === "") return null;
  return halves;
}

/** What both passes of `parseCards` share while they read one note. */
interface Reading {
  lines: string[];
  code: boolean[];
  unclosed: boolean[];
  taken: boolean[];
  cards: Card[];
  /** The decks each card names at its own head, in the order they are pushed. */
  owned: string[][];
  /** Lines whose tags a card took, which are therefore not the note's. */
  claimed: Set<number>;
}

/**
 * Whether line `at` ends a card. A blank line, heading or tags inside code is the
 * fence's and ends none (#675), except in a fence nobody closed (#680).
 */
function ends(r: Reading, at: number): boolean {
  return (!r.code[at] || r.unclosed[at] === true) && breaks(r.lines[at]);
}

/** Whether line `at` holds a schedule, which ends a card in code too, being its last line. */
function schedules(r: Reading, at: number): boolean {
  const line = r.lines[at] ?? "";
  return SR.test(line) || CLOZE_SR.test(line);
}

/** Whether the second pass reads line `at` as a one-line card, so outside code as there. */
function inlineAt(r: Reading, at: number): boolean {
  return !r.code[at] && oneLine(r.lines[at] ?? "") !== null;
}

/** Pushes `asked`, each with the tags its own line `at` names, null for none. */
function push(r: Reading, asked: Card[], at: number | null): void {
  const own = (at === null ? null : cardTags(r.lines[at] ?? "")) ?? [];
  if (own.length > 0 && at !== null) r.claimed.add(at);
  // One entry per card pushed, `owned` being read by the cards' index.
  for (const card of asked) {
    r.owned.push(own);
    r.cards.push(card);
  }
}

/**
 * The first line of the front over the `?` at `at`, and whether it is a cloze. It
 * runs back to a blank line or heading, outside code. A mark directly over the `?`
 * is the whole front; further up it ends the front as a cloze of its own, the one
 * reading `review.ts` can make. A one-line card ends it too (#683).
 */
function frontOf(r: Reading, at: number): { from: number; cloze: boolean } {
  if (!ends(r, at - 1) && holdsCloze(r.lines[at - 1])) return { from: at - 1, cloze: true };
  let from = at;
  while (
    !ends(r, from - 1) &&
    !holdsCloze(r.lines[from - 1]) &&
    !schedules(r, from - 1) &&
    !inlineAt(r, from - 1)
  )
    from--;
  return { from, cloze: false };
}

/**
 * The last line of the back under the `?` at `at`. The token ends it in code
 * too, as the schedule does, so `setSuspended` still parks a card in an open fence.
 */
function backOf(r: Reading, at: number): number {
  let to = at;
  while (!ends(r, to + 1) && !schedules(r, to + 1) && !parks(r.lines[to + 1])) to++;
  return to;
}

/** Reads the card whose `?` is line `at`, if it is one. */
function readAsked(r: Reading, at: number): void {
  // A `?` with nothing over it is a line of prose, not a card missing its question.
  const { from, cloze } = frontOf(r, at);
  if (from === at) return;
  // A `?` with nothing under it is no card, except under a cloze, whose `?` it
  // stays with an empty back: `review.ts`, seeing the matched lines alone, reads
  // the cloze's dates under it the same way.
  let to = backOf(r, at);
  if (to === at && !cloze) return;

  const { lines } = r;
  // The import's id sits on the back's last line, and is no part of the answer.
  const back = withoutAnkiId(lines.slice(at + 1, to + 1).join("\n")).trim();
  // The schedule or the token on the line under the back takes it into the
  // card's span, so `setSuspended` has a line to write on. A cloze's comments do
  // the same for a cloze alone: a plain card would never find its own under them.
  const under = lines[to + 1] ?? "";
  const schedule = readSchedule(under);
  const parked: Parked | null = parks(under) ? "suspended" : null;
  if (schedule !== null || parked !== null || (cloze && CLOZE_SR.test(under))) to++;
  for (let mark = from; mark <= to; mark++) r.taken[mark] = true;

  // A card's own tags sit at the head of the line directly above the `?`. Over a
  // longer front they are prose's, and `review.ts` hands them to the note too.
  const head = from === at - 1 ? from : null;
  if (cloze) {
    const span = { from, to, inline: false, parked };
    push(r, clozeCards(lines[from] ?? "", back, lines[to] ?? "", span), head);
    return;
  }
  const card: Card = {
    from,
    to,
    // The card's own tags are format, not question, so they come off the front.
    front: side(withoutTags(lines.slice(from, at).join("\n")).trim()),
    back: side(back),
    inline: false,
    decks: [],
    held: schedule,
    parked,
    cloze: null,
    target: null,
  };
  push(r, [card], head);
}

/** Reads line `at` as a one-line card or cloze, if it is one. */
function readInline(r: Reading, at: number, line: string): void {
  // Before the divider: `{{c1::Paris}}` holds a `::` that divides nothing,
  // and a cloze is never a question waiting on its answer.
  if (holdsCloze(line)) {
    const parked = suspended(line) ? "suspended" : null;
    push(r, clozeCards(line, "", line, { from: at, to: at, inline: true, parked }), at);
    return;
  }
  const halves = oneLine(line);
  if (halves === null) return;
  // The token first: a card carrying it was parked on purpose, and a card
  // parked on purpose before it was ever answered has both shapes at once.
  const unanswered = halves.back === "" ? "unanswered" : null;
  const card: Card = {
    from: at,
    to: at,
    front: side(withoutTags(halves.front).trim()),
    back: side(halves.back),
    inline: true,
    decks: [],
    held: readSchedule(line),
    parked: suspended(line) ? "suspended" : unanswered,
    cloze: null,
    target: null,
  };
  push(r, [card], at);
}

/**
 * Every card the note holds, in the order they are written.
 *
 * Two passes rather than one. The `?` cards are found first and their lines
 * marked taken, because a back reading `a::b` would otherwise be read a second
 * time as a card of its own and asked twice from the same block.
 */
export function parseCards(text: string, note = ""): Card[] {
  const lines = text.split("\n");
  const { uncommented, code, unclosed } = commentsAndCode(text);
  const r: Reading = {
    lines,
    code,
    unclosed,
    taken: lines.map(() => false),
    cards: [],
    owned: [],
    claimed: new Set<number>(),
  };

  // A `?` a card above already took is part of that card's back, not a card of
  // its own: obsidian-spaced-repetition splits at blank lines only and the first
  // `?` divides, and a second card here would share the first's schedule (#678).
  for (const [at, line] of lines.entries()) {
    if (!code[at] && !r.taken[at] && line.trim() === "?") readAsked(r, at);
  }
  for (const [at, line] of lines.entries()) {
    if (!code[at] && !r.taken[at]) readInline(r, at, line);
  }

  // Last, and before the sort, `owned` running in the order the cards were
  // pushed. Every tag no card claimed is the note's, and the two add rather
  // than replace: a card about two things is asked in both decks.
  const noteDecks = uncommented
    .split("\n")
    .flatMap((line, at) => (code[at] || r.claimed.has(at) ? [] : deckTags(line)));
  for (const [at, card] of r.cards.entries()) {
    card.decks = [
      ...new Set([...noteDecks, ...(r.owned[at] ?? [])].map((tag) => deckName(tag, note))),
    ];
  }

  return r.cards.sort((one, two) => one.from - two.from);
}
