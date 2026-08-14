/**
 * Reading a flashcard out of a note, and moving the date it comes back on.
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
 * Which decks a card is in is read here, off `deck-tag.ts`'s rule, because this
 * is the reader that sees the note whole. A `::` is a common enough thing to
 * type that reading every one of them as a card would fill the queue with C++
 * and YAML, so a card in no deck at all is not a card, and the overview counts
 * the same thing off the matched lines alone.
 */

import { shiftDay } from "@/lib/clock";
import { cardTags, deckName, deckTags, onlyTags, withoutTags } from "@/lib/deck-tag";
import { readField, setField } from "@/lib/note-frontmatter";

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
}

/**
 * The comment holding a schedule. `!` is obsidian-spaced-repetition's and is
 * matched rather than assumed, so a comment written without one is left alone
 * instead of read as a card that has never been answered.
 */
const SR = /<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/** What a card starts life at, which is SM-2's 2.5 and Anki's default. */
const NEW_EASE = 250;

/**
 * How low the ease can sink.
 *
 * A card answered `again` twenty times would otherwise reach an ease of zero
 * and an interval that can never grow, which is a card the algorithm has given
 * up on rather than one it is still learning. 130 is Anki's floor.
 */
const LEAST_EASE = 130;

/** A heading, which is a hash and a space and not any hash at all. */
const HEADING = /^#{1,6}[ \t]/;

/** A line that ends whatever card was being read: blank, a heading, or tags. */
function breaks(line: string | undefined): boolean {
  if (line === undefined || line.trim() === "") return true;
  // A heading and not every hash. `#flashcards/dbt What is a macro?` opens a
  // card, and reading its tag as a heading would leave that card no front to
  // be asked by; a line of nothing but tags is the note's and breaks as before.
  return HEADING.test(line.trimStart()) || onlyTags(line);
}

/** Which lines sit inside a fenced code block, so `std::vector` is not a card. */
function fences(lines: string[]): boolean[] {
  let inside = false;
  return lines.map((line) => {
    if (line.trimStart().startsWith("```")) {
      inside = !inside;
      // The fence itself is never a card either way.
      return true;
    }
    return inside;
  });
}

/** The three numbers one `<!--SR:!…-->` holds, or null where there is none. */
export function readSchedule(text: string): Schedule | null {
  const found = SR.exec(text);
  if (found === null) return null;
  // The defaults are unreachable: a match means all three groups are there.
  const [, due = "", interval = "1", ease = "250"] = found;
  return { due, interval: Number(interval), ease: Number(ease) };
}

/**
 * Every card the note holds, in the order they are written.
 *
 * Two passes rather than one. The `?` cards are found first and their lines
 * marked taken, because a front reading `a::b` would otherwise be read a second
 * time as a card of its own and asked twice from the same block.
 */
export function parseCards(text: string, note = ""): Card[] {
  const lines = text.split("\n");
  const fenced = fences(lines);
  const taken = lines.map(() => false);
  const cards: Card[] = [];
  /** The decks each card names at its own head, in the order they are pushed. */
  const owned: string[][] = [];
  /** Lines whose tags a card took, which are therefore not the note's. */
  const claimed = new Set<number>();

  for (const [at, line] of lines.entries()) {
    if (fenced[at] || line.trim() !== "?") continue;

    // The front runs back to the blank line or heading above it. A `?` with
    // nothing over it is a line of prose, not a card missing its question.
    let from = at;
    while (!breaks(lines[from - 1])) from--;
    if (from === at) continue;

    let to = at;
    while (!breaks(lines[to + 1]) && !SR.test(lines[to + 1] ?? "")) to++;
    if (to === at) continue;

    const back = lines.slice(at + 1, to + 1);
    // The schedule sits on its own line under the back, where the plugin puts it.
    const schedule = readSchedule(lines[to + 1] ?? "");
    if (schedule !== null) to++;

    // A card's own tags sit at the head of its first line, and that line is
    // the one directly above the `?`. A front running over two lines is prose
    // the tags at the top of it are no part of, and `review.ts`, reading the
    // matched lines alone, cannot tell that case from any other line of prose,
    // so both readers hand those to the note rather than disagreeing.
    const own = (from === at - 1 ? cardTags(lines[from] ?? "") : null) ?? [];
    if (own.length > 0) claimed.add(from);
    owned.push(own);

    for (let mark = from; mark <= to; mark++) taken[mark] = true;
    cards.push({
      from,
      to,
      // The card's own tags are part of the format and not part of the
      // question, so they come off the front before it is ever asked.
      front: withoutTags(lines.slice(from, at).join("\n")).trim(),
      back: back.join("\n").trim(),
      inline: false,
      decks: [],
      held: schedule,
    });
  }

  for (const [at, line] of lines.entries()) {
    if (fenced[at] || taken[at] || !line.includes("::")) continue;
    // The first `::` divides the card, so a back holding one of its own keeps it.
    const divide = line.indexOf("::");
    const front = line.slice(0, divide);
    const back = line.slice(divide + 2).replace(SR, "");
    if (front.trim() === "" || back.trim() === "") continue;

    const own = cardTags(line) ?? [];
    if (own.length > 0) claimed.add(at);
    owned.push(own);

    cards.push({
      from: at,
      to: at,
      front: withoutTags(front).trim(),
      back: back.trim(),
      inline: true,
      decks: [],
      held: readSchedule(line),
    });
  }

  // Last, and before the sort, `owned` running in the order the cards were
  // pushed. Every tag no card claimed is the note's, and the two add rather
  // than replace: a card about two things is asked in both decks.
  const noteDecks = lines.flatMap((line, at) =>
    fenced[at] || claimed.has(at) ? [] : deckTags(line),
  );
  for (const [at, card] of cards.entries()) {
    card.decks = [
      ...new Set([...noteDecks, ...(owned[at] ?? [])].map((tag) => deckName(tag, note))),
    ];
  }

  return cards.sort((one, two) => one.from - two.from);
}

