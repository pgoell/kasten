import { useCallback, useEffect, useMemo, useState } from "react";
import { ChangedOnDisk } from "@/lib/api";
import { soundsIn } from "@/lib/audio";
import { readClock } from "@/lib/clock";
import { readNotes } from "@/lib/read-retry";
import { appendStub, setSuspended, writeSchedule } from "@/lib/review/card-write";
import type { Deck, Limits } from "@/lib/review/review";
import { cardsOf, type Seat, seatsFor } from "@/lib/review/review-queue";
import type { Card, Rating, Schedule } from "@/lib/review/srs";
import {
  answeredToday,
  nextSchedule,
  writeNoteSchedule,
  writeNoteSuspended,
} from "@/lib/review/srs-schedule";
import { soundsShowing } from "@/lib/review/use-card-sounds";
import { useReviewLimits } from "@/lib/review/use-review-limits";
import { useSittingWrites } from "@/lib/review/use-sitting-writes";

/** What the sitting refuses an undo with when the note moved on since the step. */
const MOVED_ON = "The note changed since that step, so it was not undone.";
/** What the foot says when the daily limits could not be read, before the reason. */
const LIMITS_UNREAD = "The daily limits could not be read: ";
/** What the foot says when a note of the deck could not be read, before the reason. */
const NOTE_UNREAD = "The note could not be read: ";

/**
 * The schedule a rating writes, so the write and the interval the button shows never disagree.
 * A card new at the start keeps answering as a first answer until it leaves the queue, as Anki's learning steps do.
 */
function scheduleFor(seat: Seat, held: Card, rating: Rating, today: string): Schedule {
  return nextSchedule(seat.fresh ? null : held.held, rating, today);
}

/**
 * The last rating or suspend, held so Undo can take it back.
 * Undo restores the whole queue, not one seat, since `again` moves a seat to the back and a suspend takes a cloze's siblings out.
 */
interface Step {
  note: string;
  /** The note before the step, which the undo writes back. */
  text: string;
  /** The note the step sent, which the undo names as its base. */
  next: string;
  queue: Seat[];
  done: number;
  typed: string;
}

/**
 * The state and scheduling of one sitting. Every rating is written straight back to its note, so a sitting cut short keeps its answers.
 * The queue holds a note and an ordinal, not the cards: a write can insert a line but never add or remove a card, so ordinals survive.
 */
