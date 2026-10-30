import { shiftDay } from "@/lib/clock";
import { readField, setField } from "@/lib/note-frontmatter";
import type { Rating, Schedule } from "@/lib/review/srs";

/** What a card starts life at, which is SM-2's 2.5 and Anki's default. */
const NEW_EASE = 250;

/**
 * Stops a card answered `again` many times from sinking to an ease that never grows its interval.
 * 130 is Anki's floor.
 */
const LEAST_EASE = 130;

/**
 * ponytail: SM-2 rather than FSRS, as it holds exactly the three numbers the comment carries. Swap when reviews feel mistimed.
 * No fuzz, so a deck imported on one day comes back on one day. Add it when that bunching is felt.
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
 * What answering the card today was, or null. Read off the schedule, so a reload or second device counts the same.
 * A first answer has the starting ease and a gap of 0, 1 or 4, which marks it new. A rare review like that, or a card learned yesterday and passed today, reads as new too.
 */
export function answeredToday(held: Schedule | null, today: string): "new" | "review" | null {
  if (held === null || held.due !== shiftDay(today, held.interval)) return null;
  return held.ease === NEW_EASE && [0, 1, 4].includes(held.interval) ? "new" : "review";
}

/**
 * A whole note marked `#review` has no `::`, so its three numbers go in the frontmatter under the names obsidian-spaced-repetition gives them.
 * A note with `sr-due` alone reads as a card scheduled by hand, which is worth taking at its word.
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
 * The whole-note twin of a card's token. A note has no line for a marker, so it sits beside `sr-due`.
 * Only the literal word counts, which keeps a note with that key for another reason out of the parked list.
 */
export function readNoteSuspended(text: string): boolean {
  return readField(text, "sr-suspended") === "true";
}

/**
 * `text` with the note parked or put back. Put back writes `false` rather than removing the key, since `note-frontmatter.ts` has no delete.
 */
export function writeNoteSuspended(text: string, on: boolean): string {
  return setField(text, "sr-suspended", on ? "true" : "false");
}
