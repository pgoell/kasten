import {
  CLOZE_SR,
  CLOZE_SRS,
  clozeComment,
  FSRS,
  FSRS_LINE,
  fsrsComment,
  PLAIN_SRS,
  parks,
  SR,
  SUSPEND_TOKEN,
  unread,
  withoutHeadToken,
  withoutToken,
} from "@/lib/review/card-line";
import { commentsAndCode } from "@/lib/review/deck-parse";
import { type Card, type Held, isFsrs } from "@/lib/review/srs";

/** A day as the plugin's stamp: midnight UTC, whose date part reads the same in every zone. */
const stamp = (day: string | null) => (day === null ? "-" : `${day}T00:00:00.000Z`);

/** `next` written as the comment that goes in the note, named by its number on a cloze. */
function comment(next: Held, cloze: number | null = null): string {
  const name = cloze === null ? "" : `c${cloze}`;
  if (!isFsrs(next)) return `<!--SR:${name}!${next.due},${next.interval},${next.ease}-->`;
  const { interval, stability, difficulty, state, reps, lapses, steps } = next;
  // Two places, so a number reads back as written; the plugin writes the whole float and reads either.
  const fields = [
    interval,
    stability.toFixed(2),
    difficulty.toFixed(2),
    state,
    reps,
    lapses,
    steps,
  ];
  return `<!--SR:${name}!fsrs,${stamp(next.due)},${fields.join(",")},${stamp(next.last)}-->`;
}

/** `line` with its first `found` swapped for `written` and every other taken off, or null where none is. */
function swap(line: string, found: RegExp, written: string): string | null {
  let count = 0;
  // The space before a comment taken off goes with it.
  const swapped = line.replace(new RegExp(`([ \\t]*)(?:${found.source})`, "g"), (_, space) =>
    count++ === 0 ? `${space}${written}` : "",
  );
  return count === 0 ? null : swapped;
}

/** The comments of the card's own kind, global: a cloze number's, or the plain card's. */
function own(cloze: number | null): RegExp {
  if (cloze === null) return PLAIN_SRS;
  return new RegExp(`${clozeComment(cloze).source}|${fsrsComment(cloze).source}`, "g");
}

/**
 * Where the card's schedule line is, once a tab from before #1929's SM-2 line over its FSRS
 * line is folded into one; null where an FSRS comment does not read, which leaves it alone.
 */
function fold(lines: string[], card: Card): number | null {
  const over = lines[card.to - 1] ?? "";
  const last = lines[card.to] ?? "";
  const stacked =
    !card.inline &&
    FSRS_LINE.test(last) &&
    !FSRS.test(over) &&
    (SR.test(over) || CLOZE_SR.test(over) || parks(over));
  if (unread(stacked ? `${over} ${last}` : last)) return null;
  if (!stacked) return card.to;
  lines.splice(card.to - 1, 2, `${over.trimEnd()} ${last.trim()}`);
  return card.to - 1;
}

/**
 * `text` with this card's schedule set, every other line byte-identical.
 * A line splice, not a rebuild: the note is the user's, and a rating does not reflow it.
 */
export function writeSchedule(text: string, card: Card, next: Held): string {
  const lines = text.split("\n");
  const to = fold(lines, card);
  if (to === null) return text;
  const last = lines[to] ?? "";
  const written = comment(next, card.cloze);
  const swapped = swap(last, own(card.cloze), written);

  // A cloze with no comment of its own joins the line the others sit on, which is the
  // cloze's own line, or the line under a `?` back once any comment or the token made one.
  const joins =
    card.inline ||
    (card.cloze !== null &&
      (CLOZE_SR.test(last) || SR.test(last) || FSRS.test(last) || parks(last)));
  if (swapped !== null) lines[to] = swapped;
  else if (joins) lines[to] = `${last.trimEnd()} ${written}`;
  else lines.splice(to + 1, 0, written);
  return lines.join("\n");
}

/** A schedule comment of any kind, plain or a cloze number's, SM-2 or FSRS, whichever comes first. */
const ANY_SR = new RegExp(`${PLAIN_SRS.source}|${CLOZE_SRS.source}`);

/**
 * `text` with this card parked or put back, every other line byte-identical.
 * The token and the schedule are separate, so putting a card back keeps its date.
 */
export function setSuspended(text: string, card: Card, on: boolean): string {
  const lines = text.split("\n");
  const last = lines[card.to] ?? "";
  // A cloze parks every number off the one token, before the first of its
  // comments, so parking any number writes the same line as parking another.
  // Either kind of comment: a `?` card written before cloze existed whose front
  // happens to hold a mark is a cloze now, its schedule line holding a plain one.
  const schedule = card.cloze === null ? new RegExp(PLAIN_SRS.source) : ANY_SR;

  if (card.inline) {
    // The reader's reading, so the token is never cut from or written into a comment (#1590).
    const bare = commentsAndCode(text).uncommented.split("\n")[card.to] ?? last;
    const end = bare.trimEnd().length;
    lines[card.to] = on
      ? schedule.test(last)
        ? last.replace(schedule, `${SUSPEND_TOKEN} $&`)
        : `${last.slice(0, end)} ${SUSPEND_TOKEN}${last.slice(end).trimEnd()}`
      : withoutToken(last, bare);
    return lines.join("\n");
  }

  if (!on) {
    const bare = withoutHeadToken(last);
    // A line the token was the whole of goes with it, so the note is left as
    // it was rather than gaining a blank line per parking.
    if (bare.trim() === "") lines.splice(card.to, 1);
    else lines[card.to] = bare;
    return lines.join("\n");
  }

  // `card.to` is the schedule's line where the card has one, and the last line
  // of its back where it has none.
  if (schedule.test(last)) lines[card.to] = `${SUSPEND_TOKEN} ${last}`;
  else lines.splice(card.to + 1, 0, SUSPEND_TOKEN);
  return lines.join("\n");
}

/**
 * `text` with `question` appended as a card waiting for its answer. Appending, not
 * inserting, keeps the ordinals a running sitting holds. A deck tag at the head needs nothing here.
 */
export function appendStub(text: string, question: string): string {
  return `${text.replace(/\n*$/, "")}\n\n${question}::\n`;
}