/**
 * Where the card goes next, by SM-2.
 *
 * ponytail: SM-2 rather than FSRS. FSRS predicts recall better and is a weight
 * table and a few hundred lines; SM-2 is these twenty and holds exactly the
 * three numbers the comment already carries. Swap it when the reviews start
 * feeling mistimed rather than because the newer one exists.
 *
 * No fuzz, so a deck imported on one day comes back on one day. Add it when
 * that bunching is actually felt.
 */
export function nextSchedule(held: Schedule | null, rating: Rating, today: string): Schedule {
  // A card nobody has answered has no interval to grow, so the four ratings
  // pick a first gap rather than scale one. Easy skips the first day the way
  // Anki's does; the other three all come back tomorrow.
  if (held === null) {
    const interval = rating === "easy" ? 4 : 1;
    return { due: shiftDay(today, interval), interval, ease: NEW_EASE };
  }

  let ease = held.ease;
  let interval = held.interval;

  switch (rating) {
    case "again":
      ease -= 20;
      interval *= 0.5;
      break;
    case "hard":
      ease -= 15;
      interval *= 1.2;
      break;
    case "good":
      interval *= ease / 100;
      break;
    case "easy":
      ease += 15;
      // The ease has already moved, so easy compounds its own bonus on top of
      // the raised multiplier rather than beside it.
      interval *= (ease / 100) * 1.3;
      break;
  }

  ease = Math.max(LEAST_EASE, ease);
  interval = Math.max(1, Math.round(interval));
  return { due: shiftDay(today, interval), interval, ease };
}

/** `next` written as the comment that goes in the note. */
function comment(next: Schedule): string {
  return `<!--SR:!${next.due},${next.interval},${next.ease}-->`;
}

/**
 * `text` with this card's schedule set, every other line byte-identical.
 *
 * A line splice rather than a rebuild of the note, because the note is the
 * user's and a rating is not licence to reflow it.
 */
export function writeSchedule(text: string, card: Card, next: Schedule): string {
  const lines = text.split("\n");
  const last = lines[card.to] ?? "";

  if (card.inline) {
    lines[card.to] = SR.test(last)
      ? last.replace(SR, comment(next))
      : `${last.trimEnd()} ${comment(next)}`;
  } else if (SR.test(last)) {
    lines[card.to] = last.replace(SR, comment(next));
  } else {
    lines.splice(card.to + 1, 0, comment(next));
  }

  return lines.join("\n");
}

/**
 * Whether what was typed counts as the card's answer.
 *
 * Forgiving on everything that is not the answer: case, the space around and
 * inside it, and a full stop the card's author typed and you did not. Not
 * forgiving on a word, because a card whose answer is nearly right is a card
 * you are about to rate yourself, and this only says which way to lean.
 *
 * ponytail: no edit distance. A typo you can see is a typo you can rate `hard`,
 * and a threshold that called `Store` close enough to `Storage` would be worse
 * than the strict answer, not better.
 */
export function sameAnswer(typed: string, back: string): boolean {
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
  return plain(typed) !== "" && plain(typed) === plain(back);
}

/**
 * The schedule of a note that is itself the card, off its frontmatter.
 *
 * A whole note marked `#review` has no `::` to hang a comment on, so its three
 * numbers go in the block at the top, under the names
 * obsidian-spaced-repetition gives them. That is the only difference between a
 * note and a card here; everything downstream of this treats the two the same.
 *
 * A note carrying `sr-due` and nothing else reads as a card scheduled by hand,
 * which is a real thing to type into a note and worth taking at its word rather
 * than ignoring for want of two fields nobody would write out.
 */
export function readNoteSchedule(text: string): Schedule | null {
  const due = readField(text, "sr-due");
  if (due === undefined) return null;
  return {
    due,
    interval: Number(readField(text, "sr-interval") ?? 1),
    ease: Number(readField(text, "sr-ease") ?? NEW_EASE),
  };
}

/** `text` with the note's own schedule set, minting the block where it has none. */
export function writeNoteSchedule(text: string, next: Schedule): string {
  let written = setField(text, "sr-due", next.due);
  written = setField(written, "sr-interval", String(next.interval));
  return setField(written, "sr-ease", String(next.ease));
}
