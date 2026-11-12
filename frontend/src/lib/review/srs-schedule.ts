import { type CardInput, createEmptyCard, fsrs, Rating as Grade, State } from "ts-fsrs";
import { shiftDay } from "@/lib/core/clock";
import { readField, setField } from "@/lib/notes/text/note-frontmatter";
import { type Fsrs, type Held, isFsrs, type Rating, type Schedule } from "@/lib/review/srs";

/** What a card starts life at, which is SM-2's 2.5 and Anki's default. */
const NEW_EASE = 250;

/**
 * Stops a card answered `again` many times from sinking to an ease that never grows its interval.
 * 130 is Anki's floor.
 */
const LEAST_EASE = 130;

/**
 * SM-2, which a whole note keeps in its frontmatter; a card goes by `nextFsrs`.
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

/** FSRS-6's default weights, 90 percent recall, no fuzz (#1926). Learning steps on, as the plugin has them. */
const FSRS = fsrs({ request_retention: 0.9, enable_fuzz: false });

const GRADES = { again: Grade.Again, hard: Grade.Hard, good: Grade.Good, easy: Grade.Easy };

/** ts-fsrs refuses a stability under its floor, which a run of `again` or two places can reach. */
const LEAST_STABILITY = 0.01;

/** The SM-2 ease range the plugin maps onto difficulty 10 to 1; kasten's ease has no ceiling (#1926). */
const EASES = [130, 370] as const;

const midnight = (day: string) => new Date(`${day}T00:00:00.000Z`);
const clamp = (value: number, least: number, most: number) =>
  Math.min(most, Math.max(least, value));
const hundredths = (value: number) => Math.round(value * 100) / 100;

/** An SM-2 schedule as an FSRS card, by the plugin's `sm2ScheduleToFsrsCard`. */
function fromSm2(held: Schedule): CardInput {
  const interval = Math.max(1, Math.round(held.interval));
  const [least, most] = EASES;
  const eased = (clamp(held.ease, least, most) - least) / (most - least);
  return {
    due: midnight(held.due),
    stability: Math.max(0.1, interval),
    difficulty: clamp(10 - eased * 9, 1, 10),
    scheduled_days: interval,
    learning_steps: 0,
    reps: Math.max(1, Math.round(Math.log2(interval + 1))),
    lapses: 0,
    state: State.Review,
    last_review: midnight(shiftDay(held.due, -interval)),
  };
}

/** The comment's fields as ts-fsrs takes them, held inside its bounds. */
function fromFsrs(held: Fsrs): CardInput {
  return {
    due: midnight(held.due),
    stability: Math.max(LEAST_STABILITY, held.stability),
    difficulty: clamp(held.difficulty, 1, 10),
    scheduled_days: held.interval,
    learning_steps: held.steps,
    reps: held.reps,
    lapses: held.lapses,
    state: held.state as State,
    last_review: held.last === null ? null : midnight(held.last),
  };
}

/**
 * The FSRS schedule rating a card today writes. An SM-2 card turns into FSRS here, at its first answer after the change.
 * Every time is midnight UTC of a day, so a learning step of minutes comes due today.
 */
export function nextFsrs(held: Held | null, rating: Rating, today: string): Fsrs {
  const now = midnight(today);
  // A card the plugin reset reads as new, as its stability and difficulty are 0.
  const fresh = held === null || (isFsrs(held) && held.state === State.New);
  const card = fresh ? createEmptyCard(now) : isFsrs(held) ? fromFsrs(held) : fromSm2(held);
  const next = FSRS.next(card, now, GRADES[rating]).card;
  return {
    due: next.due.toISOString().slice(0, 10),
    interval: next.scheduled_days,
    stability: Math.max(LEAST_STABILITY, hundredths(next.stability)),
    difficulty: hundredths(next.difficulty),
    state: next.state,
    reps: next.reps,
    lapses: next.lapses,
    steps: next.learning_steps,
    last: today,
  };
}

/**
 * Whether the card is in learning: FSRS's state 1 or 3, or SM-2's gap of 0 after an `again` on the first answer.
 * SM-2 never writes a gap of 0 otherwise, its floor being 1.
 */
export function learning(held: Held | null): boolean {
  if (held === null) return false;
  if (isFsrs(held)) return held.state === State.Learning || held.state === State.Relearning;
  return held.interval === 0;
}

/**
 * What answering the card today was, or null. Read off the schedule, so a reload or second device counts the same.
 * FSRS names the last answer, and a card on its first answer or still in learning reads as new.
 * SM-2's first answer has the starting ease and a gap of 0, 1 or 4. A rare review like that, or a card learned yesterday and passed today, reads as new too.
 */
export function answeredToday(held: Held | null, today: string): "new" | "review" | null {
  if (held === null) return null;
  if (isFsrs(held)) {
    if (held.last !== today) return null;
    return held.reps === 1 || held.state === State.Learning ? "new" : "review";
  }
  if (held.due !== shiftDay(today, held.interval)) return null;
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
