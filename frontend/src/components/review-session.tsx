import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { BUTTON, ReviewAnswer, ReviewSource } from "@/components/review-answer";
import { SwipeCard } from "@/components/review-swipe";
import { unescaped } from "@/lib/card-line";
import { sameAnswer } from "@/lib/card-text";
import { shiftDay } from "@/lib/clock";
import { noteName } from "@/lib/note-path";
import type { Deck } from "@/lib/review";
import { daysBetween, dayWords } from "@/lib/review-days";
import type { Rating } from "@/lib/srs";
import { soundsShowing, useCardSounds } from "@/lib/use-card-sounds";
import { useReviewSitting } from "@/lib/use-review-sitting";

/**
 * Where the typing toggle is kept, which is the browser and not the vault.
 *
 * It is a preference about how you like to be asked, not a fact about the
 * notes, so it has no business in a file. The archive toggle makes the opposite
 * call and is deliberately not persisted at all; the difference is that
 * forgetting the archive is safe and forgetting this one is a small annoyance
 * on every card.
 */
const TYPING_KEY = "kasten.review.typing";

/** Where the Center toggle is kept, for the reason the typing toggle is. */
const CENTER_KEY = "kasten.review.center";

interface ReviewSessionProps {
  deck: Deck;
  /** Leave the session, which is the back button and the pane's `q`. */
  onLeave: () => void;
  /**
   * Handed the callbacks a shell may want to put its own keys over.
   *
   * The pane binds `space` and `1` to `4` to these; the phone route binds
   * nothing, its buttons being the whole interface. Neither shell holds a rule
   * about scheduling, which is what keeps the two from drifting.
   */
  onControls?: (
    controls: {
      /** Whether a card is on screen, which the done screen holding Undo has not. */
      showing: boolean;
      /** Whether the answer is up, which is what makes Enter grade Good rather than reveal. */
      shown: boolean;
      /**
       * Whether the answer was turned over on a card that has one. A whole note is
       * shown from the start, and an undo turns its answer back on, so neither
       * counts: an Enter must not grade a note nobody has turned over.
       */
      revealed: boolean;
      reveal: () => void;
      rate: (rating: Rating) => void;
      suspend: () => void;
      capture: () => void;
      replay: () => void;
      undo: () => void;
    } | null,
  ) => void;
  /**
   * Opens the card's source: the note, at the card's line, or the top of a whole note.
   *
   * The pane opens it beside the review and the phone route leaves for the page,
   * so the two shells say where it goes and this says only what to open.
   */
  onOpen?: (path: string, line?: number) => void;
}

/**
 * One deck, one card at a time.
 *
 * The sitting's state and scheduling live in `useReviewSitting`, and the
 * sounds in `useCardSounds`. This holds what is left: the typing and centre
 * toggles, the capture line, and the screen.
 */