export function useReviewSitting(
  deck: Deck,
  play: (sources: string[]) => void,
  /**
   * Set while a swiped card is in flight, which refuses everything over it: the flight's grade is the only write until it lands.
   * A ref, not state, so a press in the same frame is refused too.
   */
  flying: { current: boolean },
) {
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const [queue, setQueue] = useState<Seat[]>([]);
  const [revealed, setRevealed] = useState(false);
  /** What was typed for the card showing, kept so the verdict can quote it back. */
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(0);
  /** The sentence at the foot, which a refused undo words apart from a failed write. */
  const [failed, setFailed] = useState<string | null>(null);
  /** Bumped by Try again, which runs the deck read once more. */
  const [tries, setTries] = useState(0);
  const [step, setStep] = useState<Step | null>(null);
  const [undoing, setUndoing] = useState(false);
  const unwritten = useCallback(
    (message: string) => setFailed(`The note could not be written: ${message}`),
    [],
  );
  // A failed write puts its message in the bar and the session carries on,
  // because a rating that vanished silently would be a card you answer again
  // tomorrow believing you had not.
  const write = useSittingWrites(setTexts, unwritten);

  const today = useMemo(() => readClock(new Date()).date, []);
  const { limits: read, failed: limitsFailed, retry: retryLimits } = useReviewLimits(true);
  // The first limits read, kept for the whole sitting. Every rating refetches
  // them, and a `decks.md` that answers differently by then would otherwise
  // build the queue again under the sitting: the count jumps back and a card
  // rated `again` loses its second asking. A change takes effect at the next
  // sitting, as in Anki.
  const [limits, setLimits] = useState<Limits>();
  useEffect(() => {
    if (read !== undefined) setLimits((was) => was ?? read);
  }, [read]);

  // Said in the foot, and no queue built: asking without the limits could ask
  // past them. A later read that answers takes the message away again.
  useEffect(() => {
    if (limits !== undefined) {
      setFailed((was) => (was?.startsWith(LIMITS_UNREAD) ? null : was));
    } else if (limitsFailed !== null) {
      setFailed(`${LIMITS_UNREAD}${limitsFailed}`);
    }
  }, [limits, limitsFailed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tries` is the trigger for Try again, and is not read.
  useEffect(() => {
    // Before any note is read: a queue built without the limits would ask the
    // whole deck, and the latch above keeps later limits from rebuilding it.
    if (limits === undefined) return;
    let live = true;
    // All of them before any of them is asked. A deck spanning three notes is
    // three reads at the start rather than one on the card that first needs it,
    // so the queue is the whole sitting from the first question and the count
    // in the header does not climb as you go. Each read tries again while the
    // backend restarts, and the foot says it is reading until one answers.
    void readNotes(deck.notes, () => live).then(
      (read) => {
        if (!live) return;
        const texts = new Map(read);
        setTexts(texts);
        setQueue(seatsFor(deck, texts, today, limits));
      },
      (error: unknown) => {
        // A read, not a write: nothing was sent to the vault, so the foot says so.
        if (live) {
          setFailed(
            `${NOTE_UNREAD}${error instanceof Error ? error.message : "could not read the note"}`,
          );
        }
      },
    );
    return () => {
      live = false;
    };
  }, [deck, today, limits, tries]);

  // Try again reads what failed, and only while no text was read: a read over a
  // sitting that has answers would rebuild its queue under them. Limits that
  // failed are read again first, and the deck after them by the effect above.
  const rereadable =
    texts === null &&
    (failed?.startsWith(NOTE_UNREAD) === true || failed?.startsWith(LIMITS_UNREAD) === true);
  const reread = useCallback(() => {
    setFailed(null);
    if (limits === undefined) retryLimits();
    else setTries((n) => n + 1);
  }, [limits, retryLimits]);

  const cards = useMemo(() => cardsOf(deck, texts ?? new Map()), [deck, texts]);
  const seat = queue[0];
  const card = seat === undefined ? undefined : cards.get(seat.note)?.[seat.at];
  // A whole note has nothing hidden to show, so it is shown from the start and
  // the four ratings are the only thing its footer ever draws.
  const shown = revealed || card?.back === "";

  // The interval each button shows, which is the one the rating writes, since
  // both come from `scheduleFor`.
  const next = useMemo(() => {
    if (seat === undefined || card === undefined) return null;
    const days = (rating: Rating) => scheduleFor(seat, card, rating, today).interval;
    return { again: days("again"), hard: days("hard"), good: days("good"), easy: days("easy") };
  }, [card, seat, today]);

  // The done screen's "next due": the earliest day after today a card of this
  // deck comes back. A parked card comes back on no day the screen can name.
  const nextDue = useMemo(() => {
    const dues = [...cards.values()].flatMap((each) =>
      each.flatMap(({ held, parked }) =>
        parked === null && held !== null && held.due > today ? [held.due] : [],
      ),
    );
    const [first] = dues.sort();
    return first ?? null;
  }, [cards, today]);

  // What the deck did today, whichever sitting did it, and whether new cards are
  // held back for another day. The done screen says both.
  const doneToday = useMemo(
    () =>
      [...cards.values()]
        .flat()
        .filter(({ held, parked }) => parked === null && answeredToday(held, today) !== null)
        .length,
    [cards, today],
  );
  const newCount = useMemo(
    () =>
      [...cards.values()].flat().filter(({ held, parked }) => parked === null && held === null)
        .length,
    [cards],
  );

  const rate = useCallback(
    (rating: Rating) => {
      // Held while an undo is out: its landing puts back the queue and the
      // count as they stood before the step, over anything done meanwhile.
      if (texts === null || seat === undefined || undoing || flying.current) return;
      const text = texts.get(seat.note);
      const held = cards.get(seat.note)?.[seat.at];
      if (text === undefined || held === undefined) return;

      const moved = scheduleFor(seat, held, rating, today);
      const next = deck.whole ? writeNoteSchedule(text, moved) : writeSchedule(text, held, moved);
      setTexts((was) => new Map(was).set(seat.note, next));
      setRevealed(false);
      setTyped("");
      setDone((count) => count + 1);
      // `again` sends the card to the back rather than out of the queue, which
      // is the one place the session disagrees with the schedule it just wrote:
      // the note says tomorrow, and today's sitting asks once more.
      setQueue((held_) => (rating === "again" ? [...held_.slice(1), seat] : held_.slice(1)));
      // The card the queue above puts up, played here because this is the tap.
      // `again` on the last card puts the same one up, and Anki asks it aloud.
      const coming = rating === "again" && queue.length === 1 ? seat : queue[1];
      const following = coming === undefined ? undefined : cards.get(coming.note)?.[coming.at];
      play(following === undefined ? [] : soundsShowing(following, false));

      setStep({ note: seat.note, text, next, queue, done, typed });
      write(seat.note, text, next);
    },
    [cards, deck, done, play, queue, seat, texts, today, typed, undoing, write, flying.current],
  );

  /**
   * Park the card on screen and move on, without rating it. It keeps its seat in the note, which the ordinals depend on:
   * `setSuspended` splices a token and never adds or removes a card.
   */
  const suspend = useCallback(() => {
    if (texts === null || seat === undefined || undoing || flying.current) return;
    const text = texts.get(seat.note);
    const held = cards.get(seat.note)?.[seat.at];
    if (text === undefined || held === undefined) return;

    // A whole note has no line to splice. Its synthetic card spans line 0, so
    // `setSuspended` would put the token under the opening `---` and break the
    // block, park nothing, and leave a line no screen can reach to undo.
    const next = deck.whole ? writeNoteSuspended(text, true) : setSuspended(text, held, true);
    setTexts((was) => new Map(was).set(seat.note, next));
    setRevealed(false);
    setTyped("");
    // The one token parks every number of a cloze, so the seats of the others
    // leave with this one rather than coming up parked later in the sitting.
    const after = cardsOf(deck, new Map([[seat.note, next]])).get(seat.note) ?? [];
    const left = queue
      .slice(1)
      .filter(({ note, at }) => note !== seat.note || after[at]?.parked === null);
    setQueue(left);
    const coming = left[0];
    const following = coming === undefined ? undefined : cards.get(coming.note)?.[coming.at];
    play(following === undefined ? [] : soundsShowing(following, false));

    setStep({ note: seat.note, text, next, queue, done, typed });
    write(seat.note, text, next);
  }, [cards, deck, done, play, queue, seat, texts, typed, undoing, write, flying.current]);

  /**
   * Take back the last rating or suspend. The card comes back, revealed, only once the note's old text has landed.
   * The write is sent against the base the step named, so anything written since makes the vault refuse and an undo never erases newer text.
   */
  const undo = useCallback(() => {
    if (step === null || undoing || flying.current) return;
    setStep(null);
    setUndoing(true);
    void write(step.note, step.next, step.text).then((error) => {
      setUndoing(false);
      if (error instanceof ChangedOnDisk) setFailed(MOVED_ON);
      if (error !== null) return;
      setTexts((was) => (was === null ? was : new Map(was).set(step.note, step.text)));
      setQueue(step.queue);
      setRevealed(true);
      setTyped(step.typed);
      setDone(step.done);
    });
  }, [step, undoing, write, flying.current]);

  /**
   * Write what was jotted to the end of the card's note, never the middle, so the queue's ordinals still hold.
   * Returns whether the question was written, so the caller closes its line only then.
   */
  function jot(note: string, question: string): boolean {
    // Kept in the line while an undo is out: written behind it, the jot would
    // name the text the undo replaces and be refused, losing the question.
    if (texts === null || undoing || flying.current) return false;
    const text = texts.get(note);
    if (text === undefined || question.trim() === "") return false;

    const next = appendStub(text, question.trim());
    setTexts((was) => new Map(was).set(note, next));
    write(note, text, next);
    return true;
  }

  const reveal = useCallback(() => {
    if (card === undefined || undoing || flying.current) return;
    setRevealed(true);
    // Once, on the turn: a second space on an answer already showing is not a
    // request to hear it again, `r` and Replay being that.
    if (!shown) play(soundsIn(card.back));
  }, [card, play, shown, undoing, flying.current]);

  return {
    texts,
    queue,
    seat,
    card,
    revealed,
    shown,
    next,
    nextDue,
    doneToday,
    newCount,
    today,
    typed,
    setTyped,
    done,
    failed,
    rereadable,
    reread,
    step,
    undoing,
    reveal,
    rate,
    suspend,
    undo,
    jot,
  };
}
