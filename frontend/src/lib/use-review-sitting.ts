import { useCallback, useEffect, useMemo, useState } from "react";
import { ChangedOnDisk, fetchNote } from "@/lib/api";
import { soundsIn } from "@/lib/audio";
import { appendStub, setSuspended, writeSchedule } from "@/lib/card-write";
import { readClock } from "@/lib/clock";
import type { Deck, Limits } from "@/lib/review";
import { cardsOf, type Seat, seatsFor } from "@/lib/review-queue";
import type { Card, Rating, Schedule } from "@/lib/srs";
import {
  answeredToday,
  nextSchedule,
  writeNoteSchedule,
  writeNoteSuspended,
} from "@/lib/srs-schedule";
import { soundsShowing } from "@/lib/use-card-sounds";
import { useReviewLimits } from "@/lib/use-review-limits";
import { useSittingWrites } from "@/lib/use-sitting-writes";

/** What the sitting refuses an undo with when the note moved on since the step. */
const MOVED_ON = "The note changed since that step, so it was not undone.";

/**
 * The schedule a rating writes for the card on screen.
 *
 * One place for it, because the write and the interval the button shows must
 * never disagree. A card new at the start keeps answering as a first answer until
 * it leaves the queue. Anki's learning steps do the same, setting the first gap
 * from the last answer, and `answeredToday` then still reads the card as new.
 */
function scheduleFor(seat: Seat, held: Card, rating: Rating, today: string): Schedule {
  return nextSchedule(seat.fresh ? null : held.held, rating, today);
}

/**
 * The last rating or suspend, held so Undo can take it back.
 *
 * The whole queue and not the one seat: `again` moved the seat to the back and
 * a suspend took a cloze's siblings out with it, so only the queue as it stood
 * puts every seat back where it was.
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
 * The state and the scheduling of one sitting: the notes it reads, the queue,
 * and every rating, suspend, undo and jot written back to the note.
 *
 * Every note the deck draws from is read once, at the start, and every rating
 * is written straight back to the note the card is in. That is a `PUT` per
 * answer, which is what the todo pane already does per press, and it means a
 * session interrupted halfway keeps the answers it got rather than losing them
 * the way a sitting of an exam does.
 *
 * The queue holds a note and an ordinal into its cards rather than the cards
 * themselves. Writing a schedule can insert a line, which moves every card
 * under it, but it can never add or remove a card, so card three stays card
 * three and the ordinals survive a rewrite that the line numbers do not.
 */
export function useReviewSitting(
  deck: Deck,
  play: (sources: string[]) => void,
  /**
   * Set while a swiped card is in flight, which the sitting refuses everything
   * over: the grade the flight ends in is the only write until it lands. A ref, not
   * state, so a press that lands in the same frame is refused too.
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
  const read = useReviewLimits(true);
  // The first limits read, kept for the whole sitting. Every rating refetches
  // them, and a `decks.md` that answers differently by then would otherwise
  // build the queue again under the sitting: the count jumps back and a card
  // rated `again` loses its second asking. A change takes effect at the next
  // sitting, as in Anki.
  const [limits, setLimits] = useState<Limits>();
  useEffect(() => {
    if (read !== undefined) setLimits((was) => was ?? read);
  }, [read]);

  useEffect(() => {
    // Before any note is read: a queue built without the limits would ask the
    // whole deck, and the latch above keeps later limits from rebuilding it.
    if (limits === undefined) return;
    let live = true;
    // All of them before any of them is asked. A deck spanning three notes is
    // three reads at the start rather than one on the card that first needs it,
    // so the queue is the whole sitting from the first question and the count
    // in the header does not climb as you go.
    void Promise.all(deck.notes.map(async (note) => [note, await fetchNote(note)] as const)).then(
      (read) => {
        if (!live) return;
        const texts = new Map(read);
        setTexts(texts);
        setQueue(seatsFor(deck, texts, today, limits));
      },
      (error: unknown) => {
        if (live) {
          unwritten(error instanceof Error ? error.message : "could not read the note");
        }
      },
    );
    return () => {
      live = false;
    };
  }, [deck, today, limits, unwritten]);

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
  const newCards = useMemo(
    () => [...cards.values()].flat().some(({ held, parked }) => parked === null && held === null),
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
   * Park the card on screen and move on, without rating it.
   *
   * The card leaves the queue and keeps its seat in the note, which is the
   * property the ordinals depend on: `setSuspended` splices a token and never
   * adds or removes a card, so every seat behind this one still addresses the
   * card it did before.
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
   * Take back the last rating or suspend: the note's old text, and the card on
   * screen again, revealed, at the head of the queue.
   *
   * The write names what the step sent as its base, which the write queue turns
   * into what the vault answered for it. Anything written over the note since,
   * a jot of this sitting's own included, leaves that base stale and the vault
   * refuses, so an undo never erases newer text. The card comes back only once
   * the write has landed. One step: the step goes whatever came of it.
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
   * Write what was jotted at the end of the note the card on screen came from.
   *
   * The end, and never the middle: a card appended is last in line order, so
   * the ordinals the queue is holding all still address the cards they did.
   * Nothing about the sitting moves, which is the point of writing it here
   * rather than stopping to open the note.
   *
   * Returns whether the question was written, so the caller closes its line
   * only then.
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
    newCards,
    today,
    typed,
    setTyped,
    done,
    failed,
    step,
    undoing,
    reveal,
    rate,
    suspend,
    undo,
    jot,
  };
}
