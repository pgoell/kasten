import { shiftDay } from "@/lib/clock";
import { readField, setField } from "@/lib/note-frontmatter";
import type { Rating, Schedule } from "@/lib/srs";

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
  // A card nobody has answered, or one still in learning, has no interval to
  // grow, so the four ratings pick a first gap rather than scale one. Easy
  // skips the first day the way Anki's does; Hard and Good come back tomorrow.
  // Again keeps the card in learning: due today with a gap of 0, so a reload or
  // the next sitting asks it again until it is passed, as Anki's learning steps do.
  if (held === null || learning(held)) {
    const interval = rating === "easy" ? 4 : rating === "again" ? 0 : 1;
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

/**
 * Whether the card was answered `again` on its first answer and not passed since.
 *
 * A gap of 0 is a state SM-2 never writes otherwise, its floor being 1, so the
 * three numbers carry it without a fourth.
 */
export function learning(held: Schedule | null): boolean {
  return held !== null && held.interval === 0;
}

/**
 * What answering the card today was, read off its schedule, or null where nothing did.
 *
 * The comment holds three numbers and no history, and obsidian-spaced-repetition
 * reads those three, so a fourth was not an option. What is there is enough:
 * every rating above writes a due date of today plus the interval, so a card
 * whose two agree was answered today. A first answer always lands on the
 * starting ease with a gap of 0, 1 or 4, which is what tells a card introduced
 * today from a review done today.
 *
 * Read off the vault, so a reload or a second device counts the same. The cost
 * is two mistakes, both rare: a review that lands back on the starting ease
 * with a gap of 1 or 4 reads as new, and so does a card left in learning
 * yesterday and passed today.
 */
export function answeredToday(held: Schedule | null, today: string): "new" | "review" | null {
  if (held === null || held.due !== shiftDay(today, held.interval)) return null;
  return held.ease === NEW_EASE && [0, 1, 4].includes(held.interval) ? "new" : "review";
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

/**
 * Whether a note that is itself the card is parked.
 *
 * The whole-note twin of the token on a card's line. A note reviewed as one
 * thing has no line to hang a marker on, so the marker goes in the block where
 * its schedule already lives, beside `sr-due`.
 *
 * True for the literal word and nothing else, which is what keeps a note that
 * carries the key for some other reason out of the parked list.
 */
export function readNoteSuspended(text: string): boolean {
  return readField(text, "sr-suspended") === "true";
}

/**
 * `text` with the note parked or put back.
 *
 * Put back writes `false` rather than taking the key out, because
 * `note-frontmatter.ts` exports no delete and inventing one for this field
 * alone is a larger change than a line reading `sr-suspended: false` costs.
 */
export function writeNoteSuspended(text: string, on: boolean): string {
  return setField(text, "sr-suspended", on ? "true" : "false");
}
