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
  const taken = lines.map(() => false);
  const cards: Card[] = [];
  /** The decks each card names at its own head, in the order they are pushed. */
  const owned: string[][] = [];
  /** Lines whose tags a card took, which are therefore not the note's. */
  const claimed = new Set<number>();
  // obsidian-spaced-repetition reads a fence whole, so a blank line, a heading
  // or tags inside code is the fence's and ends no card (#675). Not in a fence
  // nobody closed, which runs to the end of the note: there the card above it
  // would read the schedule of a card hidden under it and a rating overwrite it (#680).
  const ends = (at: number) => (!code[at] || unclosed[at]) && breaks(lines[at]);
  // A schedule ends a card in code too: it is the card's last line, so neither
  // walk crosses one into the card above or a second line under it.
  const schedules = (at: number) => SR.test(lines[at] ?? "") || CLOZE_SR.test(lines[at] ?? "");
  // A line the second pass reads as a one-line card, so outside code as there.
  const inline = (at: number) => !code[at] && oneLine(lines[at] ?? "") !== null;

  for (const [at, line] of lines.entries()) {
    // A `?` a card above already took is part of that card's back, not a card
    // of its own: obsidian-spaced-repetition splits at blank lines only and the
    // first `?` divides, and a second card here would share the first's lines
    // and read and write its schedule (#678).
    if (code[at] || taken[at] || line.trim() !== "?") continue;

    // The front runs back to the blank line or heading above it, outside code.
    // A `?` with nothing over it is a line of prose, not a card missing its question.
    // A line holding a mark ends it too: directly over the `?` it is the whole
    // front, the cloze this card asks, and further up it is a cloze of its own,
    // which is the one reading `review.ts` can make off the matched lines.
    // A one-line card ends it as well, schedule or none: obsidian-spaced-repetition
    // asks such a line as a card of its own and starts the front under it, so
    // directly over the `?` it leaves the `?` with nothing above it (#683).
    const cloze = !ends(at - 1) && holdsCloze(lines[at - 1]);
    let from = cloze ? at - 1 : at;
    if (!cloze) {
      while (
        !ends(from - 1) &&
        !holdsCloze(lines[from - 1]) &&
        !schedules(from - 1) &&
        !inline(from - 1)
      )
        from--;
    }
    if (from === at) continue;

    // The back runs down the same way. The token ends it in code too, as the
    // schedule does, so a fence nobody closed keeps its one schedule and the
    // token `setSuspended` writes there still parks the card.
    let to = at;
    while (!ends(to + 1) && !schedules(to + 1) && !parks(lines[to + 1])) to++;
    // A `?` with nothing under it is no card, except under a cloze, whose `?`
    // it stays with an empty back. `review.ts` sees the matched lines alone and
    // cannot tell a blank line under the `?` from a back of plain text, so both
    // readers take the `?` as the cloze's and read its dates under it.
    if (to === at && !cloze) continue;

    // The import's id sits on the back's last line, and is no part of the answer.
    const back = withoutAnkiId(lines.slice(at + 1, to + 1).join("\n")).trim();
    // The schedule sits on its own line under the back, where the plugin puts
    // it, and the token sits at the head of that same line. Either one takes
    // the line into the card's span, so `setSuspended` has a line to write on.
    // A cloze's comments do the same for a cloze and nothing else: a plain
    // card would splice its own comment under them and never find it again.
    const under = lines[to + 1] ?? "";
    const schedule = readSchedule(under);
    const held = parks(under);
    if (schedule !== null || held || (cloze && CLOZE_SR.test(under))) to++;

    // A card's own tags sit at the head of its first line, and that line is
    // the one directly above the `?`. A front running over two lines is prose
    // the tags at the top of it are no part of, and `review.ts`, reading the
    // matched lines alone, cannot tell that case from any other line of prose,
    // so both readers hand those to the note rather than disagreeing.
    const own = (from === at - 1 ? cardTags(lines[from] ?? "") : null) ?? [];
    if (own.length > 0) claimed.add(from);
    for (let mark = from; mark <= to; mark++) taken[mark] = true;

    if (cloze) {
      const asked = clozeCards(lines[from] ?? "", back, lines[to] ?? "", {
        from,
        to,
        inline: false,
        parked: held ? "suspended" : null,
      });
      // One entry per card pushed, `owned` being read by the cards' index.
      for (const card of asked) {
        owned.push(own);
        cards.push(card);
      }
      continue;
    }

    owned.push(own);
    cards.push({
      from,
      to,
      // The card's own tags are part of the format and not part of the
      // question, so they come off the front before it is ever asked.
      front: side(withoutTags(lines.slice(from, at).join("\n")).trim()),
      back: side(back),
      inline: false,
      decks: [],
      held: schedule,
      parked: held ? "suspended" : null,
      cloze: null,
      target: null,
    });
  }

  for (const [at, line] of lines.entries()) {
    if (code[at] || taken[at]) continue;

    // Before the divider: `{{c1::Paris}}` holds a `::` that divides nothing,
    // and a cloze is never a question waiting on its answer.
    if (holdsCloze(line)) {
      const own = cardTags(line) ?? [];
      if (own.length > 0) claimed.add(at);
      const parked = suspended(line) ? "suspended" : null;
      for (const card of clozeCards(line, "", line, { from: at, to: at, inline: true, parked })) {
        owned.push(own);
        cards.push(card);
      }
      continue;
    }

    const halves = oneLine(line);
    if (halves === null) continue;

    const own = cardTags(line) ?? [];
    if (own.length > 0) claimed.add(at);
    owned.push(own);

    cards.push({
      from: at,
      to: at,
      front: side(withoutTags(halves.front).trim()),
      back: side(halves.back),
      inline: true,
      decks: [],
      held: readSchedule(line),
      // The token first: a card carrying it was parked on purpose, and a card
      // parked on purpose before it was ever answered has both shapes at once.
      parked: suspended(line) ? "suspended" : halves.back === "" ? "unanswered" : null,
      cloze: null,
      target: null,
    });
  }

  // Last, and before the sort, `owned` running in the order the cards were
  // pushed. Every tag no card claimed is the note's, and the two add rather
  // than replace: a card about two things is asked in both decks.
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