export function ReviewSession({ deck, onLeave, onControls, onOpen }: ReviewSessionProps) {
  const [typing, setTyping] = useState(() => localStorage.getItem(TYPING_KEY) === "on");
  /** The question being jotted, or null while the capture line is closed. */
  const [jotting, setJotting] = useState<string | null>(null);
  /** The note the open capture line writes into. */
  const [jotNote, setJotNote] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [center, setCenter] = useState(() => localStorage.getItem(CENTER_KEY) === "on");
  const { play, playFirst } = useCardSounds();
  // A swiped card in flight: the ref refuses presses at once, and the state greys
  // the grade buttons while the flight is out, the way an undo does.
  const flying = useRef(false);
  const [landing, setLanding] = useState(false);
  const onFlight = useCallback((on: boolean) => {
    flying.current = on;
    setLanding(on);
  }, []);
  const {
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
    step,
    undoing,
    reveal,
    rate,
    suspend,
    undo,
    jot: writeJot,
  } = useReviewSitting(deck, play, flying);

  // How long ago the card was last answered: its due day less its interval is the
  // day it was answered, which the rating wrote. Null for a card nobody has answered.
  const since =
    card?.held === null || card === undefined
      ? null
      : daysBetween(shiftDay(card.held.due, -card.held.interval), today);
  // A day count that reads backwards is a schedule nobody could have answered on,
  // so the clause is dropped rather than printed as a negative.
  const daysAgo = since === null || since < 0 ? null : since;

  // The card the sitting opens on is already there when the page is, so it does
  // not come in. Every card after it does, once, when its remount plays the entrance.
  const opening = useRef<number | null>(null);
  if (card !== undefined && opening.current === null) opening.current = done;
  const entering = card !== undefined && opening.current !== done;

  const sounds = useMemo(
    () => (card === undefined ? [] : soundsShowing(card, revealed)),
    [card, revealed],
  );

  // The first card is the one no tap shows, played once it lands.
  useEffect(() => {
    playFirst(card);
  }, [card, playFirst]);

  /**
   * Write what was jotted at the end of the note the capture line opened on,
   * and close the line once it is written.
   */
  function jot(question: string) {
    if (jotNote === null) return;
    if (writeJot(jotNote, question)) setJotting(null);
  }

  // A toggle, because the second press is the only way to shut the line
  // without writing a card: `Escape` is not bound here and a phone has none.
  // Nothing on the done screen, where the controls stay up for Undo alone and a
  // jot would have no note to go into, nor while an undo is out.
  const capture = useCallback(() => {
    if (seat === undefined || card === undefined || undoing || flying.current) return;
    if (jotting !== null) {
      setJotting(null);
      return;
    }
    setJotting("");
    // The note the line was opened on, which an undo landing under a held
    // question can take off the screen.
    setJotNote(seat.note);
  }, [card, jotting, seat, undoing]);

  const jotOpen = jotting !== null;

  // The key opened the line, so the cursor belongs in it. An effect rather than
  // `autoFocus`, the way `clip-prompt.tsx:47` takes it, and the focus goes back
  // to the pane on the way out so the keys work again without a click.
  useEffect(() => {
    if (!jotOpen) return;
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [jotOpen]);

  const replay = useCallback(() => play(sounds), [play, sounds]);

  const toggleTyping = useCallback(() => {
    setTyping((on) => {
      localStorage.setItem(TYPING_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  const toggleCenter = useCallback(() => {
    setCenter((on) => {
      localStorage.setItem(CENTER_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  // Held on the done screen too while a step is, so `u` can bring back the
  // last card of the deck. `showing` tells the pane there is no card there, so
  // its `space` is the leader again rather than a reveal of nothing.
  // A layout effect so a key pressed the moment the card shows reaches it: a
  // passive effect ran a tick later and left a window where the key graded nothing (#927).
  useLayoutEffect(() => {
    const showing = card !== undefined;
    const turned = card !== undefined && revealed && card.back !== "";
    onControls?.(
      !showing && step === null
        ? null
        : { showing, shown, revealed: turned, reveal, rate, suspend, capture, replay, undo },
    );
    return () => onControls?.(null);
  }, [capture, card, onControls, rate, replay, reveal, revealed, shown, step, suspend, undo]);

  return (
    <div className="flex h-full flex-col bg-k-bg font-sans text-k-ink">
      {/* Nine things share this row, and at a phone's width the gaps between
          them are what the deck's name is squeezed out by. A card with a sound
          puts Replay beside Undo, which is more than a phone holds, so there
          the row wraps rather than pushing Center off the screen. */}
      <header className="flex items-center gap-3 border-k-rule border-b px-3 py-2 max-md:flex-wrap max-md:justify-end max-md:gap-1">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 px-2 max-md:px-1 text-k-13 text-k-muted"
        >
          ← Decks
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-k-13 text-k-muted">
          {deck.name}
        </span>
        <span className="px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label">
          {queue.length} left
        </span>
        {/* The phone's `r`, and the only way to hear a first card a phone
            refused to play unasked. Drawn while the side showing has a sound. */}
        {sounds.length > 0 && (
          <button
            type="button"
            onClick={replay}
            className="min-h-11 px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label hover:text-k-accent pointer-coarse:min-w-11"
          >
            Replay
          </button>
        )}
        {/* Drawn while there is a step to take back, the done screen included,
            and greyed while the undo is out so a second tap sends nothing.
            `aria-disabled` and not `disabled` here and on Park, Write a new
            question and Show the answer: the browser blurs a focused button it disables, which
            takes the focus out of the pane and its keys with it. The callbacks
            refuse while the undo is out. */}
        {(step !== null || undoing) && (
          <button
            type="button"
            onClick={undo}
            aria-disabled={undoing}
            className="min-h-11 px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label hover:text-k-accent aria-disabled:opacity-50 pointer-coarse:min-w-11"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={toggleTyping}
          aria-pressed={typing}
          className={`min-h-11 px-2 max-md:px-1 text-k-12 uppercase tracking-k-label pointer-coarse:min-w-11 ${
            typing ? "text-k-accent" : "text-k-muted"
          }`}
        >
          Type
        </button>
        <button
          type="button"
          onClick={toggleCenter}
          aria-pressed={center}
          className={`min-h-11 px-2 max-md:px-1 text-k-12 uppercase tracking-k-label ${
            center ? "text-k-accent" : "text-k-muted"
          }`}
        >
          Center
        </button>
      </header>

      {/* Under the header rather than in the footer, which is the reveal's and
          the ratings'. A question you thought of belongs beside the card that
          prompted it, and the card stays on screen while you write it. */}
      {jotting !== null && (
        <form
          data-testid="review-capture"
          onSubmit={(event) => {
            event.preventDefault();
            jot(jotting);
          }}
          className="flex gap-2 border-k-rule border-b px-3 py-2"
        >
          <input
            // Off, both of them, for the reason the typing field has them off:
            // a question is as often a term of art as a sentence.
            autoCapitalize="off"
            autoCorrect="off"
            ref={field}
            aria-label="a new question"
            value={jotting}
            onChange={(event) => setJotting(event.target.value)}
            placeholder="A question to answer later"
            className="min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-3 text-k-13 text-k-ink outline-none focus:border-k-accent pointer-coarse:text-base"
          />
          {/* Disabled while an undo is out, the question kept in the field
              for the next submit. */}
          <button type="submit" disabled={undoing} className={BUTTON}>
            Jot it
          </button>
        </form>
      )}

      {/* Centred by the card's own auto margins and never by `justify-center`
          here: a card taller than the pane would be pushed past the top of the
          scroll, where nothing can reach it. */}
      <div
        className={`min-h-0 flex-1 overflow-auto px-4 py-6 text-k-15 ${center ? "flex flex-col" : ""}`}
      >
        {texts === null && failed === null && <p className="text-k-muted">Reading the deck…</p>}

        {card === undefined && texts !== null && (
          <div data-testid="review-done" className="mx-auto w-full max-w-[var(--k-measure)]">
            <h2 className="font-serif text-k-27">Done for today</h2>
            <p className="mt-4 text-k-muted">
              {doneToday} answered today in {deck.name}.
            </p>
            <p className="mt-2 text-k-muted">
              {nextDue !== null
                ? `The next cards are due ${dayWords(nextDue, today)}.`
                : `Nothing in ${deck.name} is scheduled yet.`}
            </p>
            {/* New cards held back for a limit, which the schedule above does not name. */}
            {newCount > 0 && (
              <p className="mt-2 text-k-muted">
                {newCount} new {newCount === 1 ? "card waits" : "cards wait"}.
              </p>
            )}
          </div>
        )}

        {card !== undefined && (
          <SwipeCard
            swipe={shown && !undoing}
            onGrade={rate}
            onFlight={onFlight}
            onTap={shown ? undefined : reveal}
            className={`mx-auto w-full max-w-[var(--k-measure)]${center ? " review-center my-auto text-center" : ""} pointer-coarse:rounded-[var(--k-radius-8)] pointer-coarse:border pointer-coarse:border-k-rule pointer-coarse:bg-k-paper pointer-coarse:px-4 pointer-coarse:pt-10 pointer-coarse:pb-4`}
          >
            <div key={done} data-testid="review-card" className={entering ? "k-enter" : undefined}>
              {/* Rendered the way the editor renders it, so a card holding a
                table is asked as a table and not as a row of pipes. Keyed on
                the text because the preview reads it once, on mount. */}
              {/* A phone reads the question as a title, so only the question is
                set at 28 px. The answer and the lines around the card keep
                the body size. */}
              <div
                data-testid="review-question"
                className="review-front font-serif text-k-27 max-md:text-[28px] max-md:leading-[1.15] max-md:tracking-[var(--k-track-title)]"
              >
                <NotePreview
                  key={`front:${card.front}`}
                  text={card.front}
                  gaps={card.cloze !== null}
                />
              </div>
              {shown && typing && (
                <p data-testid="review-verdict" className="mt-6 text-k-13 text-k-muted">
                  {/* A cloze's back is the whole line, its target the hidden text.
                    A basic back is markdown, its escapes no part of the answer. */}
                  {sameAnswer(typed, card.target ?? unescaped(card.back)) ? (
                    "Matched"
                  ) : (
                    <>
                      You typed <span className="text-k-ink">{typed || "nothing"}</span>
                    </>
                  )}
                </p>
              )}
              {shown && (
                <div
                  data-testid="review-back"
                  className="review-back mt-6 border-k-rule border-t pt-6"
                >
                  <NotePreview key={`back:${card.back}`} text={card.back} />
                </div>
              )}
              {shown && seat !== undefined && (
                <ReviewSource
                  name={noteName(seat.note)}
                  line={deck.whole ? undefined : card.from + 1}
                  daysAgo={daysAgo}
                  onOpen={() =>
                    deck.whole ? onOpen?.(seat.note) : onOpen?.(seat.note, card.from + 1)
                  }
                />
              )}
            </div>
          </SwipeCard>
        )}

        {failed !== null && (
          <p role="alert" className="mt-6 text-k-muted">
            {failed}
          </p>
        )}
      </div>

      {card !== undefined && (
        <ReviewAnswer
          shown={shown}
          typing={typing}
          typed={typed}
          onTyped={setTyped}
          undoing={undoing || landing}
          jotOpen={jotOpen}
          next={next}
          onReveal={reveal}
          onRate={rate}
          onPark={suspend}
          onCapture={capture}
        />
      )}
    </div>
  );
}
